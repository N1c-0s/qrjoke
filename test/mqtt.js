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
  const room = 'test-' + core.randomId(6);
  const cleanup = [];

  const fast = { mqtt, room, brokerUrl, joinWaitMs: 400, heartbeatMs: 300 };
  const mkReceiver = (code, clientId, extra = {}) => {
    const log = { jokes: [], kicks: [] };
    const r = core.createReceiver({
      ...fast, code, clientId, kind: extra.kind || 'pc',
      onJoke: (j) => log.jokes.push(j),
      onKick: (why) => log.kicks.push(why),
    });
    cleanup.push(() => r.leave());
    return { r, log };
  };

  try {
    // --- Salon et liens ---
    assert.strictEqual(core.normRoom('bureau'), 'bureau');
    assert.strictEqual(core.normRoom('mauvais salon!'), core.DEFAULT_ROOM);
    assert.strictEqual(core.normRoom(undefined), core.DEFAULT_ROOM);
    assert.strictEqual(core.joinUrl('https://x.app', '42', core.DEFAULT_ROOM), 'https://x.app/r/42');
    assert.strictEqual(core.joinUrl('https://x.app', '42', 'bureau'), 'https://x.app/r/42?room=bureau');
    assert.strictEqual(core.receiverUrl('https://x.app', core.DEFAULT_ROOM), 'https://x.app/');

    // --- Régie + récepteur A sur le code 42 ---
    let list = [];
    const remote = core.createRemote({ ...fast, onReceivers: (l) => { list = l; } });
    cleanup.push(() => remote.end());
    assert.deepStrictEqual(await remote.connect(), { ok: true });

    const A = mkReceiver('42', 'browser-A');
    assert.deepStrictEqual(await A.r.start(), { ok: true });
    await until(() => list.length === 1, 4000, 'A visible dans la régie');
    assert.strictEqual(list[0].code, '42');
    assert.strictEqual(list[0].kind, 'pc');
    assert.strictEqual(list[0].fullscreen, false);

    // --- État plein écran remonté ---
    A.r.setFullscreen(true);
    await until(() => list[0] && list[0].fullscreen === true, 4000, 'plein écran remonté');

    // --- Un autre navigateur ne peut pas prendre 42 ---
    const B = mkReceiver('42', 'browser-B');
    assert.deepStrictEqual(await B.r.start(), { ok: false, error: 'occupied' });

    // --- Envoi : champs inconnus supprimés, valeurs bornées ---
    const res = await remote.send('42', { type: 'text', text: 'Salut', bg: '#112233', html: '<b>x</b>', size: 999 });
    assert.deepStrictEqual(res, { ok: true, count: 1 });
    await until(() => A.log.jokes.length === 1, 4000, 'blague reçue');
    const j = A.log.jokes[0];
    assert.strictEqual(j.text, 'Salut');
    assert.strictEqual(j.size, 40);
    assert(!('html' in j));

    // --- Validation côté régie ---
    assert.deepStrictEqual(await remote.send('42', { type: 'rm -rf' }), { ok: false, error: 'invalid-joke' });
    assert.deepStrictEqual(await remote.send('99', { type: 'clear' }), { ok: false, error: 'no-receiver' });
    assert.deepStrictEqual(await remote.send('xx', { type: 'clear' }), { ok: false, error: 'invalid' });

    // --- Blagues du catalogue (et site/jokes.json identique à la source du serveur local) ---
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'jokes.json'), 'utf8'));
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'jokes.json'), 'utf8'));
    assert.deepStrictEqual(catalog, source, 'site/jokes.json diffère de jokes.json');
    const before = A.log.jokes.length;
    for (const item of catalog) {
      const r = await remote.send('42', item.joke);
      assert.strictEqual(r.ok, true, 'blague refusée : ' + item.id);
    }
    await until(() => A.log.jokes.length === before + catalog.length, 6000, 'catalogue reçu');

    // --- Messages malveillants ou cassés envoyés directement sur le broker : ignorés ou nettoyés ---
    const raw = mqtt.connect(brokerUrl, { reconnectPeriod: 0 });
    await new Promise((r) => raw.on('connect', r));
    const topic = `qrjoke/${room}/42/joke`;
    const n0 = A.log.jokes.length;
    raw.publish(topic, 'pas du json', { qos: 1 });
    raw.publish(topic, JSON.stringify({ type: 'joke', from: 'x', joke: { type: 'format-c' } }), { qos: 1 });
    raw.publish(topic, JSON.stringify({ type: 'autre', joke: { type: 'text', text: 'x' } }), { qos: 1 });
    raw.publish(topic, JSON.stringify({ type: 'joke', from: 'x', joke: { type: 'text', text: '<img src=x onerror=alert(1)>', bg: 'url(javascript:1)', fg: '#fff' } }), { qos: 1 });
    await wait(600);
    assert.strictEqual(A.log.jokes.length, n0 + 1, 'seule la blague valide doit passer');
    const cleaned = A.log.jokes[A.log.jokes.length - 1];
    assert.strictEqual(cleaned.bg, undefined, 'une couleur invalide doit être supprimée');
    assert.strictEqual(cleaned.fg, '#fff');
    raw.end(true);

    // --- Diffusion 'all' avec un deuxième récepteur (smartphone) ---
    const C = mkReceiver('07', 'phone-C', { kind: 'mobile' });
    assert.deepStrictEqual(await C.r.start(), { ok: true });
    await until(() => list.length === 2, 4000, 'C visible');
    assert.deepStrictEqual(list.map((x) => x.code), ['07', '42']);
    assert.strictEqual(list.find((x) => x.code === '07').kind, 'mobile');
    const nA = A.log.jokes.length, nC = C.log.jokes.length;
    assert.deepStrictEqual(await remote.send('all', { type: 'text', text: 'Pour tous' }), { ok: true, count: 2 });
    await until(() => A.log.jokes.length === nA + 1 && C.log.jokes.length === nC + 1, 4000, 'diffusion all');

    // --- Un autre salon ne reçoit rien ---
    const otherJokes = [];
    const other = core.createReceiver({
      ...fast, room: room + '-autre', code: '42', clientId: 'Z', kind: 'pc',
      onJoke: (x) => otherJokes.push(x),
    });
    cleanup.push(() => other.leave());
    assert.deepStrictEqual(await other.start(), { ok: true }, 'même code dans un autre salon : libre');
    await remote.send('all', { type: 'text', text: 'isolé ?' });
    await wait(500);
    assert.strictEqual(otherJokes.length, 0);

    // --- Code libre ---
    const free = remote.freeCode();
    assert(/^\d{2}$/.test(free) && free !== '42' && free !== '07');

    // --- Même navigateur qui rouvre la page : il reprend son code, l'ancienne page cède ---
    const A2 = mkReceiver('42', 'browser-A');
    assert.deepStrictEqual(await A2.r.start(), { ok: true });
    await until(() => A.log.kicks.includes('taken'), 4000, 'ancienne page évincée');

    // --- Libération par la régie ---
    await remote.release('42');
    await until(() => A2.log.kicks.includes('released'), 4000, 'release reçu');
    await until(() => !list.some((x) => x.code === '42'), 4000, '42 retiré de la liste');
    const D = mkReceiver('42', 'browser-D');
    assert.deepStrictEqual(await D.r.start(), { ok: true }, 'le code libéré doit être reprenable');

    // --- Départ propre : disparaît tout de suite de la régie ---
    await C.r.leave();
    await until(() => !list.some((x) => x.code === '07'), 4000, '07 retiré après leave');

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
