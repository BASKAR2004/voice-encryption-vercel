(() => {
  const USERS_KEY = "ve_users_v1";
  const CURRENT_USER_KEY = "ve_current_user";
  const ONLINE_TIMEOUT_MS = 25000;

  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");
  const appRoot = document.getElementById("appRoot");

  if (registerForm && loginForm) {
    initAuthPage();
  }

  if (appRoot) {
    initAppPage();
  }

  function initAuthPage() {
    const feedback = document.getElementById("authFeedback");
    const showLoginBtn = document.getElementById("showLoginBtn");
    const showRegisterBtn = document.getElementById("showRegisterBtn");

    showLoginBtn.addEventListener("click", () => {
      showAuthForm("login");
      clearFeedback(feedback);
    });

    showRegisterBtn.addEventListener("click", () => {
      showAuthForm("register");
      clearFeedback(feedback);
    });

    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const username = document.getElementById("registerUsername").value.trim();
      const password = document.getElementById("registerPassword").value;
      const confirmPassword = document.getElementById("registerConfirmPassword").value;

      if (!isValidUsername(username)) {
        setFeedback(feedback, "Username must be 3-24 chars: letters, numbers, underscore.", "error");
        return;
      }

      if (password.length < 8) {
        setFeedback(feedback, "Password must be at least 8 characters.", "error");
        return;
      }

      if (password !== confirmPassword) {
        setFeedback(feedback, "Password confirmation does not match.", "error");
        return;
      }

      const users = getUsers();

      if (users[username]) {
        setFeedback(feedback, "Username already exists. Please login.", "warn");
        showAuthForm("login");
        document.getElementById("loginUsername").value = username;
        return;
      }

      const salt = generateSalt();
      const passwordHash = await hashPassword(password, salt);

      users[username] = {
        salt,
        passwordHash
      };

      saveUsers(users);
      setFeedback(feedback, "Registration successful. Please login now.", "ok");
      registerForm.reset();
      showAuthForm("login");
      document.getElementById("loginUsername").value = username;
    });

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const username = document.getElementById("loginUsername").value.trim();
      const password = document.getElementById("loginPassword").value;

      if (!username || !password) {
        setFeedback(feedback, "Please enter both username and password.", "error");
        return;
      }

      const users = getUsers();
      const user = users[username];

      if (!user) {
        setFeedback(feedback, "Account not found. Please register first.", "error");
        return;
      }

      const passwordHash = await hashPassword(password, user.salt);
      if (passwordHash !== user.passwordHash) {
        setFeedback(feedback, "Invalid username or password.", "error");
        return;
      }

      localStorage.setItem(CURRENT_USER_KEY, username);
      setFeedback(feedback, "Login successful. Redirecting...", "ok");

      setTimeout(() => {
        window.location.href = "app.html";
      }, 500);
    });
  }

  function showAuthForm(type) {
    const registerFormElement = document.getElementById("registerForm");
    const loginFormElement = document.getElementById("loginForm");

    if (type === "login") {
      registerFormElement.classList.remove("is-active");
      loginFormElement.classList.add("is-active");
      return;
    }

    loginFormElement.classList.remove("is-active");
    registerFormElement.classList.add("is-active");
  }

  function clearFeedback(element) {
    element.textContent = "";
    element.className = "feedback";
  }

  function initAppPage() {
    const currentUser = localStorage.getItem(CURRENT_USER_KEY);

    if (!currentUser) {
      window.location.href = "index.html";
      return;
    }

    const feedback = document.getElementById("appFeedback");
    const welcomeText = document.getElementById("welcomeText");
    const logoutBtn = document.getElementById("logoutBtn");

    const chatUsersList = document.getElementById("chatUsersList");
    const activeChatHeader = document.getElementById("activeChatHeader");
    const activeChatStatus = document.getElementById("activeChatStatus");
    const chatThread = document.getElementById("chatThread");
    const directChatForm = document.getElementById("directChatForm");
    const directChatInput = document.getElementById("directChatInput");
    const directChatSendBtn = directChatForm.querySelector("button");

    const chatSecretKey = document.getElementById("chatSecretKey");
    const recordVoiceBtn = document.getElementById("recordVoiceBtn");
    const stopVoiceBtn = document.getElementById("stopVoiceBtn");
    const sendVoiceBtn = document.getElementById("sendVoiceBtn");
    const recordingState = document.getElementById("recordingState");
    const voicePreview = document.getElementById("voicePreview");

    let mediaRecorder = null;
    let audioChunks = [];
    let recordedAudioDataUrl = "";

    let availableUsers = [];
    let activePeer = null;
    const decryptedAudioCache = new Map();
    const readState = loadReadState(currentUser);

    welcomeText.textContent = `Logged in as: ${currentUser}`;

    setUserPresence(currentUser, true);
    const presenceTimer = setInterval(() => {
      setUserPresence(currentUser, true);
      refreshUsersAndChat();
    }, 10000);

    window.addEventListener("beforeunload", () => {
      setUserPresence(currentUser, false);
    });

    refreshUsersAndChat();

    logoutBtn.addEventListener("click", () => {
      setUserPresence(currentUser, false);
      clearInterval(presenceTimer);
      localStorage.removeItem(CURRENT_USER_KEY);
      window.location.href = "index.html";
    });

    window.addEventListener("storage", (event) => {
      if (!event.key || event.key.startsWith("ve_chat_") || event.key === USERS_KEY || event.key.startsWith("ve_presence_")) {
        refreshUsersAndChat();
      }
    });

    directChatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const messageText = directChatInput.value.trim();

      if (!activePeer) {
        setFeedback(feedback, "Select a user to start chatting.", "warn");
        return;
      }

      if (!messageText) {
        return;
      }

      appendDirectMessage(currentUser, activePeer, {
        id: generateMessageId(),
        from: currentUser,
        to: activePeer,
        type: "text",
        text: messageText,
        timestamp: new Date().toISOString()
      });

      directChatInput.value = "";
      renderUsersList(currentUser, availableUsers, activePeer, chatUsersList, readState, handlePeerSelect);
      renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache);
    });

    recordVoiceBtn.addEventListener("click", async () => {
      if (!activePeer) {
        setFeedback(feedback, "Select a user before recording voice.", "warn");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];

        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
          recordedAudioDataUrl = await blobToDataURL(blob);
          voicePreview.src = recordedAudioDataUrl;

          sendVoiceBtn.disabled = false;
          updateRecordingState(recordingState, false);
          setFeedback(feedback, "Voice recorded. Enter key and send encrypted voice.", "ok");

          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.start();
        recordVoiceBtn.disabled = true;
        stopVoiceBtn.disabled = false;
        sendVoiceBtn.disabled = true;
        updateRecordingState(recordingState, true);
        setFeedback(feedback, "Recording started...", "warn");
      } catch {
        setFeedback(feedback, "Microphone access denied or unavailable.", "error");
      }
    });

    stopVoiceBtn.addEventListener("click", () => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }

      recordVoiceBtn.disabled = false;
      stopVoiceBtn.disabled = true;
    });

    sendVoiceBtn.addEventListener("click", () => {
      if (!activePeer) {
        setFeedback(feedback, "Select a user to send voice.", "warn");
        return;
      }

      const key = chatSecretKey.value.trim();
      if (!key) {
        setFeedback(feedback, "Secret key is required to encrypt voice.", "error");
        return;
      }

      if (!recordedAudioDataUrl) {
        setFeedback(feedback, "Record voice first.", "error");
        return;
      }

      const encryptedAudio = CryptoJS.AES.encrypt(recordedAudioDataUrl, key).toString();

      appendDirectMessage(currentUser, activePeer, {
        id: generateMessageId(),
        from: currentUser,
        to: activePeer,
        type: "audio",
        encryptedAudio,
        timestamp: new Date().toISOString()
      });

      recordedAudioDataUrl = "";
      voicePreview.removeAttribute("src");
      voicePreview.load();
      sendVoiceBtn.disabled = true;

      setFeedback(feedback, "Encrypted voice sent in chat.", "ok");
      renderUsersList(currentUser, availableUsers, activePeer, chatUsersList, readState, handlePeerSelect);
      renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache);
    });

    chatThread.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!activePeer) {
        return;
      }

      if (target.classList.contains("decrypt-btn")) {
        const messageId = target.dataset.messageId;
        if (!messageId) {
          return;
        }

        const key = chatSecretKey.value.trim();
        if (!key) {
          setFeedback(feedback, "Enter secret key to decrypt voice.", "error");
          return;
        }

        const messages = loadDirectMessages(currentUser, activePeer);
        const message = messages.find((entry) => String(entry.id) === String(messageId) && entry.type === "audio");

        if (!message) {
          setFeedback(feedback, "Voice message not found.", "error");
          return;
        }

        try {
          const bytes = CryptoJS.AES.decrypt(message.encryptedAudio, key);
          const decryptedAudioData = bytes.toString(CryptoJS.enc.Utf8);

          if (!decryptedAudioData || !decryptedAudioData.startsWith("data:audio")) {
            setFeedback(feedback, "Invalid key. Unable to decrypt this voice message.", "error");
            return;
          }

          decryptedAudioCache.set(String(message.id), decryptedAudioData);
          setFeedback(feedback, "Voice message decrypted. You can now play it.", "ok");
          renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache);
        } catch {
          setFeedback(feedback, "Decryption failed. Check your key.", "error");
        }

        return;
      }

      if (target.classList.contains("edit-msg-btn")) {
        const messageId = target.dataset.messageId;
        if (!messageId) {
          return;
        }

        const messages = loadDirectMessages(currentUser, activePeer);
        const message = messages.find((entry) => String(entry.id) === String(messageId));

        if (!message || message.from !== currentUser || message.type !== "text") {
          return;
        }

        const editedText = window.prompt("Edit your message:", message.text || "");
        if (editedText === null) {
          return;
        }

        const nextText = editedText.trim();
        if (!nextText) {
          setFeedback(feedback, "Message cannot be empty.", "warn");
          return;
        }

        updateDirectMessage(currentUser, activePeer, messageId, (entry) => ({
          ...entry,
          text: nextText,
          edited: true,
          editedAt: new Date().toISOString()
        }));

        renderUsersList(currentUser, availableUsers, activePeer, chatUsersList, readState, handlePeerSelect);
        renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache);
        return;
      }

      if (target.classList.contains("delete-msg-btn")) {
        const messageId = target.dataset.messageId;
        if (!messageId) {
          return;
        }

        const messages = loadDirectMessages(currentUser, activePeer);
        const message = messages.find((entry) => String(entry.id) === String(messageId));

        if (!message || message.from !== currentUser) {
          return;
        }

        const confirmed = window.confirm("Delete this message?");
        if (!confirmed) {
          return;
        }

        removeDirectMessage(currentUser, activePeer, messageId);
        decryptedAudioCache.delete(String(messageId));
        renderUsersList(currentUser, availableUsers, activePeer, chatUsersList, readState, handlePeerSelect);
        renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache);
      }
    });

    function handlePeerSelect(peer) {
      activePeer = peer;
      markConversationRead(currentUser, activePeer, readState);
      renderUsersList(currentUser, availableUsers, activePeer, chatUsersList, readState, handlePeerSelect);
      renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache);
    }

    function refreshUsersAndChat() {
      availableUsers = Object.keys(getUsers()).filter((name) => name !== currentUser);

      if (!availableUsers.includes(activePeer)) {
        activePeer = availableUsers.length ? availableUsers[0] : null;
      }

      if (activePeer) {
        markConversationRead(currentUser, activePeer, readState);
      }

      renderUsersList(currentUser, availableUsers, activePeer, chatUsersList, readState, handlePeerSelect);
      renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache);

      const canChat = Boolean(activePeer);
      directChatInput.disabled = !canChat;
      directChatSendBtn.disabled = !canChat;
      chatSecretKey.disabled = !canChat;
      recordVoiceBtn.disabled = !canChat;
      stopVoiceBtn.disabled = true;
      sendVoiceBtn.disabled = !recordedAudioDataUrl || !canChat;
    }
  }

  function setFeedback(element, message, type) {
    element.textContent = message;
    element.className = `feedback ${type}`;
  }

  function updateRecordingState(element, isRecording) {
    element.textContent = isRecording ? "Recording..." : "Idle";
    element.className = `state-badge ${isRecording ? "recording" : "idle"}`;
  }

  function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,24}$/.test(username);
  }

  function getUsers() {
    try {
      return JSON.parse(localStorage.getItem(USERS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return bytesToBase64(array);
  }

  async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return bytesToBase64(new Uint8Array(digest));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  function generateMessageId() {
    return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function getDirectChatKey(userA, userB) {
    const sorted = [userA, userB].sort();
    return `ve_chat_${sorted[0]}_${sorted[1]}`;
  }

  function loadDirectMessages(userA, userB) {
    const key = getDirectChatKey(userA, userB);
    let messages;

    try {
      messages = JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      return [];
    }

    if (!Array.isArray(messages)) {
      return [];
    }

    let changed = false;

    const normalized = messages.map((entry) => {
      const message = { ...entry };

      if (!message.id) {
        message.id = generateMessageId();
        changed = true;
      }

      if (!message.type) {
        message.type = message.encryptedAudio ? "audio" : "text";
        changed = true;
      }

      if (!message.timestamp) {
        message.timestamp = new Date().toISOString();
        changed = true;
      }

      return message;
    });

    if (changed) {
      localStorage.setItem(key, JSON.stringify(normalized));
    }

    return normalized;
  }

  function appendDirectMessage(userA, userB, message) {
    const key = getDirectChatKey(userA, userB);
    const messages = loadDirectMessages(userA, userB);
    messages.push(message);
    localStorage.setItem(key, JSON.stringify(messages));
  }

  function updateDirectMessage(userA, userB, messageId, updater) {
    const key = getDirectChatKey(userA, userB);
    const messages = loadDirectMessages(userA, userB);
    const updated = messages.map((entry) => {
      if (String(entry.id) !== String(messageId)) {
        return entry;
      }
      return updater(entry);
    });
    localStorage.setItem(key, JSON.stringify(updated));
  }

  function removeDirectMessage(userA, userB, messageId) {
    const key = getDirectChatKey(userA, userB);
    const messages = loadDirectMessages(userA, userB);
    const filtered = messages.filter((entry) => String(entry.id) !== String(messageId));
    localStorage.setItem(key, JSON.stringify(filtered));
  }

  function getLastMessagePreview(currentUser, peer) {
    const messages = loadDirectMessages(currentUser, peer);
    if (!messages.length) {
      return "No messages yet";
    }

    const last = messages[messages.length - 1];
    if (last.type === "audio") {
      return last.from === currentUser ? "You: [Encrypted voice]" : "[Encrypted voice]";
    }

    const prefix = last.from === currentUser ? "You: " : "";
    return `${prefix}${last.text}`;
  }

  function getUnreadCount(currentUser, peer, readState) {
    const lastRead = Number(readState[peer] || 0);
    const messages = loadDirectMessages(currentUser, peer);
    return messages.filter((msg) => msg.from === peer && Date.parse(msg.timestamp) > lastRead).length;
  }

  function getReadStateKey(currentUser) {
    return `ve_read_${currentUser}`;
  }

  function loadReadState(currentUser) {
    try {
      return JSON.parse(localStorage.getItem(getReadStateKey(currentUser))) || {};
    } catch {
      return {};
    }
  }

  function saveReadState(currentUser, readState) {
    localStorage.setItem(getReadStateKey(currentUser), JSON.stringify(readState));
  }

  function markConversationRead(currentUser, peer, readState) {
    if (!peer) {
      return;
    }

    const messages = loadDirectMessages(currentUser, peer);
    const latestPeerMessageTs = messages
      .filter((msg) => msg.from === peer)
      .map((msg) => Date.parse(msg.timestamp))
      .filter((ts) => !Number.isNaN(ts))
      .sort((a, b) => b - a)[0];

    if (latestPeerMessageTs) {
      readState[peer] = latestPeerMessageTs;
      saveReadState(currentUser, readState);
    }
  }

  function getPresenceKey(username) {
    return `ve_presence_${username}`;
  }

  function setUserPresence(username, online) {
    const payload = {
      online,
      lastActive: new Date().toISOString()
    };
    localStorage.setItem(getPresenceKey(username), JSON.stringify(payload));
  }

  function getUserPresence(username) {
    try {
      return JSON.parse(localStorage.getItem(getPresenceKey(username))) || null;
    } catch {
      return null;
    }
  }

  function isUserOnline(presence) {
    if (!presence || !presence.lastActive) {
      return false;
    }

    const last = Date.parse(presence.lastActive);
    if (Number.isNaN(last)) {
      return false;
    }

    return presence.online && Date.now() - last <= ONLINE_TIMEOUT_MS;
  }

  function getPresenceLabel(presence) {
    if (!presence || !presence.lastActive) {
      return "Last seen unknown";
    }

    if (isUserOnline(presence)) {
      return "Online";
    }

    return `Last seen ${formatChatTime(presence.lastActive)}`;
  }

  function renderUsersList(currentUser, users, activePeer, container, readState, onSelect) {
    container.innerHTML = "";

    if (!users.length) {
      const empty = document.createElement("p");
      empty.className = "chat-empty";
      empty.textContent = "No other registered users yet.";
      container.appendChild(empty);
      return;
    }

    users.forEach((peer) => {
      const unreadCount = getUnreadCount(currentUser, peer, readState);
      const presence = getUserPresence(peer);

      const item = document.createElement("button");
      item.type = "button";
      item.className = `chat-user-item ${peer === activePeer ? "active" : ""}`;

      const top = document.createElement("div");
      top.className = "chat-user-top";

      const title = document.createElement("div");
      title.className = "chat-user-name";
      title.textContent = peer;

      top.appendChild(title);

      if (unreadCount > 0) {
        const badge = document.createElement("span");
        badge.className = "unread-badge";
        badge.textContent = String(unreadCount > 99 ? "99+" : unreadCount);
        top.appendChild(badge);
      }

      const status = document.createElement("div");
      status.className = `chat-user-status ${isUserOnline(presence) ? "online" : "offline"}`;
      status.textContent = getPresenceLabel(presence);

      const preview = document.createElement("div");
      preview.className = "chat-user-preview";
      preview.textContent = getLastMessagePreview(currentUser, peer);

      item.appendChild(top);
      item.appendChild(status);
      item.appendChild(preview);
      item.addEventListener("click", () => onSelect(peer));
      container.appendChild(item);
    });
  }

  function renderDirectThread(currentUser, peer, container, headerElement, statusElement, decryptedAudioCache) {
    container.innerHTML = "";

    if (!peer) {
      headerElement.textContent = "No available user to chat";
      statusElement.textContent = "";

      const empty = document.createElement("p");
      empty.className = "chat-empty";
      empty.textContent = "Register another account to start user-to-user chat.";
      container.appendChild(empty);
      return;
    }

    headerElement.textContent = `Chat with ${peer}`;
    statusElement.textContent = getPresenceLabel(getUserPresence(peer));

    const messages = loadDirectMessages(currentUser, peer);

    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "chat-empty";
      empty.textContent = `No messages with ${peer} yet.`;
      container.appendChild(empty);
      return;
    }

    messages.forEach((message) => {
      const row = document.createElement("div");
      row.className = `chat-message ${message.from === currentUser ? "user" : "peer"}`;

      const bubble = document.createElement("div");
      bubble.className = "chat-bubble";

      if (message.type === "audio") {
        const voicePill = document.createElement("div");
        voicePill.className = "voice-pill";
        voicePill.textContent = "Encrypted voice message";
        bubble.appendChild(voicePill);

        const cacheKey = String(message.id);
        const decryptedAudio = decryptedAudioCache.get(cacheKey);
        if (decryptedAudio) {
          const audio = document.createElement("audio");
          audio.className = "voice-audio";
          audio.controls = true;
          audio.src = decryptedAudio;
          bubble.appendChild(audio);
        } else {
          const decryptButton = document.createElement("button");
          decryptButton.type = "button";
          decryptButton.className = "decrypt-btn";
          decryptButton.dataset.messageId = cacheKey;
          decryptButton.textContent = "Decrypt & Play";
          bubble.appendChild(decryptButton);
        }
      } else {
        const text = document.createElement("div");
        text.textContent = message.text || "";
        bubble.appendChild(text);
      }

      const meta = document.createElement("div");
      meta.className = "chat-meta";
      meta.textContent = `${formatChatTime(message.timestamp)}${message.edited ? " (edited)" : ""}`;
      bubble.appendChild(meta);

      if (message.from === currentUser) {
        const actions = document.createElement("div");
        actions.className = "message-actions";

        if (message.type === "text") {
          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "msg-action-btn edit-msg-btn";
          editBtn.dataset.messageId = String(message.id);
          editBtn.textContent = "Edit";
          actions.appendChild(editBtn);
        }

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "msg-action-btn delete-msg-btn";
        deleteBtn.dataset.messageId = String(message.id);
        deleteBtn.textContent = "Delete";
        actions.appendChild(deleteBtn);

        bubble.appendChild(actions);
      }

      row.appendChild(bubble);
      container.appendChild(row);
    });

    container.scrollTop = container.scrollHeight;
  }

  function formatChatTime(isoTime) {
    const date = new Date(isoTime);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString();
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
})();
