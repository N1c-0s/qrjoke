/*
 * QrJoke : protocole MQTT léger, partagé par le récepteur, la régie et les tests.
 *
 * Le broker est public et sans compte. L'appairage se fait avec un code à 2 chiffres :
 *   - un code = un seul écran (les 100 codes se devinent, donc le premier arrivé garde la place) ;
 *   - l'écran s'annonce (présence) sur le code ; la régie voit la liste des écrans par code ;
 *   - la régie envoie ses blagues à un code ou à tous les écrans.
 * Les écrans valident chaque blague reçue (liste blanche, valeurs bornées, texte seul) :
 * au pire, quelqu'un qui enverrait sur le bon code pourrait afficher un message.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QrJokeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
  const ID_RE = /^[a-z0-9]{4,12}$/;
  const CODE_RE = /^\d{2}$/;
  const DEFAULT_ROOM = 'qrjoke-main';
  const JOIN_WAIT_MS = 600; // vérification du code en arrière-plan : l'écran démarre sans attendre
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
    'shake', 'flip', 'confetti', 'blackout', 'oserror', 'image', 'trap', 'voice', 'clear',
  ]);
  const OS_CHOICES = new Set(['auto', 'windows', 'mac', 'android', 'iphone']);
  const TRAP_KINDS = new Set(['shrink', 'swap', 'fakeclick']);
  const SOUNDS = new Set(['horn', 'sad', 'ding', 'boing']);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
  };
  // Photo : uniquement une image JPEG/PNG/WebP en data URL, taille bornée (le broker refuse les gros messages).
  const IMAGE_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
  const MAX_IMAGE = 400000;
  const image = (v) => (typeof v === 'string' && v.length <= MAX_IMAGE && IMAGE_RE.test(v) ? v : undefined);
  // Message vocal : enregistré dans la régie, joué sur l'écran. Même logique que la photo (taille bornée).
  const AUDIO_RE = /^data:audio\/(webm|ogg|mp4|mpeg|wav);base64,[A-Za-z0-9+/]+={0,2}$/;
  const MAX_AUDIO = 400000;
  const audio = (v) => (typeof v === 'string' && v.length <= MAX_AUDIO && AUDIO_RE.test(v) ? v : undefined);
  const color = (v) =>
    typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/.test(v) ? v : undefined;

  function sanitize(j) {
    if (!j || typeof j !== 'object' || !JOKE_TYPES.has(j.type)) return null;
    return {
      type: j.type,
      text: str(j.text, 500),
      final: str(j.final, 300),
      button: str(j.button, 40),
      button2: str(j.button2, 40),
      emoji: str(j.emoji, 8),
      bg: color(j.bg),
      fg: color(j.fg),
      size: num(j.size, 1, 40),
      seconds: num(j.seconds, 1, 120),
      from: num(j.from, 1, 30),
      speed: num(j.speed, 10, 500),
      duration: num(j.duration, 0, 3600),
      os: OS_CHOICES.has(j.os) ? j.os : undefined,
      trap: TRAP_KINDS.has(j.trap) ? j.trap : undefined,
      audio: audio(j.audio),
      image: image(j.image),
      sound: SOUNDS.has(j.sound) ? j.sound : undefined,
      vibrate: j.vibrate === true ? true : undefined,
      confetti: j.confetti === true ? true : undefined,
      steps: Array.isArray(j.steps)
        ? j.steps.slice(0, 12).map((s) => str(s, 120)).filter(Boolean)
        : undefined,
    };
  }

  /* ---------- Détection du système de l'écran ---------- */

  /** env = { ua, maxTouchPoints } -> 'windows' | 'mac' | 'android' | 'iphone' | 'other' */
  function detectOS(env) {
    const ua = String((env && env.ua) || '');
    const touch = Number(env && env.maxTouchPoints) || 0;
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iphone';
    if (/Android/i.test(ua)) return 'android';
    if (/Macintosh|Mac OS X/i.test(ua)) return touch > 1 ? 'iphone' : 'mac'; // un iPad se présente comme un Mac tactile
    if (/Windows/i.test(ua)) return 'windows';
    return 'other';
  }

  /** choice : 'auto' ou un système forcé par la régie ; detected : résultat de detectOS. */
  function resolveOS(choice, detected) {
    if (choice === 'windows' || choice === 'mac' || choice === 'android' || choice === 'iphone') return choice;
    return detected === 'other' ? 'windows' : detected; // Linux, ChromeOS... : écran bleu par défaut
  }

  /* ---------- Topics et liens ---------- */

  const topics = (room) => ({
    joke: (id) => `qrjoke/${room}/${id}/joke`,
    ctl: (id) => `qrjoke/${room}/${id}/ctl`,
    presence: (id) => `qrjoke/${room}/${id}/presence`,
    presenceAll: `qrjoke/${room}/+/presence`,
  });

  const roomQuery = (room) => (room && room !== DEFAULT_ROOM ? `?room=${room}` : '');
  const receiverUrl = (origin, code, room) => `${origin}/${code}${roomQuery(room)}`;
  const remoteUrl = (origin, room) => `${origin}/remote${roomQuery(room)}`;

  /* ---------- Récepteur (écran du PC ou du smartphone) ---------- */

  function createReceiver(opts) {
    const { mqtt, kind } = opts;
    const code = String(opts.code);
    const room = opts.room == null ? DEFAULT_ROOM : normRoom(opts.room);
    if (!room) throw new Error('salon invalide');
    if (!CODE_RE.test(code)) throw new Error('code invalide');
    const clientId = opts.clientId == null ? randomId(8) : String(opts.clientId);
    if (!ID_RE.test(clientId)) throw new Error('identifiant invalide');
    const joinWaitMs = opts.joinWaitMs == null ? JOIN_WAIT_MS : opts.joinWaitMs;
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
    let joining = false, joined = false, ended = false, fullscreen = false, occupied = false;

    const presenceData = () => ({
      type: 'presence', from: inst, code, clientId, kind: kind === 'mobile' ? 'mobile' : 'pc', label, fullscreen, since,
    });

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
      if (joined) await publish(T.presence(code), { type: 'bye', from: inst, code }, 1);
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
        const same = data.clientId === clientId;
        if (!joined) {
          if (!same) occupied = true; // un autre navigateur tient déjà ce code
          return;
        }
        if (same) {
          // Le même navigateur a rouvert la page ailleurs : la plus récente garde la place.
          if (data.since > since) yieldTo('taken');
        } else if (data.since < since || (data.since === since && String(data.clientId) < clientId)) {
          yieldTo('occupied'); // course entre deux écrans arrivés ensemble : le plus ancien gagne
        }
        return;
      }

      if (!joined) return;

      if (topic === T.ctl(code) || topic === T.ctl('all')) {
        if (data.type === 'who') sendPresence();
        else if (data.type === 'release' && topic === T.ctl(code)) { await leave(); onKick('released'); }
        return;
      }

      if (data.type === 'joke' && (topic === T.joke(code) || topic === T.joke('all'))) {
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
          const subs = [T.presence(code), T.joke(code), T.joke('all'), T.ctl(code), T.ctl('all')];
          client.subscribe(subs, { qos: 1 }, async (err) => {
            if (err) return fail('broker');
            if (ended) return undefined;
            // L'écran démarre tout de suite (aucune attente pour l'utilisateur) ; en arrière-plan,
            // on demande à l'éventuel occupant du code de se signaler avant de s'annoncer à la régie.
            clearTimeout(failTimer);
            settle({ ok: true });
            await publish(T.ctl(code), { type: 'who', from: inst }, 0);
            await new Promise((r) => setTimeout(r, joinWaitMs));
            if (ended) return undefined;
            if (occupied) { stop(); onKick('occupied'); return undefined; }
            joined = true;
            sendPresence();
            hb = setInterval(sendPresence, heartbeatMs);
            return undefined;
          });
        });
      });
    }

    return {
      code,
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
    const room = opts.room == null ? DEFAULT_ROOM : normRoom(opts.room);
    if (!room) throw new Error('salon invalide');
    const brokerUrl = opts.brokerUrl || DEFAULT_BROKER;
    const staleMs = opts.staleMs || STALE_MS;
    const onReceivers = opts.onReceivers || noop;
    const onStatus = opts.onStatus || noop;

    const T = topics(room);
    const prefix = `qrjoke/${room}/`;
    const inst = randomId(8);
    const peers = new Map(); // code -> { data, rx }
    let client = null, last = '', pruneTimer = null;

    function snapshot() {
      const now = Date.now();
      const out = [];
      for (const [code, p] of peers) {
        if (now - p.rx <= staleMs) {
          out.push({
            code, kind: p.data.kind, label: typeof p.data.label === 'string' ? p.data.label : '',
            fullscreen: !!p.data.fullscreen, since: p.data.since,
          });
        }
      }
      return out.sort((a, b) => (a.since || 0) - (b.since || 0) || a.code.localeCompare(b.code));
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
            if (parts.length !== 2 || parts[1] !== 'presence' || !CODE_RE.test(parts[0])) return;
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

      /** target : le code d'un écran, ou 'all'. */
      async send(target, joke) {
        const j = sanitize(joke);
        if (!j) return { ok: false, error: 'invalid-joke' };
        const snap = snapshot();
        let count;
        if (target === 'all') {
          count = snap.length;
          if (!count) return { ok: false, error: 'no-receiver' };
        } else if (CODE_RE.test(String(target))) {
          if (!snap.some((r) => r.code === target)) return { ok: false, error: 'no-receiver' };
          count = 1;
        } else {
          return { ok: false, error: 'invalid' };
        }
        await publish(T.joke(target), { type: 'joke', from: inst, joke: j });
        return { ok: true, count };
      },

      async release(code) {
        if (!CODE_RE.test(String(code))) return;
        await publish(T.ctl(code), { type: 'release', from: inst });
        peers.delete(code);
        emit();
      },

      /** Un code à 2 chiffres que aucun écran connecté n'utilise (null si les 100 sont pris). */
      freeCode() {
        const used = new Set(snapshot().map((r) => r.code));
        const free = [];
        for (let n = 0; n < 100; n += 1) { const c = String(n).padStart(2, '0'); if (!used.has(c)) free.push(c); }
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
    DEFAULT_BROKER, DEFAULT_ROOM, ID_RE, CODE_RE, ROOM_RE, STALE_MS, MAX_IMAGE, MAX_AUDIO,
    randomId, normRoom, sanitize, detectOS, resolveOS, receiverUrl, remoteUrl,
    createReceiver, createRemote,
  };
});
