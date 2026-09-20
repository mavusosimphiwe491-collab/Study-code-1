# Study Group

A self-hosted study group app with real email/password accounts, profile pictures,
admin approval, group text chat, file sharing, and peer-to-peer video/audio calls.

This is a real Node.js server + web app — it needs to run somewhere (your own
computer, or a small host like Render/Railway/a VPS) because true accounts and a
shared database can't run inside a sandboxed chat artifact.

## Setup

1. Install [Node.js](https://nodejs.org) (v18 or later) if you don't have it.
2. In this folder, install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
4. Open `http://localhost:3000` in your browser.

## How it works

- **First person to register becomes the admin automatically.** Everyone who
  registers after that lands in a "pending" state until the admin approves them
  from the **Admin** tab.
- Accounts are real: email + password (hashed with bcrypt) + name + an optional
  profile picture, stored in `data/db.json` and `data/avatars/`.
- **Chat** is a shared group text chat, saved to disk, delivered live via
  Socket.io.
- **Files**: any approved member can upload a file (up to 50MB); everyone can
  view it in the browser or download it.
- **Calls**: audio/video calling is real peer-to-peer WebRTC — the server only
  relays the connection setup ("signaling"). Both people need the page open at
  the same time; there's no recording or group calling.

## Making it reachable by your group

Running it on `localhost` only works on your own machine. To let your group log
in from their own devices, either:

- **Deploy it** to a small always-on host (Render, Railway, Fly.io, a cheap VPS,
  etc.) — point them at that URL instead of `localhost`. Most of these hosts
  will run `npm install && npm start` for you.
- **Run it on your own machine and expose it** temporarily with a tunnel tool
  such as `ngrok` (`ngrok http 3000`), useful for quick testing.

For anything beyond casual use, deploying it somewhere with HTTPS is strongly
recommended — right now sessions and passwords travel in plain HTTP unless your
host terminates TLS for you.

## Notes / limitations

- Data is stored in a single JSON file (`data/db.json`), which is fine for a
  small study group but not built for heavy concurrent load.
- There is no "forgot password" email flow — if the admin forgets their
  password, you'd currently need to edit `data/db.json` by hand.
- Uploaded files and avatars live in `data/uploads/` and `data/avatars/` on
  whatever machine runs the server — back that folder up if you care about the
  content.
