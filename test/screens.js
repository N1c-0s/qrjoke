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
  const indexHtml = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')
    .replace('<script src="/vendor/mqtt.min.js"></script>', '')
    .replace('<script src="/core.js"></script>', () => `<script>${coreSrc}</script>`)
    .replace('<script src="/screens.js"></script>', () => `<script>${screensSrc}</script>`);

  async function runReceiver(uaKey, joke, { touch = 0, path = '/42', typed = null } = {}) {
    const handlers = {};
    const published = [];
    const fakeMqtt = {
      connect() {
        const client = {
          on(ev, fn) { handlers[ev] = fn; return client; },
          subscribe(t, o, cb) { setTimeout(() => cb(null), 0); },
          publish(topic, msg, o, cb) { published.push({ topic, msg }); if (cb) setTimeout(cb, 0); },
          end() {},
        };
        setTimeout(() => handlers.connect && handlers.connect(), 5);
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
    return { dom, stage, document, handlers, id, code };
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
