'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
// Mot de passe de la régie : fixé par ADMIN_PASSWORD, sinon généré à chaque démarrage et affiché dans la console.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(3).toString('hex');
// 0 = jamais d'expiration. Sinon, un code inactif depuis N minutes est libéré.
const IDLE_MINUTES = Number(process.env.IDLE_MINUTES) || 0;
const GRACE_MS = 10000; // délai pour se reconnecter avant de libérer un code
const CODE_RE = /^\d{2}$/;
const PUBLIC_DIR = path.join(__dirname, 'public');
const JOKES_FILE = path.join(__dirname, 'jokes.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const remoteNs = io.of('/remote');

/** code -> { socketId, clientId, kind, since, lastActivity, online, fullscreen, timer } */
const receivers = new Map();

/* ---------- Utilitaires ---------- */

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

function baseUrlFor(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const hostHeader = req.get('host') || `localhost:${PORT}`;
  const hostname = hostHeader.replace(/:\d+$/, '');
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    const ip = lanAddresses()[0];
    if (ip) return `${req.protocol}://${ip}:${PORT}`;
  }
  return `${req.protocol}://${hostHeader}`;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const hb = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Anti brute-force sur le mot de passe de la régie : 5 échecs => blocage 1 minute par IP.
const failures = new Map();
function isBlocked(ip) {
  const f = failures.get(ip);
  return !!f && f.until > Date.now();
}
function registerFailure(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= 5) {
    f.until = Date.now() + 60000;
    f.count = 0;
  }
  failures.set(ip, f);
}

/* ---------- Validation des blagues ---------- */

const JOKE_TYPES = new Set([
  'text', 'typewriter', 'countdown', 'loading', 'runaway',
  'shake', 'flip', 'confetti', 'blackout', 'clear',
]);
const SOUNDS = new Set(['horn', 'sad', 'ding', 'boing']);

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const color = (v) =>
  typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/.test(v) ? v : undefined;

function sanitize(j) {
  if (!j || typeof j !== 'object' || !JOKE_TYPES.has(j.type)) return null;
  return {
    type: j.type,
    text: str(j.text, 500),
    final: str(j.final, 300),
    button: str(j.button, 40),
    emoji: str(j.emoji, 8),
    bg: color(j.bg),
    fg: color(j.fg),
    size: num(j.size, 1, 40), // en vmin
    seconds: num(j.seconds, 1, 120),
    from: num(j.from, 1, 30),
    speed: num(j.speed, 10, 500), // ms par lettre
    duration: num(j.duration, 0, 3600), // 0 = reste affiché jusqu'à la prochaine commande
    sound: SOUNDS.has(j.sound) ? j.sound : undefined,
    vibrate: j.vibrate === true ? true : undefined,
    confetti: j.confetti === true ? true : undefined,
    steps: Array.isArray(j.steps)
      ? j.steps.slice(0, 12).map((s) => str(s, 120)).filter(Boolean)
      : undefined,
  };
}

/* ---------- Registre des récepteurs ---------- */

function listReceivers() {
  return [...receivers.entries()]
    .map(([code, r]) => ({
      code,
      kind: r.kind,
      online: r.online,
      fullscreen: r.fullscreen,
      since: r.since,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function broadcast() {
  remoteNs.emit('receivers', listReceivers());
}

function release(code, reason) {
  const r = receivers.get(code);
  if (!r) return;
  clearTimeout(r.timer);
  receivers.delete(code);
  const s = io.sockets.sockets.get(r.socketId);
  if (s) {
    s.data.code = null;
    if (reason) s.emit('kick', reason);
  }
  broadcast();
}

/* ---------- Côté récepteur (PC ou smartphone) ---------- */

io.on('connection', (socket) => {
  socket.on('join', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const code = data && typeof data.code === 'string' ? data.code : '';
    const clientId =
      data && typeof data.clientId === 'string' ? data.clientId.slice(0, 64) : '';
    const kind = data && data.kind === 'mobile' ? 'mobile' : 'pc';

    if (!CODE_RE.test(code) || !clientId) return reply({ ok: false, error: 'invalid' });

    const cur = receivers.get(code);
    // Un code = un seul récepteur. Seul le même navigateur (même clientId) peut le reprendre.
    if (cur && cur.clientId !== clientId) return reply({ ok: false, error: 'occupied' });

    if (cur) {
      clearTimeout(cur.timer);
      if (cur.socketId !== socket.id) {
        const old = io.sockets.sockets.get(cur.socketId);
        if (old) {
          old.data.code = null;
          old.disconnect(true);
        }
      }
    }
    if (socket.data.code && socket.data.code !== code) release(socket.data.code);

    receivers.set(code, {
      socketId: socket.id,
      clientId,
      kind,
      since: cur ? cur.since : Date.now(),
      lastActivity: Date.now(),
      online: true,
      fullscreen: false,
      timer: null,
    });
    socket.data.code = code;
    broadcast();
    reply({ ok: true });
  });

  socket.on('state', (s) => {
    const r = receivers.get(socket.data.code);
    if (r && r.socketId === socket.id) {
      r.fullscreen = !!(s && s.fullscreen);
      broadcast();
    }
  });

  socket.on('leave', () => {
    const code = socket.data.code;
    if (code) {
      socket.data.code = null;
      release(code);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (!code) return;
    const r = receivers.get(code);
    if (!r || r.socketId !== socket.id) return;
    r.online = false;
    r.timer = setTimeout(() => release(code), GRACE_MS);
    broadcast();
  });
});

/* ---------- Côté régie (protégé par mot de passe) ---------- */

remoteNs.use((socket, next) => {
  const ip = socket.handshake.address;
  if (isBlocked(ip)) return next(new Error('blocked'));
  const password = socket.handshake.auth && socket.handshake.auth.password;
  if (safeEqual(password, ADMIN_PASSWORD)) return next();
  registerFailure(ip);
  return next(new Error('unauthorized'));
});

remoteNs.on('connection', (socket) => {
  socket.emit('receivers', listReceivers());

  socket.on('send', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const joke = sanitize(data && data.joke);
    if (!joke) return reply({ ok: false, error: 'invalid-joke' });

    const target = data && data.code != null ? String(data.code) : '';
    const targets =
      target === 'all'
        ? [...receivers.values()].filter((r) => r.online)
        : [receivers.get(target)].filter((r) => r && r.online);
    if (!targets.length) return reply({ ok: false, error: 'no-receiver' });

    for (const r of targets) {
      io.to(r.socketId).emit('joke', joke);
      r.lastActivity = Date.now();
    }
    return reply({ ok: true, count: targets.length });
  });

  socket.on('release', (code, ack) => {
    release(String(code), 'released');
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('free-code', (ack) => {
    if (typeof ack !== 'function') return;
    const free = [];
    for (let i = 0; i < 100; i += 1) {
      const c = String(i).padStart(2, '0');
      if (!receivers.has(c)) free.push(c);
    }
    ack({ code: free.length ? free[Math.floor(Math.random() * free.length)] : null });
  });
});

if (IDLE_MINUTES > 0) {
  setInterval(() => {
    const limit = Date.now() - IDLE_MINUTES * 60000;
    for (const [code, r] of receivers) {
      if (r.lastActivity < limit) release(code, 'expired');
    }
  }, 60000).unref();
}

/* ---------- HTTP ---------- */

app.disable('x-powered-by');

function sendPage(res, file) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  res.sendFile(path.join(PUBLIC_DIR, file));
}

app.get('/', (req, res) => sendPage(res, 'receiver.html'));
app.get('/remote', (req, res) => sendPage(res, 'remote.html'));
app.get('/r/:code', (req, res) => {
  if (!CODE_RE.test(req.params.code)) return res.status(404).send('Not found');
  return sendPage(res, 'receiver.html');
});

app.get('/api/jokes', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(JSON.parse(fs.readFileSync(JOKES_FILE, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: 'jokes.json illisible : ' + err.message });
  }
});

app.get('/api/url/:code', (req, res) => {
  if (!CODE_RE.test(req.params.code)) return res.status(400).json({ error: 'invalid' });
  return res.json({ url: `${baseUrlFor(req)}/r/${req.params.code}` });
});

app.get('/qr/:code', async (req, res) => {
  if (!CODE_RE.test(req.params.code)) return res.status(400).send('invalid');
  try {
    const svg = await QRCode.toString(`${baseUrlFor(req)}/r/${req.params.code}`, {
      type: 'svg',
      margin: 2,
    });
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-store');
    return res.send(svg);
  } catch (err) {
    return res.status(500).send('QR error');
  }
});

app.use(express.static(PUBLIC_DIR, { index: false }));

server.listen(PORT, () => {
  const ips = lanAddresses();
  const host = ips[0] || 'localhost';
  console.log('QrJoke démarré');
  console.log(`  Récepteur (PC / à ouvrir sur l'écran) : http://${host}:${PORT}/`);
  console.log(`  Régie (ton backend)                  : http://${host}:${PORT}/remote`);
  console.log(`  Mot de passe régie                   : ${ADMIN_PASSWORD}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('  (généré au hasard, définis ADMIN_PASSWORD pour le fixer)');
  }
});
