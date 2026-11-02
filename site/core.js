/*
 * QrJoke : protocole MQTT léger, partagé par le récepteur, la régie et les tests.
 *
 * Le broker est public et il n'y a ni compte, ni clé, ni code d'appairage :
 *   - la régie génère un nom de salon privé (ex. "k4x9ab2q") qu'elle met dans les liens ;
 *   - chaque écran qui ouvre un lien avec ce salon s'annonce tout seul (présence) ;
 *   - la régie voit la liste des écrans et envoie ses blagues à l'un d'eux ou à tous.
 * Les écrans valident chaque blague reçue (liste blanche, valeurs bornées, texte seul) :
 * au pire, quelqu'un qui devinerait le nom du salon pourrait afficher un message.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QrJokeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
  const ID_RE = /^[a-z0-9]{4,12}$/;
  const ROOM_RE = /^[A-Za-z0-9_-]{1,32}$/;
  const HEARTBEAT_MS = 10000; // un écran signale sa présence toutes les 10 s
  const STALE_MS = 25000; // sans signe de vie depuis 25 s, il disparaît de la régie

  const noop = () => {};

  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  function randomId(len) {
    let out = '';
    const n = len || 8;
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (c && c.getRandomValues) {
      const bytes = c.getRandomValues(new Uint8Array(n));
      for (const b of bytes) out += ALPHABET[b % 36];
    } else {
      for (let i = 0; i < n; i += 1) out += ALPHABET[Math.floor(Math.random() * 36)];
    }
    return out;
  }

  /** Renvoie le nom de salon en minuscules s'il est valide, sinon null. */
  function normRoom(r) {
    return typeof r === 'string' && ROOM_RE.test(r) ? r.toLowerCase() : null;
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
    joke: (id) => `qrjoke/${room}/${id}/joke`,
    ctl: (id) => `qrjoke/${room}/${id}/ctl`,
    presence: (id) => `qrjoke/${room}/${id}/presence`,
    presenceAll: `qrjoke/${room}/+/presence`,
  });

  const receiverUrl = (origin, room) => `${origin}/?room=${room}`;
  const remoteUrl = (origin, room) => `${origin}/remote?room=${room}`;

  /* ---------- Récepteur (écran du PC ou du smartphone) ---------- */

  function createReceiver(opts) {
    const { mqtt, id, kind } = opts;
    const room = normRoom(opts.room);
    if (!room) throw new Error('salon invalide');
    if (!ID_RE.test(String(id))) throw new Error('identifiant invalide');
    const label = typeof opts.label === 'string' ? opts.label.slice(0, 40) : '';
    const brokerUrl = opts.brokerUrl || DEFAULT_BROKER;
    const heartbeatMs = opts.heartbeatMs || HEARTBEAT_MS;
    const onJoke = opts.onJoke || noop;
    const onKick = opts.onKick || noop;
    const onStatus = opts.onStatus || noop;

    const T = topics(room);
    const inst = randomId(8); // identifie cette page précise
    const since = Date.now();
    let client = null, hb = null, failTimer = null;
    let joining = false, joined = false, ended = false, fullscreen = false;

    const presenceData = () => ({
      type: 'presence', from: inst, id, kind: kind === 'mobile' ? 'mobile' : 'pc', label, fullscreen, since,
    });

    function publish(topic, data, qos) {
      if (!client) return Promise.resolve();
      return new Promise((resolve) => {
        const t = setTimeout(resolve, 2000);
        client.publish(topic, pack(data), { qos: qos == null ? 1 : qos }, () => { clearTimeout(t); resolve(); });
      });
    }

    function sendPresence() {
      if (joined && !ended) publish(T.presence(id), presenceData(), 0);
    }

    function stop() {
      ended = true;
      clearInterval(hb);
      clearTimeout(failTimer);
      if (client) { try { client.end(true); } catch (e) { /* rien */ } }
    }

    async function leave() {
      if (ended) return;
      if (joined) await publish(T.presence(id), { type: 'bye', from: inst, id }, 1);
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
      if (!data || data.from === inst || ended || !joined) return;

      if (topic === T.presence(id)) {
        // Le même navigateur a rouvert la page ailleurs : la plus récente garde la place.
        if (data.type === 'presence' && data.id === id && data.since > since) yieldTo('taken');
        return;
      }

      if (topic === T.ctl(id) || topic === T.ctl('all')) {
        if (data.type === 'who') sendPresence();
        else if (data.type === 'release') { await leave(); onKick('released'); }
        return;
      }

      if (data.type === 'joke' && (topic === T.joke(id) || topic === T.joke('all'))) {
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
          const subs = [T.presence(id), T.joke(id), T.joke('all'), T.ctl(id), T.ctl('all')];
          client.subscribe(subs, { qos: 1 }, (err) => {
            if (err) return fail('broker');
            if (ended) return undefined;
            joined = true;
            clearTimeout(failTimer);
            sendPresence();
            hb = setInterval(sendPresence, heartbeatMs);
            return settle({ ok: true });
          });
        });
      });
    }

    return {
      id,
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
    if (!room) throw new Error('salon invalide');
    const brokerUrl = opts.brokerUrl || DEFAULT_BROKER;
    const staleMs = opts.staleMs || STALE_MS;
    const onReceivers = opts.onReceivers || noop;
    const onStatus = opts.onStatus || noop;

    const T = topics(room);
    const prefix = `qrjoke/${room}/`;
    const inst = randomId(8);
    const peers = new Map(); // id -> { data, rx }
    let client = null, last = '', pruneTimer = null;

    function snapshot() {
      const now = Date.now();
      const out = [];
      for (const [id, p] of peers) {
        if (now - p.rx <= staleMs) {
          out.push({
            id, kind: p.data.kind, label: typeof p.data.label === 'string' ? p.data.label : '',
            fullscreen: !!p.data.fullscreen, since: p.data.since,
          });
        }
      }
      return out.sort((a, b) => (a.since || 0) - (b.since || 0) || a.id.localeCompare(b.id));
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
            if (!topic.startsWith(prefix)) return;
            const parts = topic.slice(prefix.length).split('/');
            if (parts.length !== 2 || parts[1] !== 'presence' || !ID_RE.test(parts[0])) return;
            const data = unpack(payload.toString());
            if (!data) return;
            if (data.type === 'bye') peers.delete(parts[0]);
            else if (data.type === 'presence') peers.set(parts[0], { data, rx: Date.now() });
            else return;
            emit();
          });
          pruneTimer = setInterval(emit, 5000);
        });
      },

      receivers: snapshot,

      /** target : l'identifiant d'un écran, ou 'all'. */
      async send(target, joke) {
        const j = sanitize(joke);
        if (!j) return { ok: false, error: 'invalid-joke' };
        const snap = snapshot();
        let count;
        if (target === 'all') {
          count = snap.length;
          if (!count) return { ok: false, error: 'no-receiver' };
        } else if (ID_RE.test(String(target))) {
          if (!snap.some((r) => r.id === target)) return { ok: false, error: 'no-receiver' };
          count = 1;
        } else {
          return { ok: false, error: 'invalid' };
        }
        await publish(T.joke(target), { type: 'joke', from: inst, joke: j });
        return { ok: true, count };
      },

      async release(id) {
        if (!ID_RE.test(String(id))) return;
        await publish(T.ctl(id), { type: 'release', from: inst });
        peers.delete(id);
        emit();
      },

      end() {
        clearInterval(pruneTimer);
        if (client) { try { client.end(true); } catch (e) { /* rien */ } }
      },
    };
    return api;
  }

  return {
    DEFAULT_BROKER, ID_RE, ROOM_RE, STALE_MS,
    randomId, normRoom, sanitize, receiverUrl, remoteUrl,
    createReceiver, createRemote,
  };
});
