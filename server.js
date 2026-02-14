const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "db.json");
const ONLINE_TIMEOUT_MS = 25000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      users: parsed.users || {},
      chats: parsed.chats || {},
      presence: parsed.presence || {},
      readState: parsed.readState || {}
    };
  } catch {
    return { users: {}, chats: {}, presence: {}, readState: {} };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,24}$/.test(username);
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("base64");
}

function generateSalt() {
  return crypto.randomBytes(16).toString("base64");
}

function getChatKey(userA, userB) {
  return [userA, userB].sort().join("__");
}

function normalizeMessage(message) {
  const next = { ...message };
  if (!next.id) {
    next.id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  if (!next.type) {
    next.type = next.encryptedAudio ? "audio" : "text";
  }
  if (!next.timestamp) {
    next.timestamp = new Date().toISOString();
  }
  return next;
}

function normalizeChat(chat) {
  if (!Array.isArray(chat)) {
    return [];
  }
  return chat.map(normalizeMessage);
}

function isOnline(presence) {
  if (!presence || !presence.online || !presence.lastActive) {
    return false;
  }
  const last = Date.parse(presence.lastActive);
  if (Number.isNaN(last)) {
    return false;
  }
  return Date.now() - last <= ONLINE_TIMEOUT_MS;
}

app.post("/api/register", (req, res) => {
  const { username = "", password = "" } = req.body || {};
  const normalizedUsername = String(username).trim();
  const normalizedPassword = String(password);

  if (!isValidUsername(normalizedUsername)) {
    return res.status(400).json({ error: "Username must be 3-24 chars: letters, numbers, underscore." });
  }
  if (normalizedPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const db = readDb();
  if (db.users[normalizedUsername]) {
    return res.status(409).json({ error: "Username already exists." });
  }

  const salt = generateSalt();
  db.users[normalizedUsername] = {
    salt,
    passwordHash: hashPassword(normalizedPassword, salt)
  };
  writeDb(db);

  return res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { username = "", password = "" } = req.body || {};
  const normalizedUsername = String(username).trim();
  const normalizedPassword = String(password);

  const db = readDb();
  const user = db.users[normalizedUsername];
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  const passwordHash = hashPassword(normalizedPassword, user.salt);
  if (passwordHash !== user.passwordHash) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  return res.json({ ok: true, username: normalizedUsername });
});

app.get("/api/users", (req, res) => {
  const currentUser = String(req.query.currentUser || "").trim();
  const db = readDb();
  const users = Object.keys(db.users).filter((name) => name !== currentUser);
  return res.json({ users });
});

app.get("/api/presence/:username", (req, res) => {
  const username = String(req.params.username || "").trim();
  const db = readDb();
  const presence = db.presence[username] || null;
  return res.json({ presence, isOnline: isOnline(presence) });
});

app.post("/api/presence", (req, res) => {
  const { username = "", online = false } = req.body || {};
  const normalizedUsername = String(username).trim();
  if (!normalizedUsername) {
    return res.status(400).json({ error: "Username is required." });
  }

  const db = readDb();
  db.presence[normalizedUsername] = {
    online: Boolean(online),
    lastActive: new Date().toISOString()
  };
  writeDb(db);
  return res.json({ ok: true });
});

app.get("/api/messages/:userA/:userB", (req, res) => {
  const userA = String(req.params.userA || "").trim();
  const userB = String(req.params.userB || "").trim();
  if (!userA || !userB) {
    return res.status(400).json({ error: "Both users are required." });
  }

  const db = readDb();
  const key = getChatKey(userA, userB);
  const normalized = normalizeChat(db.chats[key]);
  db.chats[key] = normalized;
  writeDb(db);
  return res.json({ messages: normalized });
});

app.post("/api/messages/:userA/:userB", (req, res) => {
  const userA = String(req.params.userA || "").trim();
  const userB = String(req.params.userB || "").trim();
  const { message } = req.body || {};

  if (!userA || !userB || !message || typeof message !== "object") {
    return res.status(400).json({ error: "Invalid message payload." });
  }

  const db = readDb();
  const key = getChatKey(userA, userB);
  const nextMessage = normalizeMessage(message);
  const messages = normalizeChat(db.chats[key]);
  messages.push(nextMessage);
  db.chats[key] = messages;
  writeDb(db);

  return res.json({ ok: true, message: nextMessage });
});

app.put("/api/messages/:userA/:userB/:id", (req, res) => {
  const userA = String(req.params.userA || "").trim();
  const userB = String(req.params.userB || "").trim();
  const id = String(req.params.id || "");
  const { message } = req.body || {};

  if (!userA || !userB || !id || !message || typeof message !== "object") {
    return res.status(400).json({ error: "Invalid update payload." });
  }

  const db = readDb();
  const key = getChatKey(userA, userB);
  const messages = normalizeChat(db.chats[key]).map((entry) => {
    if (String(entry.id) !== id) {
      return entry;
    }
    return normalizeMessage({ ...entry, ...message, id: entry.id });
  });
  db.chats[key] = messages;
  writeDb(db);

  return res.json({ ok: true });
});

app.delete("/api/messages/:userA/:userB/:id", (req, res) => {
  const userA = String(req.params.userA || "").trim();
  const userB = String(req.params.userB || "").trim();
  const id = String(req.params.id || "");

  if (!userA || !userB || !id) {
    return res.status(400).json({ error: "Invalid delete request." });
  }

  const db = readDb();
  const key = getChatKey(userA, userB);
  const messages = normalizeChat(db.chats[key]).filter((entry) => String(entry.id) !== id);
  db.chats[key] = messages;
  writeDb(db);

  return res.json({ ok: true });
});

app.get("/api/read-state/:username", (req, res) => {
  const username = String(req.params.username || "").trim();
  const db = readDb();
  return res.json({ readState: db.readState[username] || {} });
});

app.put("/api/read-state/:username", (req, res) => {
  const username = String(req.params.username || "").trim();
  const { readState } = req.body || {};
  if (!username || !readState || typeof readState !== "object") {
    return res.status(400).json({ error: "Invalid read state payload." });
  }

  const db = readDb();
  db.readState[username] = readState;
  writeDb(db);
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
