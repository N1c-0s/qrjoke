'use strict';

// Teste le protocole MQTT (site/core.js) contre un broker local (aedes), sans internet.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const mqtt = require('mqtt');
const { Aedes } = require('aedes');
const core = require('../site/core.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 4000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await wait(40);
  }
  throw new Error('timeout : ' + label);
}

async function main() {
  const broker = await Aedes.createBroker();
  const server = net.createServer(broker.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const brokerUrl = `mqtt://127.0.0.1:${server.address().port}`;
  const room = 'test' + core.randomId(6);
  const cleanup = [];

  const fast = { mqtt, room, brokerUrl, heartbeatMs: 300 };
  const mkReceiver = (id, extra = {}) => {
    const log = { jokes: [], kicks: [] };
    const r = core.createReceiver({
      ...fast, id, kind: extra.kind || 'pc', label: extra.label || '',
      onJoke: (j) => log.jokes.push(j),
      onKick: (why) => log.kicks.push(why),
    });
    cleanup.push(() => r.leave());
    return { r, log };
  };

  try {
    // --- Salon, identifiants et liens ---
    assert.strictEqual(core.normRoom('Bureau'), 'bureau');
    assert.strictEqual(core.normRoom('mauvais salon!'), null);
    assert.strictEqual(core.normRoom(undefined), null);
    assert.strictEqual(core.receiverUrl('https://x.app', 'bureau'), 'https://x.app/?room=bureau');
    assert.strictEqual(core.remoteUrl('https://x.app', 'bureau'), 'https://x.app/remote?room=bureau');
    assert(core.ID_RE.test(core.randomId(8)));
    assert.throws(() => core.createReceiver({ mqtt, room: '??', id: 'abcd1234' }));
    assert.throws(() => core.createReceiver({ mqtt, room, id: 'X!' }));
    assert.throws(() => core.createRemote({ mqtt, room: null }));

    // --- Régie + écran A (aucun code : il s'annonce tout seul) ---
    let list = [];
    const remote = core.createRemote({ ...fast, onReceivers: (l) => { list = l; } });
    cleanup.push(() => remote.end());
    assert.deepStrictEqual(await remote.connect(), { ok: true });

    const A = mkReceiver('aaaa1111', { label: 'PC · Chrome' });
    assert.deepStrictEqual(await A.r.start(), { ok: true });
    await until(() => list.length === 1, 4000, 'A visible dans la régie');
    assert.strictEqual(list[0].id, 'aaaa1111');
    assert.strictEqual(list[0].kind, 'pc');
    assert.strictEqual(list[0].label, 'PC · Chrome');
    assert.strictEqual(list[0].fullscreen, false);

    // --- État plein écran remonté ---
    A.r.setFullscreen(true);
    await until(() => list[0] && list[0].fullscreen === true, 4000, 'plein écran remonté');

    // --- Envoi : champs inconnus supprimés, valeurs bornées ---
    const res = await remote.send('aaaa1111', { type: 'text', text: 'Salut', bg: '#112233', html: '<b>x</b>', size: 999 });
    assert.deepStrictEqual(res, { ok: true, count: 1 });
    await until(() => A.log.jokes.length === 1, 4000, 'blague reçue');
    const j = A.log.jokes[0];
    assert.strictEqual(j.text, 'Salut');
    assert.strictEqual(j.size, 40);
    assert(!('html' in j));

    // --- Validation côté régie ---
    assert.deepStrictEqual(await remote.send('aaaa1111', { type: 'rm -rf' }), { ok: false, error: 'invalid-joke' });
    assert.deepStrictEqual(await remote.send('zzzz9999', { type: 'clear' }), { ok: false, error: 'no-receiver' });
    assert.deepStrictEqual(await remote.send('PAS VALIDE', { type: 'clear' }), { ok: false, error: 'invalid' });

    // --- Blagues du catalogue (et site/jokes.json identique à la source du serveur local) ---
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'jokes.json'), 'utf8'));
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'jokes.json'), 'utf8'));
    assert.deepStrictEqual(catalog, source, 'site/jokes.json diffère de jokes.json');
    const before = A.log.jokes.length;
    for (const item of catalog) {
      const r = await remote.send('aaaa1111', item.joke);
      assert.strictEqual(r.ok, true, 'blague refusée : ' + item.id);
    }
    await until(() => A.log.jokes.length === before + catalog.length, 6000, 'catalogue reçu');

    // --- Messages cassés ou malveillants envoyés directement sur le broker : ignorés ou nettoyés ---
    const raw = mqtt.connect(brokerUrl, { reconnectPeriod: 0 });
    await new Promise((r) => raw.on('connect', r));
    const topic = `qrjoke/${room}/aaaa1111/joke`;
    const n0 = A.log.jokes.length;
    raw.publish(topic, 'pas du json', { qos: 1 });
    raw.publish(topic, JSON.stringify({ type: 'joke', from: 'x', joke: { type: 'format-c' } }), { qos: 1 });
    raw.publish(topic, JSON.stringify({ type: 'autre', joke: { type: 'text', text: 'x' } }), { qos: 1 });
    raw.publish(topic, JSON.stringify({ type: 'joke', from: 'x', joke: { type: 'text', text: '<img src=x onerror=alert(1)>', bg: 'url(javascript:1)', fg: '#fff' } }), { qos: 1 });
    // Présences bidon : un identifiant invalide ne doit pas apparaître dans la régie
    raw.publish(`qrjoke/${room}/PAS-VALIDE/presence`, JSON.stringify({ type: 'presence', kind: 'pc', since: 1 }), { qos: 1 });
    await wait(600);
    assert.strictEqual(A.log.jokes.length, n0 + 1, 'seule la blague valide doit passer');
    const cleaned = A.log.jokes[A.log.jokes.length - 1];
    assert.strictEqual(cleaned.bg, undefined, 'une couleur invalide doit être supprimée');
    assert.strictEqual(cleaned.fg, '#fff');
    assert.strictEqual(list.length, 1, 'une présence invalide est apparue');
    raw.end(true);

    // --- Deuxième écran (smartphone) : apparaît sans aucun code, reçoit seulement ce qui le concerne ---
    const B = mkReceiver('bbbb2222', { kind: 'mobile', label: 'Smartphone · Safari' });
    assert.deepStrictEqual(await B.r.start(), { ok: true });
    await until(() => list.length === 2, 4000, 'B visible');
    assert.deepStrictEqual(list.map((x) => x.id), ['aaaa1111', 'bbbb2222']);
    assert.strictEqual(list.find((x) => x.id === 'bbbb2222').kind, 'mobile');

    const nA = A.log.jokes.length, nB = B.log.jokes.length;
    assert.deepStrictEqual(await remote.send('bbbb2222', { type: 'text', text: 'Rien que pour B' }), { ok: true, count: 1 });
    await until(() => B.log.jokes.length === nB + 1, 4000, 'B reçoit sa blague');
    await wait(400);
    assert.strictEqual(A.log.jokes.length, nA, 'A ne doit pas recevoir la blague de B');

    // --- Diffusion 'all' ---
    assert.deepStrictEqual(await remote.send('all', { type: 'text', text: 'Pour tous' }), { ok: true, count: 2 });
    await until(() => A.log.jokes.length === nA + 1 && B.log.jokes.length === nB + 2, 4000, 'diffusion all');

    // --- Un autre salon ne reçoit rien et ne voit rien ---
    const otherJokes = [];
    const other = core.createReceiver({
      ...fast, room: room + 'x', id: 'cccc3333', kind: 'pc',
      onJoke: (x) => otherJokes.push(x),
    });
    cleanup.push(() => other.leave());
    assert.deepStrictEqual(await other.start(), { ok: true });
    await remote.send('all', { type: 'text', text: 'isolé ?' });
    await wait(500);
    assert.strictEqual(otherJokes.length, 0);
    assert(!list.some((x) => x.id === 'cccc3333'), 'un écran d\'un autre salon est visible');

    // --- Même navigateur qui rouvre la page : la plus récente garde la place ---
    const A2 = mkReceiver('aaaa1111', { label: 'PC · Chrome' });
    assert.deepStrictEqual(await A2.r.start(), { ok: true });
    await until(() => A.log.kicks.includes('taken'), 4000, 'ancienne page évincée');

    // --- Libération par la régie ---
    await remote.release('aaaa1111');
    await until(() => A2.log.kicks.includes('released'), 4000, 'release reçu');
    await until(() => !list.some((x) => x.id === 'aaaa1111'), 4000, 'A retiré de la liste');

    // --- Départ propre : disparaît tout de suite de la régie ---
    await B.r.leave();
    await until(() => list.length === 0, 4000, 'B retiré après leave');

    // --- Un écran qui disparaît sans prévenir (onglet fermé) sort de la liste après un délai ---
    const short = core.createRemote({ ...fast, staleMs: 800 });
    cleanup.push(() => short.end());
    await short.connect();
    const ghost = mqtt.connect(brokerUrl, { reconnectPeriod: 0 });
    await new Promise((r) => ghost.on('connect', r));
    ghost.publish(`qrjoke/${room}/eeee5555/presence`, JSON.stringify({ type: 'presence', from: 'g', id: 'eeee5555', kind: 'pc', since: Date.now() }), { qos: 1 });
    await until(() => short.receivers().length === 1, 4000, 'fantôme visible');
    await wait(1100);
    assert.strictEqual(short.receivers().length, 0, 'un écran sans battement doit disparaître');
    ghost.end(true);

    console.log('OK : protocole MQTT validé');
  } finally {
    for (const f of cleanup) { try { await f(); } catch (e) { /* rien */ } }
    server.close();
    await new Promise((r) => broker.close(r));
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('ÉCHEC :', e.message);
  process.exit(1);
});
