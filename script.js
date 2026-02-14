(() => {
  const CURRENT_USER_KEY = "ve_current_user";
  const POLL_INTERVAL_MS = 3000;

  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");
  const appRoot = document.getElementById("appRoot");

  if (registerForm && loginForm) {
    initAuthPage();
  }

  if (appRoot) {
    initAppPage();
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    return data;
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

      try {
        await api("/api/register", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });
        setFeedback(feedback, "Registration successful. Please login now.", "ok");
        registerForm.reset();
        showAuthForm("login");
        document.getElementById("loginUsername").value = username;
      } catch (error) {
        setFeedback(feedback, error.message, "error");
      }
    });

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const username = document.getElementById("loginUsername").value.trim();
      const password = document.getElementById("loginPassword").value;

      if (!username || !password) {
        setFeedback(feedback, "Please enter both username and password.", "error");
        return;
      }

      try {
        const result = await api("/api/login", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });

        localStorage.setItem(CURRENT_USER_KEY, result.username);
        setFeedback(feedback, "Login successful. Redirecting...", "ok");

        setTimeout(() => {
          window.location.href = "app.html";
        }, 500);
      } catch {
        setFeedback(feedback, "Invalid username or password.", "error");
      }
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
    const threadCache = new Map();
    let readState = {};

    welcomeText.textContent = `Logged in as: ${currentUser}`;

    const setPresence = async (online) => {
      try {
        await api("/api/presence", {
          method: "POST",
          body: JSON.stringify({ username: currentUser, online })
        });
      } catch {
        // Ignore transient presence errors.
      }
    };

    const refreshUsersAndChat = async () => {
      try {
        const usersRes = await api(`/api/users?currentUser=${encodeURIComponent(currentUser)}`);
        const readRes = await api(`/api/read-state/${encodeURIComponent(currentUser)}`);

        availableUsers = usersRes.users || [];
        readState = readRes.readState || {};

        if (!availableUsers.includes(activePeer)) {
          activePeer = availableUsers.length ? availableUsers[0] : null;
        }

        if (activePeer) {
          await markConversationRead(currentUser, activePeer, readState);
        }

        await renderUsersList(currentUser, availableUsers, activePeer, chatUsersList, readState, handlePeerSelect);
        await renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache, threadCache);

        const canChat = Boolean(activePeer);
        directChatInput.disabled = !canChat;
        directChatSendBtn.disabled = !canChat;
        chatSecretKey.disabled = !canChat;
        recordVoiceBtn.disabled = !canChat;
        stopVoiceBtn.disabled = true;
        sendVoiceBtn.disabled = !recordedAudioDataUrl || !canChat;
      } catch {
        setFeedback(feedback, "Unable to load chat data. Is the backend running?", "error");
      }
    };

    setPresence(true);
    refreshUsersAndChat();

    const presenceTimer = setInterval(() => {
      setPresence(true);
    }, 10000);

    const pollTimer = setInterval(() => {
      refreshUsersAndChat();
    }, POLL_INTERVAL_MS);

    window.addEventListener("beforeunload", () => {
      fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: currentUser, online: false }),
        keepalive: true
      }).catch(() => {});
    });

    logoutBtn.addEventListener("click", async () => {
      await setPresence(false);
      clearInterval(presenceTimer);
      clearInterval(pollTimer);
      localStorage.removeItem(CURRENT_USER_KEY);
      window.location.href = "index.html";
    });

    directChatForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const messageText = directChatInput.value.trim();

      if (!activePeer) {
        setFeedback(feedback, "Select a user to start chatting.", "warn");
        return;
      }

      if (!messageText) {
        return;
      }

      try {
        await appendDirectMessage(currentUser, activePeer, {
          id: generateMessageId(),
          from: currentUser,
          to: activePeer,
          type: "text",
          text: messageText,
          timestamp: new Date().toISOString()
        });

        directChatInput.value = "";
        await refreshUsersAndChat();
      } catch (error) {
        setFeedback(feedback, error.message || "Unable to send message.", "error");
      }
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

    sendVoiceBtn.addEventListener("click", async () => {
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

      try {
        const encryptedAudio = CryptoJS.AES.encrypt(recordedAudioDataUrl, key).toString();
        await appendDirectMessage(currentUser, activePeer, {
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
        await refreshUsersAndChat();
      } catch (error) {
        setFeedback(feedback, error.message || "Audio send failed. Try a shorter recording.", "error");
      }
    });

    chatThread.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !activePeer) {
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

        const messages = await loadDirectMessages(currentUser, activePeer);
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
          await renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache, threadCache);
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

        const messages = await loadDirectMessages(currentUser, activePeer);
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

        await updateDirectMessage(currentUser, activePeer, messageId, {
          text: nextText,
          edited: true,
          editedAt: new Date().toISOString()
        });

        await refreshUsersAndChat();
        return;
      }

      if (target.classList.contains("delete-msg-btn")) {
        const messageId = target.dataset.messageId;
        if (!messageId) {
          return;
        }

        const messages = await loadDirectMessages(currentUser, activePeer);
        const message = messages.find((entry) => String(entry.id) === String(messageId));

        if (!message || message.from !== currentUser) {
          return;
        }

        const confirmed = window.confirm("Delete this message?");
        if (!confirmed) {
          return;
        }

        await removeDirectMessage(currentUser, activePeer, messageId);
        decryptedAudioCache.delete(String(messageId));
        await refreshUsersAndChat();
      }
    });

    async function handlePeerSelect(peer) {
      activePeer = peer;
      await markConversationRead(currentUser, activePeer, readState);
      await renderUsersList(currentUser, availableUsers, activePeer, chatUsersList, readState, handlePeerSelect);
      await renderDirectThread(currentUser, activePeer, chatThread, activeChatHeader, activeChatStatus, decryptedAudioCache, threadCache);
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

  function generateMessageId() {
    return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async function loadDirectMessages(userA, userB) {
    const response = await api(`/api/messages/${encodeURIComponent(userA)}/${encodeURIComponent(userB)}`);
    return Array.isArray(response.messages) ? response.messages : [];
  }

  async function appendDirectMessage(userA, userB, message) {
    await api(`/api/messages/${encodeURIComponent(userA)}/${encodeURIComponent(userB)}`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
  }

  async function updateDirectMessage(userA, userB, messageId, message) {
    await api(`/api/messages/${encodeURIComponent(userA)}/${encodeURIComponent(userB)}/${encodeURIComponent(messageId)}`, {
      method: "PUT",
      body: JSON.stringify({ message })
    });
  }

  async function removeDirectMessage(userA, userB, messageId) {
    await api(`/api/messages/${encodeURIComponent(userA)}/${encodeURIComponent(userB)}/${encodeURIComponent(messageId)}`, {
      method: "DELETE"
    });
  }

  function getLastMessagePreviewFromMessages(currentUser, messages) {
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

  function getUnreadCountFromMessages(peer, readState, messages) {
    const lastRead = Number(readState[peer] || 0);
    return messages.filter((msg) => msg.from === peer && Date.parse(msg.timestamp) > lastRead).length;
  }

  async function saveReadState(currentUser, readState) {
    await api(`/api/read-state/${encodeURIComponent(currentUser)}`, {
      method: "PUT",
      body: JSON.stringify({ readState })
    });
  }

  async function markConversationRead(currentUser, peer, readState) {
    if (!peer) {
      return;
    }

    const messages = await loadDirectMessages(currentUser, peer);
    const latestPeerMessageTs = messages
      .filter((msg) => msg.from === peer)
      .map((msg) => Date.parse(msg.timestamp))
      .filter((ts) => !Number.isNaN(ts))
      .sort((a, b) => b - a)[0];

    if (latestPeerMessageTs) {
      readState[peer] = latestPeerMessageTs;
      await saveReadState(currentUser, readState);
    }
  }

  async function getUserPresence(username) {
    const response = await api(`/api/presence/${encodeURIComponent(username)}`);
    return response.presence || null;
  }

  function isUserOnline(presence) {
    if (!presence || !presence.lastActive) {
      return false;
    }

    const last = Date.parse(presence.lastActive);
    if (Number.isNaN(last)) {
      return false;
    }

    return presence.online && Date.now() - last <= 25000;
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

  async function renderUsersList(currentUser, users, activePeer, container, readState, onSelect) {
    if (!users.length) {
      container.innerHTML = "";
      const empty = document.createElement("p");
      empty.className = "chat-empty";
      empty.textContent = "No other registered users yet.";
      container.appendChild(empty);
      return;
    }

    const loaded = await Promise.all(
      users.map(async (peer) => {
        let presence = null;
        try {
          presence = await getUserPresence(peer);
        } catch {
          presence = null;
        }
        return { peer, unreadCount: 0, presence, preview: "Open chat" };
      })
    );

    container.innerHTML = "";

    loaded.forEach(({ peer, unreadCount, presence, preview }) => {
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

      const previewText = document.createElement("div");
      previewText.className = "chat-user-preview";
      previewText.textContent = preview;

      item.appendChild(top);
      item.appendChild(status);
      item.appendChild(previewText);
      item.addEventListener("click", () => onSelect(peer));
      container.appendChild(item);
    });
  }

  async function renderDirectThread(currentUser, peer, container, headerElement, statusElement, decryptedAudioCache, threadCache) {
    if (!peer) {
      container.innerHTML = "";
      headerElement.textContent = "No available user to chat";
      statusElement.textContent = "";

      const empty = document.createElement("p");
      empty.className = "chat-empty";
      empty.textContent = "Register another account to start user-to-user chat.";
      container.appendChild(empty);
      return;
    }

    headerElement.textContent = `Chat with ${peer}`;
    let peerPresence = null;
    try {
      peerPresence = await getUserPresence(peer);
    } catch {
      peerPresence = null;
    }
    statusElement.textContent = getPresenceLabel(peerPresence);

    let messages = [];
    const cacheKey = [currentUser, peer].sort().join("__");
    try {
      messages = await loadDirectMessages(currentUser, peer);
      threadCache.set(cacheKey, messages);
    } catch {
      messages = threadCache.get(cacheKey) || [];
    }

    container.innerHTML = "";

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
