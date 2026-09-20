const root = document.getElementById('app');
let state = {
  loading: true,
  user: null,
  authMode: 'login', // 'login' | 'register'
  authError: '',
  avatarFile: null,
  members: [],
  messages: [],
  files: [],
  peers: [],
  tab: 'chat',
  socket: null,
  call: { active: false, incoming: null, withId: null, withName: null, type: null, pc: null, localStream: null }
};

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  attrs = attrs || {};
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  if (typeof children === 'string') e.textContent = children;
  else if (Array.isArray(children)) children.forEach(c => c && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  else if (children) e.appendChild(children);
  return e;
}
function initials(name) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}
function avatarEl(user, size) {
  size = size || 34;
  if (user && user.avatar) {
    return el('img', { src: user.avatar, class: 'avatar', style: `width:${size}px;height:${size}px;` });
  }
  return el('div', { class: 'avatar', style: `width:${size}px;height:${size}px;font-size:${size * 0.4}px;` }, initials(user && user.name));
}
function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function api(path, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, Object.assign({ credentials: 'same-origin' }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function render() {
  root.innerHTML = '';
  if (state.loading) { root.appendChild(el('p', { style: 'color:var(--text2);text-align:center;margin-top:3rem;' }, 'Loading…')); return; }
  if (!state.user) { root.appendChild(authScreen()); return; }
  if (state.user.status === 'pending') { root.appendChild(pendingScreen()); return; }
  if (state.user.status === 'rejected') { root.appendChild(msgScreen("Your request to join wasn't approved.")); return; }

  root.appendChild(header());
  root.appendChild(tabsBar());
  const body = el('div', {});
  if (state.tab === 'chat') body.appendChild(chatView());
  if (state.tab === 'files') body.appendChild(filesView());
  if (state.tab === 'call') body.appendChild(callView());
  if (state.tab === 'admin' && state.user.status === 'admin') body.appendChild(adminView());
  root.appendChild(body);
}

// ---------- AUTH ----------
function authScreen() {
  const isLogin = state.authMode === 'login';
  const wrap = el('div', { style: 'max-width:360px;margin:3rem auto 0;' });
  wrap.appendChild(el('h1', { style: 'font-size:22px;font-weight:700;text-align:center;margin-bottom:4px;' }, 'Study group'));
  wrap.appendChild(el('p', { style: 'color:var(--text2);text-align:center;font-size:14px;margin-bottom:20px;' }, isLogin ? 'Sign in to your account' : 'Create an account to request access'));

  const card = el('div', { class: 'card', style: 'padding:18px;display:flex;flex-direction:column;gap:10px;' });

  let nameInput, avatarInput, avatarPreviewWrap;
  if (!isLogin) {
    nameInput = el('input', { placeholder: 'Full name' });
    card.appendChild(nameInput);

    avatarInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
    avatarPreviewWrap = el('div', { style: 'display:flex;align-items:center;gap:10px;' });
    const preview = el('div', { class: 'avatar', style: 'width:44px;height:44px;' }, '?');
    avatarPreviewWrap.appendChild(preview);
    avatarPreviewWrap.appendChild(el('button', { type: 'button', class: 'btn btn-sm', onclick: () => avatarInput.click() }, 'Add profile picture'));
    avatarInput.addEventListener('change', () => {
      const f = avatarInput.files[0];
      if (!f) return;
      state.avatarFile = f;
      const reader = new FileReader();
      reader.onload = () => { preview.innerHTML = ''; preview.style.background = 'transparent'; const img = el('img', { src: reader.result, style: 'width:44px;height:44px;border-radius:50%;object-fit:cover;' }); preview.appendChild(img); };
      reader.readAsDataURL(f);
    });
    card.appendChild(avatarPreviewWrap);
    card.appendChild(avatarInput);
  }

  const emailInput = el('input', { type: 'email', placeholder: 'Email address', autocomplete: 'email' });
  const passInput = el('input', { type: 'password', placeholder: 'Password', autocomplete: isLogin ? 'current-password' : 'new-password' });
  card.appendChild(emailInput);
  card.appendChild(passInput);

  if (state.authError) card.appendChild(el('p', { class: 'error-text' }, state.authError));

  const submit = el('button', {
    class: 'btn btn-primary', style: 'width:100%;margin-top:4px;',
    onclick: () => submitAuth(isLogin, emailInput.value, passInput.value, nameInput && nameInput.value)
  }, isLogin ? 'Sign in' : 'Create account');
  card.appendChild(submit);

  wrap.appendChild(card);
  wrap.appendChild(el('p', {
    style: 'text-align:center;font-size:13px;color:var(--text2);margin-top:14px;cursor:pointer;',
    onclick: () => { state.authMode = isLogin ? 'register' : 'login'; state.authError = ''; state.avatarFile = null; render(); }
  }, isLogin ? "Don't have an account? Create one" : 'Already have an account? Sign in'));

  return wrap;
}

async function submitAuth(isLogin, email, password, name) {
  state.authError = '';
  if (!email || !password || (!isLogin && !name)) { state.authError = 'Please fill in all fields.'; render(); return; }
  try {
    let data;
    if (isLogin) {
      data = await api('/login', { method: 'POST', body: { email, password } });
    } else {
      const fd = new FormData();
      fd.append('email', email); fd.append('password', password); fd.append('name', name);
      if (state.avatarFile) fd.append('avatar', state.avatarFile);
      const res = await fetch('/api/register', { method: 'POST', body: fd, credentials: 'same-origin' });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
    }
    state.user = data.user;
    connectSocket(data.socketToken);
    await afterLogin();
  } catch (e) {
    state.authError = e.message;
    render();
  }
}

function pendingScreen() {
  return el('div', { class: 'card', style: 'padding:1.75rem;margin-top:3rem;text-align:center;max-width:360px;margin-left:auto;margin-right:auto;' }, [
    el('div', { style: 'font-size:32px;margin-bottom:.5rem;' }, '⏳'),
    el('p', { style: 'font-size:16px;font-weight:600;' }, 'Waiting for approval'),
    el('p', { style: 'font-size:14px;color:var(--text2);margin-top:6px;' }, "The group admin needs to approve your request before you can join."),
    el('button', { class: 'btn', style: 'margin-top:14px;', onclick: logout }, 'Log out')
  ]);
}
function msgScreen(text) {
  return el('div', { class: 'card', style: 'padding:1.75rem;margin-top:3rem;text-align:center;max-width:360px;margin-left:auto;margin-right:auto;' }, [
    el('p', { style: 'font-size:15px;' }, text),
    el('button', { class: 'btn', style: 'margin-top:14px;', onclick: logout }, 'Log out')
  ]);
}

async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch (e) {}
  if (state.socket) state.socket.disconnect();
  state = Object.assign(state, { user: null, members: [], messages: [], files: [], peers: [], socket: null });
  render();
}

// ---------- LAYOUT ----------
function header() {
  return el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;' }, [
    el('div', {}, [
      el('p', { style: 'font-size:18px;font-weight:700;margin:0;' }, 'Study group'),
      el('p', { style: 'font-size:12px;color:var(--text2);margin:0;' }, state.peers.length + ' online')
    ]),
    el('div', { style: 'display:flex;align-items:center;gap:8px;' }, [
      avatarEl(state.user, 32),
      el('button', { class: 'btn btn-sm', onclick: logout }, 'Log out')
    ])
  ]);
}

function tabsBar() {
  const items = [['chat', 'Chat'], ['files', 'Files'], ['call', 'Call']];
  if (state.user.status === 'admin') items.push(['admin', 'Admin']);
  const wrap = el('div', { style: 'display:flex;gap:16px;border-bottom:1px solid var(--border);margin-bottom:12px;' });
  items.forEach(([id, label]) => {
    const t = el('div', { class: 'tab' + (state.tab === id ? ' active' : ''), onclick: () => { state.tab = id; render(); } }, label);
    if (id === 'admin') {
      const pending = state.members.filter(m => m.status === 'pending').length;
      if (pending) t.appendChild(el('span', { class: 'pill', style: 'background:var(--danger);color:#fff;margin-left:5px;' }, String(pending)));
    }
    wrap.appendChild(t);
  });
  return wrap;
}

// ---------- CHAT ----------
function chatView() {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;' });
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:10px;max-height:56vh;overflow-y:auto;padding:4px 2px;' });
  state.messages.forEach(m => {
    const mine = m.authorId === state.user.id;
    const row = el('div', { style: 'display:flex;gap:8px;align-items:flex-end;flex-direction:' + (mine ? 'row-reverse' : 'row') + ';' }, [
      avatarEl({ name: m.authorName, avatar: m.authorAvatar }, 26),
      el('div', { style: 'max-width:75%;' }, [
        !mine ? el('p', { style: 'font-size:11px;color:var(--text2);margin:0 0 2px 4px;' }, m.authorName) : null,
        el('div', { class: 'card', style: 'padding:.5rem .75rem;background:' + (mine ? 'var(--accent2)' : 'var(--card)') + ';border-radius:14px;' },
          el('p', { style: 'font-size:14px;margin:0;white-space:pre-wrap;word-break:break-word;' }, m.text))
      ])
    ]);
    list.appendChild(row);
  });
  if (!state.messages.length) list.appendChild(el('p', { style: 'color:var(--text2);font-size:13px;text-align:center;margin-top:2rem;' }, 'No messages yet. Say hello!'));
  wrap.appendChild(list);

  const inputRow = el('div', { style: 'display:flex;gap:8px;margin-top:10px;' });
  const input = el('input', { placeholder: 'Type a message…' });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  function send() {
    const text = input.value.trim();
    if (!text) return;
    state.socket.emit('chat:send', text);
    input.value = '';
  }
  inputRow.appendChild(input);
  inputRow.appendChild(el('button', { class: 'btn btn-primary', onclick: send }, 'Send'));
  wrap.appendChild(inputRow);
  setTimeout(() => { list.scrollTop = list.scrollHeight; }, 0);
  return wrap;
}

// ---------- FILES ----------
function filesView() {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });
  const fileInput = el('input', { type: 'file', style: 'display:none;' });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); });
  wrap.appendChild(el('div', { class: 'card', style: 'padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;' }, [
    el('p', { style: 'font-size:13px;color:var(--text2);margin:0;' }, 'Share a file with the group (up to 50MB)'),
    el('button', { class: 'btn btn-primary', onclick: () => fileInput.click() }, 'Upload'),
    fileInput
  ]));

  if (!state.files.length) wrap.appendChild(el('p', { style: 'color:var(--text2);font-size:13px;text-align:center;margin-top:1rem;' }, 'No files shared yet.'));
  state.files.forEach(f => {
    wrap.appendChild(el('div', { class: 'card', style: 'padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;' }, [
      el('div', { style: 'min-width:0;flex:1;' }, [
        el('p', { style: 'font-size:14px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, f.name),
        el('p', { style: 'font-size:11px;color:var(--text2);margin:0;' }, f.uploadedBy + ' · ' + formatSize(f.size))
      ]),
      el('div', { style: 'display:flex;gap:6px;flex-shrink:0;' }, [
        el('a', { class: 'btn btn-sm', href: '/api/files/' + f.id + '/view', target: '_blank' }, 'View'),
        el('a', { class: 'btn btn-sm', href: '/api/files/' + f.id + '/download' }, 'Download')
      ])
    ]));
  });
  return wrap;
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/files', { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
  } catch (e) { alert(e.message); }
}

// ---------- CALL ----------
function callView() {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:12px;' });

  if (state.call.active) {
    wrap.appendChild(el('div', { class: 'card', style: 'padding:10px;' }, [
      el('p', { style: 'font-size:13px;font-weight:600;margin:0 0 8px;' }, (state.call.type === 'video' ? 'Video' : 'Audio') + ' call with ' + state.call.withName),
      el('video', { id: 'remoteVideo', autoplay: '', playsinline: '', style: 'width:100%;border-radius:10px;background:#000;max-height:240px;object-fit:cover;' }),
      el('video', { id: 'localVideo', autoplay: '', playsinline: '', muted: '', style: 'width:110px;border-radius:8px;background:#000;margin-top:8px;' }),
      el('div', { style: 'margin-top:10px;' }, el('button', { class: 'btn btn-danger', onclick: endCall }, 'End call'))
    ]));
    return wrap;
  }

  wrap.appendChild(el('p', { style: 'font-size:13px;color:var(--text2);' }, 'Members currently online can be called directly. Calls are peer-to-peer.'));
  const online = state.peers.filter(p => p.id !== state.user.id);
  if (!online.length) wrap.appendChild(el('p', { style: 'color:var(--text2);font-size:13px;text-align:center;margin-top:1rem;' }, 'No other members online right now.'));
  online.forEach(p => {
    wrap.appendChild(el('div', { class: 'card', style: 'padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;' }, [
      el('div', { style: 'display:flex;align-items:center;gap:8px;min-width:0;' }, [
        avatarEl(p, 30),
        el('p', { style: 'font-size:14px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, p.name)
      ]),
      el('div', { style: 'display:flex;gap:6px;flex-shrink:0;' }, [
        el('button', { class: 'btn btn-sm', onclick: () => startCall(p, 'audio') }, 'Audio'),
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => startCall(p, 'video') }, 'Video')
      ])
    ]));
  });

  if (state.call.incoming) {
    wrap.appendChild(el('div', { class: 'card', style: 'padding:12px;border-color:var(--accent);' }, [
      el('p', { style: 'font-size:14px;font-weight:600;margin:0;' }, (state.call.incoming.callType === 'video' ? 'Video' : 'Audio') + ' call from ' + state.call.incoming.fromName),
      el('div', { style: 'display:flex;gap:8px;margin-top:8px;' }, [
        el('button', { class: 'btn btn-primary', onclick: acceptCall }, 'Accept'),
        el('button', { class: 'btn btn-danger', onclick: declineCall }, 'Decline')
      ])
    ]));
  }
  return wrap;
}

function iceConfig() { return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }; }

async function startCall(peer, type) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(type === 'video' ? { video: true, audio: true } : { audio: true });
    const pc = new RTCPeerConnection(iceConfig());
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.ontrack = e => setTimeout(() => { const v = document.getElementById('remoteVideo'); if (v) v.srcObject = e.streams[0]; }, 50);
    pc.onicecandidate = e => { if (e.candidate) state.socket.emit('call:ice', { to: peer.id, candidate: e.candidate }); };
    state.call = { active: true, withId: peer.id, withName: peer.name, type, pc, localStream: stream, incoming: null };
    render();
    setTimeout(() => { const lv = document.getElementById('localVideo'); if (lv) lv.srcObject = stream; }, 50);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    state.socket.emit('call:offer', { to: peer.id, sdp: offer, callType: type });
  } catch (e) { alert('Could not start the call. Check camera/microphone permission.'); }
}

async function acceptCall() {
  const inc = state.call.incoming;
  if (!inc) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(inc.callType === 'video' ? { video: true, audio: true } : { audio: true });
    const pc = new RTCPeerConnection(iceConfig());
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.ontrack = e => setTimeout(() => { const v = document.getElementById('remoteVideo'); if (v) v.srcObject = e.streams[0]; }, 50);
    pc.onicecandidate = e => { if (e.candidate) state.socket.emit('call:ice', { to: inc.from, candidate: e.candidate }); };
    await pc.setRemoteDescription(new RTCSessionDescription(inc.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.call = { active: true, withId: inc.from, withName: inc.fromName, type: inc.callType, pc, localStream: stream, incoming: null };
    render();
    setTimeout(() => { const lv = document.getElementById('localVideo'); if (lv) lv.srcObject = stream; }, 50);
    state.socket.emit('call:answer', { to: inc.from, sdp: answer });
  } catch (e) { alert('Could not join the call.'); }
}

function declineCall() {
  if (state.call.incoming) state.socket.emit('call:end', { to: state.call.incoming.from });
  state.call.incoming = null; render();
}
function endCall() {
  if (state.call.pc) { try { state.call.pc.close(); } catch (e) {} }
  if (state.call.localStream) state.call.localStream.getTracks().forEach(t => t.stop());
  if (state.call.withId) state.socket.emit('call:end', { to: state.call.withId });
  state.call = { active: false, incoming: null, withId: null, withName: null, type: null, pc: null, localStream: null };
  render();
}

// ---------- ADMIN ----------
function adminView() {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:14px;' });
  const pending = state.members.filter(m => m.status === 'pending');
  const approved = state.members.filter(m => m.status === 'approved' || m.status === 'admin');

  wrap.appendChild(el('p', { style: 'font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;' }, 'Pending requests (' + pending.length + ')'));
  if (!pending.length) wrap.appendChild(el('p', { style: 'font-size:13px;color:var(--text2);' }, 'No pending requests.'));
  pending.forEach(m => {
    wrap.appendChild(el('div', { class: 'card', style: 'padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;' }, [
      el('div', { style: 'display:flex;align-items:center;gap:8px;' }, [avatarEl(m, 28), el('div', {}, [
        el('p', { style: 'font-size:14px;font-weight:600;margin:0;' }, m.name),
        el('p', { style: 'font-size:11px;color:var(--text2);margin:0;' }, m.email)
      ])]),
      el('div', { style: 'display:flex;gap:6px;' }, [
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => setStatus(m.id, 'approved') }, 'Approve'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => setStatus(m.id, 'rejected') }, 'Reject')
      ])
    ]));
  });

  wrap.appendChild(el('p', { style: 'font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-top:6px;' }, 'Group members (' + approved.length + ')'));
  approved.forEach(m => {
    wrap.appendChild(el('div', { class: 'card', style: 'padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;' }, [
      el('div', { style: 'display:flex;align-items:center;gap:8px;' }, [avatarEl(m, 28), el('div', {}, [
        el('p', { style: 'font-size:14px;font-weight:600;margin:0;' }, m.name),
        el('p', { style: 'font-size:11px;color:var(--text2);margin:0;' }, m.status === 'admin' ? 'Admin' : m.email)
      ])]),
      m.status !== 'admin' ? el('button', { class: 'btn btn-sm', onclick: () => setStatus(m.id, 'removed') }, 'Remove') : null
    ]));
  });
  return wrap;
}
async function setStatus(id, status) {
  try { await api('/members/' + id + '/status', { method: 'POST', body: { status } }); await loadMembers(); } catch (e) { alert(e.message); }
}

// ---------- data loading / sockets ----------
async function loadMembers() { try { const d = await api('/members'); state.members = d.members; render(); } catch (e) {} }
async function loadMessages() { try { const d = await api('/messages'); state.messages = d.messages; render(); } catch (e) {} }
async function loadFiles() { try { const d = await api('/files'); state.files = d.files; render(); } catch (e) {} }

function connectSocket(token) {
  state.socket = io({ auth: { token } });
  state.socket.on('chat:message', m => { state.messages.push(m); render(); });
  state.socket.on('presence:update', list => { state.peers = list; render(); });
  state.socket.on('members:changed', loadMembers);
  state.socket.on('files:changed', loadFiles);
  state.socket.on('call:offer', data => {
    if (state.call.active) { state.socket.emit('call:end', { to: data.from }); return; }
    state.call.incoming = data; render();
  });
  state.socket.on('call:answer', data => { if (state.call.pc) state.call.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); });
  state.socket.on('call:ice', data => { if (state.call.pc) state.call.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {}); });
  state.socket.on('call:end', data => {
    if (state.call.active && state.call.withId === data.from) endCall();
    else if (state.call.incoming && state.call.incoming.from === data.from) { state.call.incoming = null; render(); }
  });
}

async function afterLogin() {
  await Promise.all([loadMembers(), loadMessages(), loadFiles()]);
  render();
}

async function init() {
  try {
    const d = await api('/me');
    state.user = d.user;
    if (state.user) {
      // need a fresh socket token: re-login flow not required, issue via a lightweight endpoint
      const t = await api('/login-token', { method: 'POST' }).catch(() => null);
      if (t && t.socketToken) connectSocket(t.socketToken);
      await afterLogin();
    }
  } catch (e) {}
  state.loading = false;
  render();
}

init();
