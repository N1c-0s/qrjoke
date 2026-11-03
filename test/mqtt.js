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

  const fast = { mqtt, room, brokerUrl, heartbeatMs: 300, joinWaitMs: 400 };
  const mkReceiver = (code, extra = {}) => {
    const log = { jokes: [], kicks: [] };
    const r = core.createReceiver({
      ...fast, code, clientId: extra.clientId || core.randomId(8), kind: extra.kind || 'pc', label: extra.label || '',
      onJoke: (j) => log.jokes.push(j),
      onKick: (why) => log.kicks.push(why),
    });
    cleanup.push(() => r.leave());
    return { r, log };
  };

  try {
    // --- Salon, codes et liens ---
    assert.strictEqual(core.normRoom('Bureau'), 'bureau');
    assert.strictEqual(core.normRoom('mauvais salon!'), null);
    assert.strictEqual(core.normRoom(undefined), null);
    assert.strictEqual(core.receiverUrl('https://x.app', '42'), 'https://x.app/42');
    assert.strictEqual(core.receiverUrl('https://x.app', '42', core.DEFAULT_ROOM), 'https://x.app/42');
    assert.strictEqual(core.receiverUrl('https://x.app', '42', 'bureau'), 'https://x.app/42?room=bureau');
    assert.strictEqual(core.remoteUrl('https://x.app'), 'https://x.app/remote');
    assert.strictEqual(core.remoteUrl('https://x.app', 'bureau'), 'https://x.app/remote?room=bureau');
    assert(core.ID_RE.test(core.randomId(8)));
    for (const bad of ['4', '123', 'ab', '', undefined]) {
      assert.throws(() => core.createReceiver({ mqtt, code: bad }), /code invalide/);
    }
    assert.throws(() => core.createReceiver({ mqtt, room: '??', code: '42' }));
    assert.throws(() => core.createReceiver({ mqtt, code: '42', clientId: 'X!' }));
    assert.throws(() => core.createRemote({ mqtt, room: '??' }));

    // --- Régie + écran A (code 42) ---
    let list = [];
    const remote = core.createRemote({ ...fast, onReceivers: (l) => { list = l; } });
    cleanup.push(() => remote.end());
    assert.deepStrictEqual(await remote.connect(), { ok: true });

    const A = mkReceiver('42', { label: 'PC · Chrome', clientId: 'aaaa1111' });
    A.id = 'aaaa1111';
    assert.deepStrictEqual(await A.r.start(), { ok: true });
    await until(() => list.length === 1, 4000, 'A visible dans la régie');
    assert.strictEqual(list[0].code, '42');
    assert.strictEqual(list[0].kind, 'pc');
    assert.strictEqual(list[0].label, 'PC · Chrome');
    assert.strictEqual(list[0].fullscreen, false);

    // --- État plein écran remonté ---
    A.r.setFullscreen(true);
    await until(() => list[0] && list[0].fullscreen === true, 4000, 'plein écran remonté');

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
    assert.deepStrictEqual(await remote.send('PAS VALIDE', { type: 'clear' }), { ok: false, error: 'invalid' });

    // --- Blagues du catalogue (et site/jokes.json identique à la source du serveur local) ---
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'jokes.json'), 'utf8'));
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'jokes.json'), 'utf8'));
    // site/jokes.json peut ajouter des blagues réservées à Netlify (image, oserror, trap),
    // mais doit reprendre à l'identique tout ce qui est dans jokes.json (catalogue partagé avec la version locale).
    const byId = new Map(catalog.map((item) => [item.id, item]));
    for (const item of source) {
      assert.deepStrictEqual(byId.get(item.id), item, `site/jokes.json diffère de jokes.json pour "${item.id}"`);
    }
    const before = A.log.jokes.length;
    for (const item of catalog) {
      const r = await remote.send('42', item.joke);
      assert.strictEqual(r.ok, true, 'blague refusée : ' + item.id);
    }
    await until(() => A.log.jokes.length === before + catalog.length, 6000, 'catalogue reçu');

    // --- Photo volumineuse (limite haute) : traverse le broker intacte ---
    const bigImg = 'data:image/jpeg;base64,' + 'A'.repeat(core.MAX_IMAGE - 30);
    const nImg = A.log.jokes.length;
    assert.deepStrictEqual(await remote.send('42', { type: 'image', image: bigImg, text: 'Photo' }), { ok: true, count: 1 });
    await until(() => A.log.jokes.length === nImg + 1, 5000, 'photo reçue');
    assert.strictEqual(A.log.jokes[nImg].image, bigImg);

    // --- Messages cassés ou malveillants envoyés directement sur le broker : ignorés ou nettoyés ---
    const raw = mqtt.connect(brokerUrl, { reconnectPeriod: 0 });
    await new Promise((r) => raw.on('connect', r));
    const topic = `qrjoke/${room}/42/joke`;
    const n0 = A.log.jokes.length;
    raw.publish(topic, 'pas du json', { qos: 1 });
    raw.publish(topic, JSON.stringify({ type: 'joke', from: 'x', joke: { type: 'format-c' } }), { qos: 1 });
    raw.publish(topic, JSON.stringify({ type: 'autre', joke: { type: 'text', text: 'x' } }), { qos: 1 });
    raw.publish(topic, JSON.stringify({ type: 'joke', from: 'x', joke: { type: 'text', text: '<img src=x onerror=alert(1)>', bg: 'url(javascript:1)', fg: '#fff' } }), { qos: 1 });
    // Présences bidon : un code invalide ne doit pas apparaître dans la régie
    raw.publish(`qrjoke/${room}/123/presence`, JSON.stringify({ type: 'presence', kind: 'pc', since: 1 }), { qos: 1 });
    await wait(600);
    assert.strictEqual(A.log.jokes.length, n0 + 1, 'seule la blague valide doit passer');
    const cleaned = A.log.jokes[A.log.jokes.length - 1];
    assert.strictEqual(cleaned.bg, undefined, 'une couleur invalide doit être supprimée');
    assert.strictEqual(cleaned.fg, '#fff');
    assert.strictEqual(list.length, 1, 'une présence invalide est apparue');
    raw.end(true);

    // --- Message vocal : traverse le broker, l'écran le lit via <audio> (côté régie seulement) ---
    const bigAudio = 'data:audio/webm;base64,' + 'A'.repeat(core.MAX_AUDIO - 30);
    const nVoice = A.log.jokes.length;
    assert.deepStrictEqual(await remote.send('42', { type: 'voice', audio: bigAudio }), { ok: true, count: 1 });
    await until(() => A.log.jokes.length === nVoice + 1, 5000, 'message vocal reçu');
    assert.strictEqual(A.log.jokes[nVoice].audio, bigAudio);

    // --- Deuxième écran (smartphone) : apparaît code 07, reçoit seulement ce qui le concerne ---
    const B = mkReceiver('07', { kind: 'mobile', label: 'Smartphone · Safari' });
    assert.deepStrictEqual(await B.r.start(), { ok: true });
    await until(() => list.length === 2, 4000, 'B visible');
    assert.deepStrictEqual(list.map((x) => x.code), ['42', '07']);
    assert.strictEqual(list.find((x) => x.code === '07').kind, 'mobile');

    const nA = A.log.jokes.length, nB = B.log.jokes.length;
    assert.deepStrictEqual(await remote.send('07', { type: 'text', text: 'Rien que pour B' }), { ok: true, count: 1 });
    await until(() => B.log.jokes.length === nB + 1, 4000, 'B reçoit sa blague');
    await wait(400);
    assert.strictEqual(A.log.jokes.length, nA, 'A ne doit pas recevoir la blague de B');

    // --- Diffusion 'all' ---
    assert.deepStrictEqual(await remote.send('all', { type: 'text', text: 'Pour tous' }), { ok: true, count: 2 });
    await until(() => A.log.jokes.length === nA + 1 && B.log.jokes.length === nB + 2, 4000, 'diffusion all');

    // --- Un autre salon ne reçoit rien et ne voit rien ---
    const otherJokes = [];
    const other = core.createReceiver({
      ...fast, room: room + 'x', code: '11', kind: 'pc',
      onJoke: (x) => otherJokes.push(x),
    });
    cleanup.push(() => other.leave());
    assert.deepStrictEqual(await other.start(), { ok: true });
    await remote.send('all', { type: 'text', text: 'isolé ?' });
    await wait(500);
    assert.strictEqual(otherJokes.length, 0);
    assert(!list.some((x) => x.code === '11'), 'un écran d\'un autre salon est visible');

    // --- Un code = un écran : un autre navigateur est refusé, l'occupant n'est pas gêné ---
    const nBefore = A.log.kicks.length;
    const intruder = mkReceiver('42', { clientId: 'intrus001' });
    assert.deepStrictEqual(await intruder.r.start(), { ok: true }); // démarre sans attendre...
    await until(() => intruder.log.kicks.includes('occupied'), 4000, '... puis refusé : code occupé');
    assert.strictEqual(A.log.kicks.length, nBefore, "l'occupant ne doit pas être évincé");
    assert.strictEqual(list.filter((x) => x.code === '42').length, 1);
    assert.deepStrictEqual(await remote.send('42', { type: 'text', text: 'toujours là' }), { ok: true, count: 1 });

    // --- Code libre proposé par la régie ---
    const free = remote.freeCode();
    assert(core.CODE_RE.test(free) && !list.some((x) => x.code === free), 'freeCode doit renvoyer un code non utilisé');

    // --- Même navigateur qui rouvre la page : la plus récente garde la place ---
    const A2 = mkReceiver('42', { clientId: A.id });
    assert.deepStrictEqual(await A2.r.start(), { ok: true });
    await until(() => A.log.kicks.includes('taken'), 4000, 'ancienne page évincée');

    // --- Libération par la régie ---
    await remote.release('42');
    await until(() => A2.log.kicks.includes('released'), 4000, 'release reçu');
    await until(() => !list.some((x) => x.code === '42'), 4000, 'A retiré de la liste');

    // --- Le code libéré peut être repris par un autre navigateur ---
    const C = mkReceiver('42', { clientId: 'autre0001' });
    assert.deepStrictEqual(await C.r.start(), { ok: true });
    await until(() => list.some((x) => x.code === '42'), 4000, 'C visible');
    await C.r.leave();
    await until(() => !list.some((x) => x.code === '42'), 4000, 'C parti');

    // --- Départ propre : disparaît tout de suite de la régie ---
    await B.r.leave();
    await until(() => list.length === 0, 4000, 'B retiré après leave');

    // --- Un écran qui disparaît sans prévenir (onglet fermé) sort de la liste après un délai ---
    const short = core.createRemote({ ...fast, staleMs: 800 });
    cleanup.push(() => short.end());
    await short.connect();
    const ghost = mqtt.connect(brokerUrl, { reconnectPeriod: 0 });
    await new Promise((r) => ghost.on('connect', r));
    ghost.publish(`qrjoke/${room}/55/presence`, JSON.stringify({ type: 'presence', from: 'g', code: '55', kind: 'pc', since: Date.now() }), { qos: 1 });
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
