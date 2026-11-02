/*
 * QrJoke : protocole MQTT léger, partagé par le récepteur, la régie et les tests.
 *
 * Le broker est public et il n'y a ni compte ni clé : tout est basé sur un nom de salon
 * (par défaut "qrjoke-main", modifiable avec ?room=monsalon) et un code à 2 chiffres.
 * Les écrans valident chaque blague reçue (liste blanche, valeurs bornées, texte seul),
 * donc au pire un inconnu qui devine le salon et le code pourrait afficher un message.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QrJokeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
  const DEFAULT_ROOM = 'qrjoke-main';
  const CODE_RE = /^\d{2}$/;
  const ROOM_RE = /^[A-Za-z0-9_-]{1,32}$/;
  const HEARTBEAT_MS = 10000; // un écran signale sa présence toutes les 10 s
  const STALE_MS = 25000; // sans signe de vie depuis 25 s, il disparaît de la régie
  const JOIN_WAIT_MS = 1500; // temps d'écoute avant de prendre un code

  const noop = () => {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normRoom = (r) => (typeof r === 'string' && ROOM_RE.test(r) ? r : DEFAULT_ROOM);

  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  function randomId(len) {
    let out = '';
    for (let i = 0; i < (len || 10); i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return out;
  }

  const pack = (data) => JSON.stringify(data);
  function unpack(raw) {
    try {
      const d = JSON.parse(String(raw));
      return d && typeof d === 'object' && typeof d.type === 'string' ? d : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------- Validation des blagues (le récepteur ne fait confiance à personne) ---------- */

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
      size: num(j.size, 1, 40),
      seconds: num(j.seconds, 1, 120),
      from: num(j.from, 1, 30),
      speed: num(j.speed, 10, 500),
      duration: num(j.duration, 0, 3600),
      sound: SOUNDS.has(j.sound) ? j.sound : undefined,
      vibrate: j.vibrate === true ? true : undefined,
      confetti: j.confetti === true ? true : undefined,
      steps: Array.isArray(j.steps)
        ? j.steps.slice(0, 12).map((s) => str(s, 120)).filter(Boolean)
        : undefined,
    };
  }

  /* ---------- Topics et liens ---------- */

  const topics = (room) => ({
    joke: (code) => `qrjoke/${room}/${code}/joke`,
    ctl: (code) => `qrjoke/${room}/${code}/ctl`,
    presence: (code) => `qrjoke/${room}/${code}/presence`,
    presenceAll: `qrjoke/${room}/+/presence`,
  });

  const receiverUrl = (origin, room) =>
    room && room !== DEFAULT_ROOM ? `${origin}/?room=${room}` : `${origin}/`;
  const joinUrl = (origin, code, room) =>
    room && room !== DEFAULT_ROOM ? `${origin}/r/${code}?room=${room}` : `${origin}/r/${code}`;

  /* ---------- Récepteur (écran du PC ou du smartphone) ---------- */

  function createReceiver(opts) {
    const { mqtt, code, clientId, kind } = opts;
    const room = normRoom(opts.room);
    const brokerUrl = opts.brokerUrl || DEFAULT_BROKER;
    const heartbeatMs = opts.heartbeatMs || HEARTBEAT_MS;
    const joinWaitMs = opts.joinWaitMs || JOIN_WAIT_MS;
    const onJoke = opts.onJoke || noop;
    const onKick = opts.onKick || noop;
    const onStatus = opts.onStatus || noop;

    const T = topics(room);
    const inst = randomId(8); // identifie cette page précise
    const since = Date.now();
    let client = null, hb = null, failTimer = null;
    let joining = false, joined = false, ended = false, fullscreen = false, occupied = false;

    const presenceData = () => ({ type: 'presence', from: inst, clientId, kind, fullscreen, since });

    function publish(topic, data, qos) {
      if (!client) return Promise.resolve();
      return new Promise((resolve) => {
        const t = setTimeout(resolve, 2000);
        client.publish(topic, pack(data), { qos: qos == null ? 1 : qos }, () => { clearTimeout(t); resolve(); });
      });
    }

    function sendPresence() {
      if (joined && !ended) publish(T.presence(code), presenceData(), 0);
    }

    function stop() {
      ended = true;
      clearInterval(hb);
      clearTimeout(failTimer);
      if (client) { try { client.end(true); } catch (e) { /* rien */ } }
    }

    async function leave() {
      if (ended) return;
      if (joined) await publish(T.presence(code), { type: 'bye', from: inst, clientId }, 1);
      joined = false;
      stop();
    }

    function yieldTo(reason) {
      if (ended) return;
      joined = false;
      stop();
      onKick(reason);
    }

    async function handle(topic, payload) {
      const data = unpack(payload.toString());
      if (!data || data.from === inst || ended) return;

      if (topic === T.presence(code)) {
        if (data.type !== 'presence') return;
        if (!joined) {
          if (data.clientId !== clientId) occupied = true; // un autre appareil tient déjà ce code
        } else if (data.clientId !== clientId) {
          // Deux appareils ont pris le code en même temps : le plus ancien le garde.
          if (data.since < since || (data.since === since && data.clientId < clientId)) yieldTo('occupied');
        } else if (data.since > since) {
          yieldTo('taken'); // le même navigateur a rouvert la page ailleurs
        }
        return;
      }

      if (topic === T.ctl(code) || topic === T.ctl('all')) {
        if (!joined) return;
        if (data.type === 'who') sendPresence();
        else if (data.type === 'release') { await leave(); onKick('released'); }
        return;
      }

      if (joined && data.type === 'joke' && (topic === T.joke(code) || topic === T.joke('all'))) {
        const j = sanitize(data.joke);
        if (j) onJoke(j);
      }
    }

    function start() {
      return new Promise((resolve) => {
        let settled = false;
        const settle = (r) => { if (!settled) { settled = true; resolve(r); } };
        const fail = (error) => { settle({ ok: false, error }); stop(); };

        client = mqtt.connect(brokerUrl, {
          clientId: 'qj_' + inst + randomId(6),
          clean: true,
          keepalive: 30,
          reconnectPeriod: 2000,
          connectTimeout: 8000,
        });
        failTimer = setTimeout(() => fail('broker'), 15000);
        client.on('error', noop);
        client.on('offline', () => onStatus('offline'));
        client.on('reconnect', () => onStatus('reconnecting'));
        client.on('message', (topic, payload) => { handle(topic, payload).catch(noop); });

        client.on('connect', () => {
          onStatus('connected');
          if (joined) { sendPresence(); return; } // reconnexion : on se ré-annonce
          if (joining) return;
          joining = true;
          client.subscribe([T.presence(code), T.ctl(code)], { qos: 1 }, async (err) => {
            if (err) return fail('broker');
            publish(T.ctl(code), { type: 'who', from: inst });
            await sleep(joinWaitMs);
            if (ended) return;
            if (occupied) return fail('occupied');
            return client.subscribe([T.joke(code), T.joke('all'), T.ctl('all')], { qos: 1 }, (err2) => {
              if (err2) return fail('broker');
              if (ended) return;
              joined = true;
              clearTimeout(failTimer);
              sendPresence();
              hb = setInterval(sendPresence, heartbeatMs);
              return settle({ ok: true });
            });
          });
        });
      });
    }

    return {
      start,
      leave,
      setFullscreen(v) {
        const next = !!v;
        if (next !== fullscreen) { fullscreen = next; sendPresence(); }
      },
      get joined() { return joined; },
    };
  }

  /* ---------- Régie ---------- */

  function createRemote(opts) {
    const { mqtt } = opts;
    const room = normRoom(opts.room);
    const brokerUrl = opts.brokerUrl || DEFAULT_BROKER;
    const staleMs = opts.staleMs || STALE_MS;
    const onReceivers = opts.onReceivers || noop;
    const onStatus = opts.onStatus || noop;

    const T = topics(room);
    const presRe = new RegExp(`^qrjoke/${room}/(\\d{2})/presence$`);
    const inst = randomId(8);
    const peers = new Map(); // code -> { data, rx }
    let client = null, last = '', pruneTimer = null;

    function snapshot() {
      const now = Date.now();
      const out = [];
      for (const [code, p] of peers) {
        if (now - p.rx <= staleMs) {
          out.push({ code, kind: p.data.kind, online: true, fullscreen: !!p.data.fullscreen, since: p.data.since });
        }
      }
      return out.sort((a, b) => a.code.localeCompare(b.code));
    }
    function emit() {
      const s = snapshot();
      const sig = JSON.stringify(s);
      if (sig !== last) { last = sig; onReceivers(s); }
    }

    function publish(topic, data) {
      if (!client) return Promise.resolve();
      return new Promise((resolve) => {
        const t = setTimeout(resolve, 3000);
        client.publish(topic, pack(data), { qos: 1 }, () => { clearTimeout(t); resolve(); });
      });
    }

    const api = {
      connect() {
        return new Promise((resolve) => {
          let settled = false;
          const settle = (r) => { if (!settled) { settled = true; resolve(r); } };
          client = mqtt.connect(brokerUrl, {
            clientId: 'qjr_' + inst + randomId(6),
            clean: true,
            keepalive: 30,
            reconnectPeriod: 2000,
            connectTimeout: 8000,
          });
          const failTimer = setTimeout(() => { settle({ ok: false, error: 'broker' }); api.end(); }, 15000);
          client.on('error', noop);
          client.on('offline', () => onStatus('offline'));
          client.on('reconnect', () => onStatus('reconnecting'));
          client.on('connect', () => {
            onStatus('connected');
            client.subscribe(T.presenceAll, { qos: 1 }, (err) => {
              if (err) return;
              publish(T.ctl('all'), { type: 'who', from: inst }); // tous les écrans répondent
              clearTimeout(failTimer);
              settle({ ok: true });
            });
          });
          client.on('message', (topic, payload) => {
            const m = presRe.exec(topic);
            if (!m) return;
            const data = unpack(payload.toString());
            if (!data) return;
            if (data.type === 'bye') peers.delete(m[1]);
            else if (data.type === 'presence') peers.set(m[1], { data, rx: Date.now() });
            else return;
            emit();
          });
          pruneTimer = setInterval(emit, 5000);
        });
      },

      receivers: snapshot,

      async send(code, joke) {
        const j = sanitize(joke);
        if (!j) return { ok: false, error: 'invalid-joke' };
        const snap = snapshot();
        let count;
        if (code === 'all') {
          count = snap.length;
          if (!count) return { ok: false, error: 'no-receiver' };
        } else if (CODE_RE.test(String(code))) {
          if (!snap.some((r) => r.code === code)) return { ok: false, error: 'no-receiver' };
          count = 1;
        } else {
          return { ok: false, error: 'invalid' };
        }
        await publish(T.joke(code), { type: 'joke', from: inst, joke: j });
        return { ok: true, count };
      },

      async release(code) {
        if (!CODE_RE.test(String(code))) return;
        await publish(T.ctl(code), { type: 'release', from: inst });
        peers.delete(code);
        emit();
      },

      freeCode() {
        const used = new Set(snapshot().map((r) => r.code));
        const free = [];
        for (let i = 0; i < 100; i += 1) {
          const c = String(i).padStart(2, '0');
          if (!used.has(c)) free.push(c);
        }
        return free.length ? free[Math.floor(Math.random() * free.length)] : null;
      },

      end() {
        clearInterval(pruneTimer);
        if (client) { try { client.end(true); } catch (e) { /* rien */ } }
      },
    };
    return api;
  }

  return {
    DEFAULT_BROKER, DEFAULT_ROOM, CODE_RE, ROOM_RE, STALE_MS, JOIN_WAIT_MS,
    randomId, normRoom, sanitize, receiverUrl, joinUrl,
    createReceiver, createRemote,
  };
});
