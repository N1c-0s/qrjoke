'use strict';

// Teste la détection du système, les faux écrans d'erreur et le récepteur complet (avec un faux MQTT),
// dans un DOM simulé (jsdom).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const core = require('../site/core.js');
const screens = require('../site/screens.js');

const SITE = path.join(__dirname, '..', 'site');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await wait(40);
  }
  throw new Error('timeout : ' + label);
}

const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

const PHRASE = {
  windows: 'Votre PC a rencontré un problème',
  mac: 'Votre ordinateur a redémarré',
  android: 'Appli Système ne répond pas',
  iphone: 'Une erreur est survenue',
};

// Mots qu'un faux écran ne doit jamais contenir : marques, support, saisie, paiement
const FORBIDDEN = /Microsoft|Windows|Apple|iTunes|iCloud|Google|Android|Samsung|http|www\.|\+\d{6,}|support|mot de passe|password|paiement|payer|carte bancaire/i;

function checkSafe(root, label) {
  assert(!FORBIDDEN.test(root.textContent), `${label} : texte interdit : ${root.textContent.match(FORBIDDEN)}`);
  assert.strictEqual(root.querySelectorAll('input, textarea, img, iframe, a, script').length, 0, `${label} : élément interdit`);
}

async function main() {
  /* ---------- Détection ---------- */
  assert.strictEqual(core.detectOS({ ua: UA.windows }), 'windows');
  assert.strictEqual(core.detectOS({ ua: UA.edge }), 'windows');
  assert.strictEqual(core.detectOS({ ua: UA.mac, maxTouchPoints: 0 }), 'mac');
  assert.strictEqual(core.detectOS({ ua: UA.mac, maxTouchPoints: 5 }), 'iphone', 'un iPad se présente comme un Mac tactile');
  assert.strictEqual(core.detectOS({ ua: UA.iphone, maxTouchPoints: 5 }), 'iphone');
  assert.strictEqual(core.detectOS({ ua: UA.android, maxTouchPoints: 5 }), 'android');
  assert.strictEqual(core.detectOS({ ua: UA.linux }), 'other');
  assert.strictEqual(core.detectOS({ ua: UA.chromeos }), 'other');
  assert.strictEqual(core.detectOS({}), 'other');
  assert.strictEqual(core.detectOS(), 'other');

  assert.strictEqual(core.resolveOS('auto', 'mac'), 'mac');
  assert.strictEqual(core.resolveOS(undefined, 'android'), 'android');
  assert.strictEqual(core.resolveOS('auto', 'other'), 'windows', 'système inconnu : écran bleu');
  assert.strictEqual(core.resolveOS('iphone', 'windows'), 'iphone', 'le choix manuel prime');
  assert.strictEqual(core.resolveOS('n-importe-quoi', 'mac'), 'mac');

  /* ---------- Validation du message oserror ---------- */
  const ok = core.sanitize({ type: 'oserror', os: 'mac', seconds: 9999, final: 'Raté !', html: '<b>' });
  assert.strictEqual(ok.type, 'oserror');
  assert.strictEqual(ok.os, 'mac');
  assert.strictEqual(ok.seconds, 120, 'durée bornée');
  assert(!('html' in ok));
  assert.strictEqual(core.sanitize({ type: 'oserror', os: 'linux' }).os, undefined, 'os inconnu supprimé');

  /* ---------- Chaque écran, isolément ---------- */
  for (const os of screens.OS_LIST) {
    const dom = new JSDOM('<!doctype html><div id="stage"></div>');
    const { document, KeyboardEvent, MouseEvent } = dom.window;
    const stage = document.getElementById('stage');
    const cancels = [];
    let done = 0;
    const used = screens.render(os, { stage, seconds: 1, spinnerMs: 100, done: () => { done += 1; }, cancel: (f) => cancels.push(f) });
    assert.strictEqual(used, os);
    assert(stage.textContent.includes(PHRASE[os]), `${os} : texte attendu absent`);
    checkSafe(stage, os);

    if (os === 'windows') {
      await until(() => done === 1, 4000, 'windows terminé');
      assert(/100 % terminé/.test(stage.textContent), 'la progression doit atteindre 100 %');
    } else if (os === 'mac') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      assert.strictEqual(done, 1, 'une touche doit terminer l\'écran Mac');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
      assert.strictEqual(done, 1, 'done ne doit être appelé qu\'une fois');
    } else if (os === 'android') {
      stage.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      assert.strictEqual(done, 1, 'un bouton doit terminer l\'écran Android');
    } else if (os === 'iphone') {
      stage.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      assert.strictEqual(done, 0, 'OK lance d\'abord le redémarrage');
      assert.strictEqual(stage.textContent.trim(), '', 'écran noir + indicateur seulement');
      await until(() => done === 1, 2000, 'iphone terminé');
    }

    // Nettoyage : plus aucun minuteur actif après cancel
    cancels.forEach((f) => f());
    const before = done;
    await wait(1400);
    assert.strictEqual(done, before, `${os} : un minuteur a survécu au nettoyage`);
    dom.window.close();
  }

  // Écran terminé tout seul quand personne n'interagit (Android, Mac, iPhone)
  for (const os of ['mac', 'android', 'iphone']) {
    const dom = new JSDOM('<!doctype html><div id="stage"></div>');
    const stage = dom.window.document.getElementById('stage');
    let done = 0;
    screens.render(os, { stage, seconds: 1, spinnerMs: 100, done: () => { done += 1; }, cancel: () => {} });
    await until(() => done === 1, 3000, `${os} termine seul`);
    dom.window.close();
  }

  // Système inconnu : écran bleu
  {
    const dom = new JSDOM('<!doctype html><div id="stage"></div>');
    const stage = dom.window.document.getElementById('stage');
    assert.strictEqual(screens.render('inconnu', { stage, seconds: 1, done() {}, cancel() {} }), 'windows');
    dom.window.close();
  }

  /* ---------- Le vrai récepteur (index.html) avec un faux MQTT ---------- */
  const coreSrc = fs.readFileSync(path.join(SITE, 'core.js'), 'utf8');
  const screensSrc = fs.readFileSync(path.join(SITE, 'screens.js'), 'utf8');
  const cameraSrc = fs.readFileSync(path.join(SITE, 'camera.js'), 'utf8');
  const pranksSrc = fs.readFileSync(path.join(SITE, 'pranks.js'), 'utf8');
  const customSrc = fs.readFileSync(path.join(SITE, 'custom.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')
    .replace('<script src="/vendor/mqtt.min.js"></script>', '')
    .replace('<script src="/core.js"></script>', () => `<script>${coreSrc}</script>`)
    .replace('<script src="/screens.js"></script>', () => `<script>${screensSrc}</script>`)
    .replace('<script src="/camera.js"></script>', () => `<script>${cameraSrc}</script>`)
    .replace('<script src="/pranks.js"></script>', () => `<script>${pranksSrc}</script>`)
    .replace('<script src="/custom.js"></script>', () => `<script>${customSrc}</script>`);

  async function runReceiver(uaKey, joke, { touch = 0, path = '/42', typed = null } = {}) {
    const handlers = {}; // ceux du 1er client (le récepteur principal rx) : c'est lui que les tests pilotent
    const published = [];
    let firstClient = true;
    const fakeMqtt = {
      connect() {
        // camera.js ouvre sa propre connexion MQTT en plus de celle du récepteur : chaque client
        // a ses propres handlers, seul le tout premier (rx) alimente le `handlers` partagé ci-dessus.
        const h = firstClient ? handlers : {};
        firstClient = false;
        const client = {
          on(ev, fn) { h[ev] = fn; return client; },
          subscribe(t, o, cb) { const done = typeof o === 'function' ? o : cb; setTimeout(() => { if (done) done(null); }, 0); },
          publish(topic, msg, o, cb) { published.push({ topic, msg }); const done = typeof o === 'function' ? o : cb; if (done) setTimeout(done, 0); },
          connected: true,
          end() {},
        };
        setTimeout(() => h.connect && h.connect(), 5);
        return client;
      },
    };
    const dom = new JSDOM(indexHtml, {
      url: 'https://qrjoke.test' + path,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.mqtt = fakeMqtt;
        // jsdom ignore l'option userAgent de JSDOM : on force navigator à la main
        Object.defineProperty(window.navigator, 'userAgent', { value: UA[uaKey] });
        Object.defineProperty(window.navigator, 'maxTouchPoints', { value: touch });
      },
    });
    const { document } = dom.window;
    const stage = document.getElementById('stage');
    assert(!document.getElementById('go').hidden, 'le bouton Démarrer doit être visible');
    const codeInput = document.getElementById('code');
    const code = typed || path.slice(1);
    if (typed) {
      assert.strictEqual(codeInput.value, '', 'sans code dans le lien, le champ est vide');
      codeInput.value = typed;
    } else {
      assert.strictEqual(codeInput.value, code, 'le code du lien doit pré-remplir le champ');
    }
    document.getElementById('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    const t0 = Date.now();
    await until(() => !stage.hidden, 3000, 'récepteur démarré');
    assert(Date.now() - t0 < 1000, "l'écran doit démarrer sans attendre");
    const id = dom.window.localStorage.getItem('qj-id');
    assert(/^[a-z0-9]{8}$/.test(id), 'identifiant du navigateur absent');
    await until(() => published.some((p) => p.topic === `qrjoke/qrjoke-main/${code}/presence`), 3000, 'présence publiée');
    handlers.message(`qrjoke/qrjoke-main/${code}/joke`, JSON.stringify({ type: 'joke', from: 'regie', joke }));
    return { dom, stage, document, handlers, id, code, published };
  }

  // Auto : chaque système reçoit son propre écran
  const cases = [
    ['windows', 'windows', 0],
    ['mac', 'mac', 0],
    ['android', 'android', 5],
    ['iphone', 'iphone', 5],
    ['linux', 'windows', 0],
  ];
  for (const [ua, expected, touch] of cases) {
    const { dom, stage } = await runReceiver(ua, { type: 'oserror', os: 'auto', seconds: 1, final: 'Gagné !', duration: 30 }, { touch });
    await until(() => stage.textContent.includes(PHRASE[expected]), 3000, `${ua} -> écran ${expected}`);
    // révélation à la fin (Android/Mac/iPhone se terminent seuls après 1 s, l'iPhone ajoute 3 s de redémarrage)
    await until(() => stage.textContent.includes('Gagné !'), 9000, `${ua} : révélation`);
    assert(!stage.textContent.includes(PHRASE[expected]), 'l\'écran d\'erreur doit disparaître à la révélation');
    dom.window.close();
  }

  // Choix manuel : forcé quel que soit le système réel
  {
    const { dom, stage } = await runReceiver('windows', { type: 'oserror', os: 'iphone', seconds: 5 });
    await until(() => stage.textContent.includes(PHRASE.iphone), 3000, 'iphone forcé sur un PC Windows');
    dom.window.close();
  }

  // Photo : acceptée seulement en data URL image bornée ; affichée via <img>, jamais en HTML
  {
    const Core = require('../site/core.js');
    const ok = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    assert.strictEqual(Core.sanitize({ type: 'image', image: ok }).image, ok);
    for (const bad of ['http://x/y.jpg', 'javascript:alert(1)', 'data:text/html;base64,PGI+', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,' + 'A'.repeat(Core.MAX_IMAGE), 42]) {
      assert.strictEqual(Core.sanitize({ type: 'image', image: bad }).image, undefined, 'image refusée : ' + String(bad).slice(0, 30));
    }
    const { stage } = await runReceiver('windows', { type: 'image', image: ok, text: 'Légende', duration: 30 });
    await until(() => stage.querySelector('img.photo'), 3000, 'photo affichée');
    assert.strictEqual(stage.querySelector('img.photo').getAttribute('src'), ok);
    assert(stage.textContent.includes('Légende'));
    const rev = await runReceiver('windows', { type: 'oserror', os: 'windows', seconds: 1, image: ok, final: 'Surprise', duration: 30 });
    await until(() => rev.stage.querySelector('img.photo') && rev.stage.textContent.includes('Surprise'), 9000, 'photo à la révélation');
  }

  // Sans code dans le lien : le code tapé à la main est utilisé ; code invalide refusé
  {
    const { stage, document } = await runReceiver('windows', { type: 'text', text: 'Tapé à la main' }, { path: '/', typed: '07' });
    await until(() => stage.textContent.includes('Tapé à la main'), 3000, 'blague reçue sur le code tapé');
    assert(document.getElementById('code').value === '07');
  }

  // Message vocal : seules les data URL audio bornées sont acceptées, lues via <audio>
  {
    const Core = require('../site/core.js');
    const ok = 'data:audio/webm;base64,GkXfo59C';
    assert.strictEqual(Core.sanitize({ type: 'voice', audio: ok }).audio, ok);
    for (const bad of ['http://x/y.mp3', 'javascript:alert(1)', 'data:text/html;base64,PGI+', 'data:audio/webm;base64,' + 'A'.repeat(Core.MAX_AUDIO), 42]) {
      assert.strictEqual(Core.sanitize({ type: 'voice', audio: bad }).audio, undefined, 'audio refusé : ' + String(bad).slice(0, 30));
    }
    const { stage } = await runReceiver('windows', { type: 'voice', audio: ok, text: 'Coucou' });
    await until(() => stage.querySelector('audio'), 3000, 'lecteur audio ajouté');
    assert.strictEqual(stage.querySelector('audio').getAttribute('src'), ok);
    assert(stage.textContent.includes('Coucou'));
  }

  // Pièges de bouton : chaque piège se termine par la révélation, stylé selon l'OS détecté
  {
    const { stage } = await runReceiver('windows', { type: 'trap', trap: 'shrink', text: 'Continuer ?', final: 'Gagné !' });
    await until(() => stage.textContent.includes('Continuer ?'), 3000, 'piège shrink affiché');
    const btn = stage.querySelector('button');
    assert(btn, 'bouton du piège absent');
    for (let i = 0; i < 7; i += 1) btn.dispatchEvent(new (stage.ownerDocument.defaultView).Event('pointerenter'));
    btn.dispatchEvent(new (stage.ownerDocument.defaultView).Event('click'));
    await until(() => stage.textContent.includes('Gagné !'), 3000, 'piège shrink : révélation après 7 fuites');
  }
  {
    const { stage } = await runReceiver('mac', { type: 'trap', trap: 'swap', text: 'Continuer ?', button: 'OK', button2: 'Annuler', final: 'Gagné !' });
    await until(() => stage.textContent.includes('OK'), 3000, 'piège swap affiché');
    const [a, b] = stage.querySelectorAll('button');
    a.dispatchEvent(new (stage.ownerDocument.defaultView).Event('click'));
    await until(() => stage.textContent.includes('Gagné !'), 3000, 'piège swap : un des deux boutons termine');
  }
  {
    const { stage } = await runReceiver('android', { type: 'trap', trap: 'fakeclick', text: 'Continuer ?', final: 'Gagné !' });
    const btn = stage.querySelector('button');
    for (let i = 0; i < 3; i += 1) btn.dispatchEvent(new (stage.ownerDocument.defaultView).Event('click'));
    await wait(50);
    assert(!stage.textContent.includes('Gagné !'), 'les 3 premiers clics ne doivent pas valider');
    btn.dispatchEvent(new (stage.ownerDocument.defaultView).Event('click'));
    await until(() => stage.textContent.includes('Gagné !'), 3000, 'piège fakeclick : le 4e clic valide');
  }
  {
    // Fausse boite de dialogue : refuse 3 fois, valide à la 4e, et renvoie chaque saisie à la régie (topic reply)
    const { stage, published, code } = await runReceiver('windows', {
      type: 'trap', trap: 'type', text: 'Entrez le code reçu par SMS', placeholder: 'Code SMS', final: 'Gagné !',
    });
    await until(() => stage.textContent.includes('Entrez le code reçu par SMS'), 3000, 'piège type affiché');
    const input = stage.querySelector('input');
    const btn = stage.querySelector('button');
    assert(input, 'champ de saisie absent');
    assert(btn, 'bouton du piège absent');
    const win = stage.ownerDocument.defaultView;
    for (let i = 0; i < 3; i += 1) {
      input.value = 'essai' + i;
      btn.dispatchEvent(new win.Event('click'));
    }
    await wait(50);
    assert(!stage.textContent.includes('Gagné !'), 'les 3 premières saisies ne doivent pas valider');
    input.value = 'dernier';
    btn.dispatchEvent(new win.Event('click'));
    await until(() => stage.textContent.includes('Gagné !'), 3000, 'piège type : la 4e saisie valide');
    const replies = published.filter((p) => p.topic === `qrjoke/qrjoke-main/${code}/reply`).map((p) => JSON.parse(p.msg));
    assert.strictEqual(replies.length, 4, 'chaque saisie doit être renvoyée à la régie');
    assert.deepStrictEqual(replies.map((r) => r.text), ['essai0', 'essai1', 'essai2', 'dernier']);
  }

  // Dialogue en mode chat : pas d'escalade automatique, les réponses de la régie s'affichent
  // dans la scène en cours (sans la vider), et seul un trapEnd révèle.
  {
    const { stage, handlers, code } = await runReceiver('mac', {
      type: 'trap', trap: 'type', text: 'Discussion', placeholder: 'Écris ici', final: 'Piégé !', chat: true,
    });
    await until(() => stage.textContent.includes('Discussion'), 3000, 'chat affiché');
    const input = stage.querySelector('input');
    const btn = stage.querySelector('button');
    const win = stage.ownerDocument.defaultView;
    input.value = 'Salut ?';
    btn.dispatchEvent(new win.Event('click'));
    await until(() => stage.textContent.includes('Salut ?'), 3000, 'bulle de la victime affichée');
    assert.strictEqual(input.value, '', 'le champ se vide après envoi');

    const deliver = (joke) => handlers.message(`qrjoke/qrjoke-main/${code}/joke`, JSON.stringify({ type: 'joke', from: 'regie', joke }));
    deliver({ type: 'trapReply', text: 'Oui, tape le code' });
    await until(() => stage.textContent.includes('Oui, tape le code'), 3000, 'réponse de la régie affichée');
    assert(stage.textContent.includes('Discussion'), 'la scène ne doit pas être réinitialisée par une réponse de chat');

    deliver({ type: 'trapEnd' });
    await until(() => stage.textContent.includes('Piégé !'), 3000, 'trapEnd révèle la blague finale');
  }

  // Alerte native : juste un popup, ne touche pas à ce qui est déjà affiché à l'écran
  {
    const { dom, stage, handlers, code } = await runReceiver('windows', { type: 'text', text: 'Déjà affiché' });
    await until(() => stage.textContent.includes('Déjà affiché'), 3000, 'texte affiché avant l\'alerte');
    const calls = [];
    dom.window.alert = (msg) => calls.push(msg);
    const deliver = (joke) => handlers.message(`qrjoke/qrjoke-main/${code}/joke`, JSON.stringify({ type: 'joke', from: 'regie', joke }));
    deliver({ type: 'alert', text: 'Surprise !' });
    assert.deepStrictEqual(calls, ['Surprise !'], 'window.alert doit être appelé avec le texte voulu');
    assert(stage.textContent.includes('Déjà affiché'), 'l\'alerte ne doit pas effacer la scène en cours');
  }

  // Caméra surprise : affiche une demande explicite (Autoriser / Refuser), ne lance jamais
  // la caméra sans un clic de la victime en plus de la permission navigateur elle-même.
  {
    const { stage, handlers, code } = await runReceiver('windows', { type: 'camera' });
    await until(() => stage.textContent.includes('Caméra surprise'), 3000, 'demande de caméra affichée');
    const buttons = Array.from(stage.querySelectorAll('button')).map((b) => b.textContent);
    assert(buttons.some((t) => /Autoriser/.test(t)), 'bouton Autoriser absent');
    assert(buttons.some((t) => /Refuser/.test(t)), 'bouton Refuser absent');
    assert(!stage.querySelector('video') || !stage.querySelector('video').srcObject, 'la vidéo ne doit pas démarrer sans clic explicite');
    // Un autre message pendant ce temps doit pouvoir remplacer l'écran normalement (pas de blocage)
    const deliver = (joke) => handlers.message(`qrjoke/qrjoke-main/${code}/joke`, JSON.stringify({ type: 'joke', from: 'regie', joke }));
    deliver({ type: 'text', text: 'Après la demande caméra' });
    await until(() => stage.textContent.includes('Après la demande caméra'), 3000, 'la scène suivante remplace bien la demande caméra');
  }

  // 11 pranks interactifs : s'affichent, se nettoient (timers/listeners) quand une autre blague arrive
  {
    const { stage, handlers, code } = await runReceiver('windows', { type: 'prank', prank: 'possessed', intensity: 50 });
    await until(() => stage.textContent.includes('SIGNAL INSTABLE'), 3000, 'piège "possessed" affiché');
    const deliver = (joke) => handlers.message(`qrjoke/qrjoke-main/${code}/joke`, JSON.stringify({ type: 'joke', from: 'regie', joke }));
    deliver({ type: 'text', text: 'Après le prank' });
    await until(() => stage.textContent.includes('Après le prank'), 3000, 'un autre message remplace bien le prank');
    assert(!stage.textContent.includes('SIGNAL INSTABLE'), 'les restes du prank doivent avoir disparu');
  }
  {
    // Un nom de prank inconnu ne doit jamais planter (pranks.js a une branche "else" dédiée).
    const { stage } = await runReceiver('windows', { type: 'prank', prank: 'nimportequoi' });
    await until(() => stage.textContent.includes('Prank inconnu'), 3000, 'repli propre sur un nom de prank inconnu');
  }

  // Studio custom : le script est posé dans une iframe sandboxée, jamais exécuté dans la page QrJoke elle-même
  {
    const { stage } = await runReceiver('windows', { type: 'custom', code: "app.textContent = 'coucou';" });
    await until(() => stage.querySelector('iframe'), 3000, 'iframe du studio custom absente');
    const frame = stage.querySelector('iframe');
    assert.strictEqual(frame.getAttribute('sandbox'), 'allow-scripts', 'doit être sandboxée sans allow-same-origin (pas d\'accès à la page QrJoke)');
    assert(frame.srcdoc.includes('Content-Security-Policy'), 'doit poser une CSP restrictive dans le document chargé');
    assert(frame.srcdoc.includes("connect-src 'none'"), 'le script envoyé ne doit avoir aucun accès réseau');
    assert(frame.srcdoc.includes('coucou'), 'le code envoyé doit se retrouver (échappé) dans le document de l\'iframe');
  }

  // Fausse mise à jour interminable : la barre avance (et parfois redescend), mais ne finit jamais seule
  {
    const { stage, handlers, code } = await runReceiver('windows', { type: 'update' });
    await until(() => stage.querySelector('.bar'), 3000, 'barre de progression affichée');
    const fill = stage.querySelector('.bar > i');
    const widths = new Set();
    for (let i = 0; i < 8; i += 1) {
      await wait(460);
      widths.add(fill.style.width);
    }
    assert(widths.size > 1, 'la progression doit varier dans le temps (avancer et/ou redescendre)');
    assert(stage.querySelector('.bar'), "la mise à jour ne doit jamais se terminer d'elle-même");
    assert(!stage.textContent.includes('100'), 'ne doit jamais atteindre 100 %');

    // Seule une révélation manuelle de la régie y met fin
    const deliver = (joke) => handlers.message(`qrjoke/qrjoke-main/${code}/joke`, JSON.stringify({ type: 'joke', from: 'regie', joke }));
    deliver({ type: 'text', text: 'Gotcha !', confetti: true });
    await until(() => stage.textContent.includes('Gotcha !'), 3000, 'la révélation manuelle remplace la fausse mise à jour');
    assert(!stage.querySelector('.bar'), 'la barre doit avoir disparu après la révélation');
  }

  // Après un écran d'erreur, "clear" puis une blague normale : plus aucun style de l'écran d'erreur ne reste
  {
    const { dom, stage, handlers, code } = await runReceiver('windows', { type: 'oserror', os: 'windows', seconds: 30 });
    await until(() => stage.textContent.includes(PHRASE.windows), 3000, 'écran bleu affiché');
    assert(stage.getAttribute('style').includes('padding'), 'l\'écran bleu pose des styles');
    const deliver = (joke) => handlers.message(`qrjoke/qrjoke-main/${code}/joke`, JSON.stringify({ type: 'joke', from: 'regie', joke }));
    deliver({ type: 'clear' });
    assert.strictEqual(stage.textContent, '', 'clear doit vider la scène');
    deliver({ type: 'text', text: 'Après', bg: '#102030' });
    assert.strictEqual(stage.textContent, 'Après');
    const style = stage.getAttribute('style');
    assert(!/padding|font-family|align-items: flex-start|text-align: left/.test(style), 'des styles de l\'écran d\'erreur sont restés : ' + style);
    dom.window.close();
  }

  console.log('OK : écrans d\'erreur et récepteur validés');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('ÉCHEC :', e.message);
  process.exit(1);
});
