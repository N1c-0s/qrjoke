'use strict';

// Test de fumée : lance le serveur, simule un récepteur et une régie, vérifie le HTTP.
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3999;
const PASSWORD = 'secret-test';
const URL_ = `http://127.0.0.1:${PORT}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function once(socket, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout en attendant "${event}"`)), ms);
    socket.once(event, (...args) => { clearTimeout(t); resolve(args.length > 1 ? args : args[0]); });
  });
}

function emit(socket, event, data) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout sur "${event}"`)), 3000);
    const cb = (res) => { clearTimeout(t); resolve(res); };
    if (data === undefined) socket.emit(event, cb); else socket.emit(event, data, cb);
  });
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try { const r = await fetch(`${URL_}/api/jokes`); if (r.ok) return; } catch (e) { /* pas prêt */ }
    await wait(100);
  }
  throw new Error('le serveur ne démarre pas');
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), ADMIN_PASSWORD: PASSWORD },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const sockets = [];
  const track = (s) => { sockets.push(s); return s; };

  try {
    await waitForServer();

    // --- HTTP ---
    const jokes = await fetch(`${URL_}/api/jokes`).then((r) => r.json());
    assert(Array.isArray(jokes) && jokes.length > 0, 'jokes.json vide');
    for (const j of jokes) assert(j.id && j.label && j.joke && j.joke.type, `blague mal formée : ${j.id}`);

    const qr = await fetch(`${URL_}/qr/42`);
    assert.strictEqual(qr.status, 200);
    assert(/svg/.test(qr.headers.get('content-type')), 'le QR doit être un SVG');
    assert((await qr.text()).includes('<svg'));

    const info = await fetch(`${URL_}/api/url/42`).then((r) => r.json());
    assert(info.url.endsWith('/r/42'), 'URL du QR incorrecte : ' + info.url);

    assert.strictEqual((await fetch(`${URL_}/`)).status, 200);
    assert.strictEqual((await fetch(`${URL_}/remote`)).status, 200);
    assert.strictEqual((await fetch(`${URL_}/r/42`)).status, 200);
    assert.strictEqual((await fetch(`${URL_}/r/4`)).status, 404);
    assert.strictEqual((await fetch(`${URL_}/r/abc`)).status, 404);

    // --- Régie : mauvais mot de passe ---
    const bad = track(io(`${URL_}/remote`, { auth: { password: 'nope' }, reconnection: false }));
    const err = await once(bad, 'connect_error');
    assert.strictEqual(err.message, 'unauthorized');

    // --- Régie : bon mot de passe ---
    const remote = track(io(`${URL_}/remote`, { auth: { password: PASSWORD }, reconnection: false }));
    const firstList = once(remote, 'receivers');
    assert.deepStrictEqual(await firstList, [], 'aucun récepteur au départ');

    // --- Récepteur A prend le code 42 ---
    const a = track(io(URL_, { reconnection: false }));
    await once(a, 'connect');
    const listAfterJoin = once(remote, 'receivers');
    assert.deepStrictEqual(await emit(a, 'join', { code: '42', clientId: 'A', kind: 'pc' }), { ok: true });
    const l1 = await listAfterJoin;
    assert.strictEqual(l1.length, 1);
    assert.strictEqual(l1[0].code, '42');
    assert.strictEqual(l1[0].kind, 'pc');
    assert.strictEqual(l1[0].online, true);

    // --- Un autre navigateur ne peut pas prendre 42, ni un code invalide ---
    const b = track(io(URL_, { reconnection: false }));
    await once(b, 'connect');
    assert.deepStrictEqual(await emit(b, 'join', { code: '42', clientId: 'B' }), { ok: false, error: 'occupied' });
    assert.deepStrictEqual(await emit(b, 'join', { code: '7', clientId: 'B' }), { ok: false, error: 'invalid' });
    assert.deepStrictEqual(await emit(b, 'join', { code: '123', clientId: 'B' }), { ok: false, error: 'invalid' });

    // --- Envoi d'une blague (champs inconnus et HTML ignorés) ---
    const gotJoke = once(a, 'joke');
    const res = await emit(remote, 'send', {
      code: '42',
      joke: { type: 'text', text: 'Salut', bg: '#112233', evil: '<script>x</script>', html: '<b>x</b>', size: 999 },
    });
    assert.deepStrictEqual(res, { ok: true, count: 1 });
    const joke = await gotJoke;
    assert.strictEqual(joke.type, 'text');
    assert.strictEqual(joke.text, 'Salut');
    assert.strictEqual(joke.bg, '#112233');
    assert.strictEqual(joke.size, 40, 'size doit être borné');
    assert(!('evil' in joke) && !('html' in joke), 'les champs inconnus doivent être supprimés');

    // --- Validation ---
    assert.deepStrictEqual(await emit(remote, 'send', { code: '42', joke: { type: 'rm -rf' } }), { ok: false, error: 'invalid-joke' });
    assert.deepStrictEqual(await emit(remote, 'send', { code: '99', joke: { type: 'text', text: 'x' } }), { ok: false, error: 'no-receiver' });
    assert.deepStrictEqual(await emit(remote, 'send', { code: 'all', joke: { type: 'clear' } }), { ok: true, count: 1 });

    // --- Une blague du catalogue passe la validation ---
    for (const j of jokes) {
      const r = await emit(remote, 'send', { code: '42', joke: j.joke });
      assert.strictEqual(r.ok, true, `blague refusée : ${j.id}`);
    }

    // --- État plein écran remonté à la régie ---
    const fsList = once(remote, 'receivers');
    a.emit('state', { fullscreen: true });
    assert.strictEqual((await fsList)[0].fullscreen, true);

    // --- Code libre ---
    const free = await emit(remote, 'free-code');
    assert(/^\d{2}$/.test(free.code) && free.code !== '42', 'code libre incorrect');

    // --- Libération par la régie ---
    const kicked = once(a, 'kick');
    const afterRelease = once(remote, 'receivers');
    await emit(remote, 'release', '42');
    assert.strictEqual(await kicked, 'released');
    assert.deepStrictEqual(await afterRelease, []);

    // Le code 42 est de nouveau pris par B
    assert.deepStrictEqual(await emit(b, 'join', { code: '42', clientId: 'B', kind: 'mobile' }), { ok: true });

    console.log('OK : tous les tests passent');
  } finally {
    for (const s of sockets) s.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error('ÉCHEC :', e.message);
  process.exit(1);
});
