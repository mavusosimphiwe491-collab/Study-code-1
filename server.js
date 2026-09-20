const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

for (const dir of [DATA_DIR, UPLOADS_DIR, AVATARS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], messages: [], files: [] }, null, 2));
}

function loadData() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function saveData(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, avatar: u.avatar, status: u.status, createdAt: u.createdAt };
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET || 'study-group-' + uuid();
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

app.use('/avatars', express.static(AVATARS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ---- auth middleware ----
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const data = loadData();
  const user = data.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  if (user.status === 'pending') return res.status(403).json({ error: 'pending' });
  if (user.status === 'rejected') return res.status(403).json({ error: 'rejected' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.status !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---- uploads ----
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: AVATARS_DIR,
    filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname).slice(0, 10))
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});
const fileUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname).slice(0, 10))
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ---- auth routes ----
app.post('/api/register', avatarUpload.single('avatar'), (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Email, password and name are required' });
  const data = loadData();
  const existing = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const isFirstUser = data.users.length === 0;
  const user = {
    id: uuid(),
    email: email.toLowerCase().trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    name: name.trim(),
    avatar: req.file ? '/avatars/' + req.file.filename : null,
    status: isFirstUser ? 'admin' : 'pending',
    createdAt: Date.now()
  };
  data.users.push(user);
  saveData(data);
  req.session.userId = user.id;
  res.json({ user: publicUser(user), socketToken: issueToken(user.id) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const data = loadData();
  const user = data.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  if (user.status === 'rejected') return res.status(403).json({ error: 'Your request to join was not approved' });
  req.session.userId = user.id;
  res.json({ user: publicUser(user), socketToken: issueToken(user.id) });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const data = loadData();
  const user = data.users.find(u => u.id === req.session.userId);
  res.json({ user: publicUser(user) });
});

app.post('/api/login-token', requireAuth, (req, res) => {
  res.json({ socketToken: issueToken(req.user.id) });
});

// ---- members / admin ----
app.get('/api/members', requireAuth, (req, res) => {
  const data = loadData();
  const visible = req.user.status === 'admin' ? data.users : data.users.filter(u => u.status === 'approved' || u.status === 'admin');
  res.json({ members: visible.map(publicUser) });
});

app.post('/api/members/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected', 'removed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const data = loadData();
  const target = data.users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  if (target.status === 'admin') return res.status(400).json({ error: "Can't change the admin" });
  target.status = status;
  saveData(data);
  io.emit('members:changed');
  res.json({ member: publicUser(target) });
});

// ---- chat ----
app.get('/api/messages', requireAuth, (req, res) => {
  const data = loadData();
  res.json({ messages: data.messages.slice(-300) });
});

// ---- files ----
app.get('/api/files', requireAuth, (req, res) => {
  const data = loadData();
  res.json({ files: data.files.slice().reverse() });
});

app.post('/api/files', requireAuth, fileUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const data = loadData();
  const record = {
    id: uuid(),
    name: req.file.originalname,
    storedName: req.file.filename,
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedBy: req.user.name,
    uploadedById: req.user.id,
    uploadedAt: Date.now()
  };
  data.files.push(record);
  saveData(data);
  io.emit('files:changed');
  res.json({ file: record });
});

app.get('/api/files/:id/download', requireAuth, (req, res) => {
  const data = loadData();
  const f = data.files.find(x => x.id === req.params.id);
  if (!f) return res.status(404).end();
  res.download(path.join(UPLOADS_DIR, f.storedName), f.name);
});

app.get('/api/files/:id/view', requireAuth, (req, res) => {
  const data = loadData();
  const f = data.files.find(x => x.id === req.params.id);
  if (!f) return res.status(404).end();
  res.setHeader('Content-Type', f.mimeType || 'application/octet-stream');
  res.sendFile(path.join(UPLOADS_DIR, f.storedName));
});

// ---- server + sockets ----
const server = http.createServer(app);
const io = new Server(server);

const tokens = new Map();   // token -> userId, issued at login/register for socket auth
const onlineUsers = new Map(); // userId -> Set of socket ids

function issueToken(userId) {
  const t = uuid();
  tokens.set(t, userId);
  return t;
}

function broadcastPresence() {
  const data = loadData();
  const ids = [...onlineUsers.keys()];
  const list = ids.map(id => {
    const u = data.users.find(x => x.id === id);
    return u ? { id: u.id, name: u.name, avatar: u.avatar } : null;
  }).filter(Boolean);
  io.emit('presence:update', list);
}

io.on('connection', (socket) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const userId = tokens.get(token);
  if (!userId) { socket.disconnect(true); return; }
  const data = loadData();
  const user = data.users.find(u => u.id === userId);
  if (!user || (user.status !== 'approved' && user.status !== 'admin')) { socket.disconnect(true); return; }

  socket.userId = userId;
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);
  broadcastPresence();

  socket.on('chat:send', (text) => {
    if (typeof text !== 'string' || !text.trim()) return;
    const d = loadData();
    const u = d.users.find(x => x.id === userId);
    const msg = { id: uuid(), authorId: userId, authorName: u.name, authorAvatar: u.avatar, text: text.trim().slice(0, 4000), createdAt: Date.now() };
    d.messages.push(msg);
    if (d.messages.length > 2000) d.messages = d.messages.slice(-2000);
    saveData(d);
    io.emit('chat:message', msg);
  });

  function relayToUser(targetId, event, payload) {
    const sockets = onlineUsers.get(targetId);
    if (!sockets) return;
    sockets.forEach(sid => io.to(sid).emit(event, payload));
  }

  socket.on('call:offer', ({ to, sdp, callType }) => {
    const d = loadData();
    const from = d.users.find(x => x.id === userId);
    relayToUser(to, 'call:offer', { from: userId, fromName: from ? from.name : 'Member', sdp, callType });
  });
  socket.on('call:answer', ({ to, sdp }) => relayToUser(to, 'call:answer', { from: userId, sdp }));
  socket.on('call:ice', ({ to, candidate }) => relayToUser(to, 'call:ice', { from: userId, candidate }));
  socket.on('call:end', ({ to }) => relayToUser(to, 'call:end', { from: userId }));

  socket.on('disconnect', () => {
    const set = onlineUsers.get(userId);
    if (set) { set.delete(socket.id); if (set.size === 0) onlineUsers.delete(userId); }
    broadcastPresence();
  });
});

server.listen(PORT, () => {
  console.log('Study group server running at http://localhost:' + PORT);
});
