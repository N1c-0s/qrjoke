/*
 * QrJoke : faux écrans d'erreur système pour la blague (Windows, Mac, Android, iPhone).
 *
 * Tout est dessiné en HTML/CSS/SVG : aucune image, aucun logo de marque, aucun numéro de
 * support, aucun champ à remplir. Chaque écran se termine par un appel à ctx.done()
 * (délai écoulé ou interaction), et la page affiche alors la révélation « Blague ! ».
 *
 * Utilisation : QrJokeScreens.render('windows', { stage, seconds, done, cancel, spinnerMs })
 *   - stage  : élément plein écran dans lequel dessiner
 *   - done   : appelée une seule fois quand l'écran a fini
 *   - cancel : (fn) => void, enregistre une fonction de nettoyage (timers, écouteurs)
 * Les animations @keyframes "rise" et "spin" sont définies dans index.html.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QrJokeScreens = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OS_LIST = ['windows', 'mac', 'android', 'iphone'];

  const MAC_TEXT = [
    ["Votre ordinateur a redémarré à cause d'un problème.", 'Appuyez sur une touche ou attendez quelques secondes pour continuer.'],
    ['Your computer restarted because of a problem.', 'Press a key or wait a few seconds to continue.'],
    ['Dein Computer wurde aufgrund eines Problems neu gestartet.', 'Drücke eine Taste oder warte einige Sekunden, um fortzufahren.'],
    ['Tu ordenador se ha reiniciado debido a un problema.', 'Pulsa una tecla o espera unos segundos para continuar.'],
    ['Il computer è stato riavviato a causa di un problema.', 'Premi un tasto o attendi qualche secondo per continuare.'],
    ['問題が発生したため、コンピュータが再起動しました。', '続けるにはキーを押すか、数秒お待ちください。'],
    ['电脑因出现问题而重新启动。', '请按任意键或等待几秒钟以继续。'],
  ];

  function setup(ctx) {
    const stage = ctx.stage;
    const doc = stage.ownerDocument;
    const el = (tag, css, text) => {
      const e = doc.createElement(tag);
      if (css) e.style.cssText = css;
      if (text != null) e.textContent = text;
      return e;
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ctx.done();
    };
    return {
      stage, doc, el, finish,
      seconds: Math.max(1, Number(ctx.seconds) || 12),
      cancel: ctx.cancel || (() => {}),
      spinnerMs: Number(ctx.spinnerMs) || 3000,
    };
  }

  const clockText = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  /** Faux code QR décoratif (non scannable) : trois repères et des modules pseudo-aléatoires. */
  function fakeQr(doc, size, ink) {
    const NS = 'http://www.w3.org/2000/svg';
    const n = 25;
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `-2 -2 ${n + 4} ${n + 4}`);
    svg.style.cssText = `width:${size};height:${size};background:#fff;display:block;flex:none`;
    const rect = (x, y, w, h, fill) => {
      const r = doc.createElementNS(NS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', w); r.setAttribute('height', h);
      r.setAttribute('fill', fill);
      svg.appendChild(r);
    };
    const finder = (x, y) => { rect(x, y, 7, 7, ink); rect(x + 1, y + 1, 5, 5, '#fff'); rect(x + 2, y + 2, 3, 3, ink); };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const inFinder = (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
        if (!inFinder && rnd() > 0.52) rect(x, y, 1, 1, ink);
      }
    }
    return svg;
  }

  const screens = {};

  /* ----- Windows : écran bleu ----- */
  screens.windows = function (ctx) {
    const { stage, doc, el, finish, seconds, cancel } = setup(ctx);
    const s = stage.style;
    s.background = '#0078d4'; s.color = '#fff'; s.cursor = 'none';
    s.alignItems = 'flex-start'; s.justifyContent = 'center'; s.textAlign = 'left';
    s.padding = '0 8vw'; s.gap = '0';
    s.fontFamily = '"Segoe UI","Segoe UI Variable",system-ui,sans-serif';

    const big = 'font-size:max(3.4vh,2vw);line-height:1.35;';
    const small = 'font-size:max(2.1vh,1.2vw);line-height:1.4;';
    const pct = el('div', big + 'margin-bottom:4vh', '0 % terminé');
    const info = el('div', 'max-width:60vw');
    info.append(
      el('div', small + 'margin-bottom:1.4vh', "Pour plus d'informations sur ce problème et sur les solutions possibles, analysez le code QR."),
      el('div', small, "Code d'arrêt : CRITICAL_PROCESS_DIED"),
    );
    const row = el('div', 'display:flex;align-items:center;gap:3vh');
    row.append(fakeQr(doc, '13vh', '#0078d4'), info);

    stage.append(
      el('div', 'font-size:22vh;line-height:1;font-weight:300;margin-bottom:3vh', ':('),
      el('div', big + 'max-width:84vw;margin-bottom:4vh',
        "Votre PC a rencontré un problème et doit redémarrer. Nous collectons simplement des informations sur l'erreur, puis nous allons redémarrer pour vous."),
      pct, row,
    );

    const total = seconds * 1000;
    const t0 = Date.now();
    let last = 0, endTimer = null;
    const iv = setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / total);
      const p = t >= 1 ? 100 : Math.min(99, Math.max(last, Math.floor(100 * (t + 0.05 * Math.sin(t * 25)))));
      last = p;
      pct.textContent = p + ' % terminé';
      if (t >= 1) { clearInterval(iv); endTimer = setTimeout(finish, 700); }
    }, 150);
    cancel(() => { clearInterval(iv); clearTimeout(endTimer); });
  };

  /* ----- Mac : redémarrage après un problème ----- */
  screens.mac = function (ctx) {
    const { stage, doc, el, finish, seconds, cancel } = setup(ctx);
    const s = stage.style;
    s.background = '#000'; s.color = '#fff'; s.cursor = 'none';
    s.justifyContent = 'center'; s.gap = '2.2vh'; s.padding = '3vh 4vw';
    s.fontFamily = '-apple-system,"SF Pro Text",system-ui,sans-serif';
    for (const [a, b] of MAC_TEXT) {
      stage.append(el('div', 'font-size:max(2.7vh,1.6vw);line-height:1.3;text-align:center;max-width:96vw;white-space:pre-line', a + '\n' + b));
    }
    const to = setTimeout(finish, seconds * 1000);
    const skip = () => finish(); // « Appuyez sur une touche » : une touche ou un clic termine tout de suite
    doc.addEventListener('keydown', skip);
    stage.addEventListener('pointerdown', skip);
    cancel(() => {
      clearTimeout(to);
      doc.removeEventListener('keydown', skip);
      stage.removeEventListener('pointerdown', skip);
    });
  };

  /* ----- Android : application qui ne répond pas ----- */
  screens.android = function (ctx) {
    const { stage, el, finish, seconds, cancel } = setup(ctx);
    const s = stage.style;
    s.background = 'linear-gradient(160deg,#1c2a73 0%,#4a2b82 48%,#171347 100%)';
    s.color = '#fff'; s.cursor = 'default';
    s.justifyContent = 'center'; s.alignItems = 'center'; s.padding = '0'; s.gap = '0';
    s.fontFamily = 'Roboto,"Google Sans",system-ui,sans-serif';

    const abs = 'position:absolute;';
    const status = 'font-size:max(2.2vh,1.4vw);';
    stage.append(
      el('div', abs + 'top:2.2vh;left:4vw;' + status, clockText()),
      el('div', abs + 'top:2.2vh;right:4vw;' + status, '76 %'),
      el('div', abs + 'top:11vh;left:7vw;right:7vw;height:11vh;border-radius:99px;background:rgba(255,255,255,.22)'),
    );
    const dock = el('div', abs + 'bottom:11vh;left:8vw;right:8vw;display:flex;justify-content:space-between');
    for (const c of ['#2e7d32', '#1565c0', '#9e9e9e', '#455a64', '#6a1b9a']) {
      dock.append(el('div', `width:9vh;height:9vh;border-radius:30%;background:${c};opacity:.85`));
    }
    const nav = el('div', abs + 'bottom:2.2vh;left:0;right:0;display:flex;justify-content:space-around;font-size:max(3vh,2vw);opacity:.85');
    nav.append(el('span', null, '|||'), el('span', null, '○'), el('span', null, '‹'));
    stage.append(dock, nav, el('div', abs + 'inset:0;background:rgba(0,0,0,.32)'));

    const card = el('div',
      'position:relative;background:#fff;color:#1c1b1f;border-radius:28px;width:min(88vw,640px);' +
      'padding:4vh 5vw 2.4vh;box-shadow:0 10px 50px rgba(0,0,0,.5);text-align:center;animation:rise .25s ease-out');
    card.append(el('div', 'font-size:clamp(18px,3.4vmin,32px);font-weight:500;line-height:1.3;margin-bottom:3.4vh', 'Appli Système ne répond pas'));
    const buttons = el('div', 'display:flex;justify-content:space-around;gap:2vw');
    for (const label of ["Fermer l'appli", 'Attendre']) {
      const b = el('button',
        'background:none;border:0;color:#1a56f0;font:inherit;font-size:clamp(16px,3vmin,28px);font-weight:600;cursor:pointer;padding:1.6vh 2vw',
        label);
      b.type = 'button';
      b.addEventListener('click', finish);
      buttons.append(b);
    }
    card.append(buttons);
    stage.append(card);

    const to = setTimeout(finish, seconds * 1000);
    cancel(() => clearTimeout(to));
  };

  /* ----- iPhone : alerte puis redémarrage ----- */
  screens.iphone = function (ctx) {
    const { stage, doc, el, finish, seconds, cancel, spinnerMs } = setup(ctx);
    const s = stage.style;
    s.background = 'linear-gradient(170deg,#0a1030 0%,#1a0f3a 55%,#08121f 100%)';
    s.color = '#fff'; s.cursor = 'default';
    s.justifyContent = 'center'; s.alignItems = 'center'; s.padding = '0'; s.gap = '0';
    s.fontFamily = '-apple-system,"SF Pro Text",system-ui,sans-serif';

    const abs = 'position:absolute;';
    const grid = el('div', abs + 'inset:9vh 6vw 6vh 6vw;display:grid;grid-template-columns:repeat(4,1fr);gap:4vh 4vw;filter:blur(6px);opacity:.75');
    const palette = ['#1fa855', '#2d6cdf', '#e5484d', '#8e8e93', '#f5a524', '#7c3aed', '#0ea5e9', '#16a34a',
      '#ef4444', '#a1a1aa', '#2563eb', '#f97316', '#14b8a6', '#6366f1', '#22c55e', '#525252'];
    for (const c of palette) grid.append(el('div', `aspect-ratio:1;border-radius:24%;background:${c}`));

    const bars = el('div', 'display:flex;align-items:flex-end;gap:.35vmin;margin-right:1vmin');
    [1.2, 1.9, 2.6, 3.3].forEach((h) => bars.append(el('div', `width:.7vmin;height:${h}vmin;background:#fff;border-radius:.2vmin`)));
    const battery = el('div', 'width:5vmin;height:2.4vmin;border:.25vmin solid rgba(255,255,255,.7);border-radius:.7vmin;padding:.2vmin;margin-left:1vmin;box-sizing:border-box');
    battery.append(el('div', 'width:76%;height:100%;background:#fff;border-radius:.3vmin'));
    const right = el('div', abs + 'top:2vh;right:5vw;display:flex;align-items:center;font-size:max(2.2vh,1.4vw);font-weight:600');
    right.append(bars, el('span', null, '76 %'), battery);

    const card = el('div',
      'position:relative;width:min(80vw,540px);background:rgba(70,70,80,.58);' +
      '-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);' +
      'border:1px solid rgba(255,255,255,.18);border-radius:22px;overflow:hidden;text-align:center;animation:rise .25s ease-out');
    const text = el('div', 'padding:3.4vh 5vw 2.8vh');
    text.append(
      el('div', 'font-size:clamp(18px,3.4vmin,30px);font-weight:700;margin-bottom:1vh', 'Une erreur est survenue'),
      el('div', 'font-size:clamp(15px,2.8vmin,26px);line-height:1.35;color:rgba(255,255,255,.82)', "Le système doit redémarrer pour terminer l'opération."),
    );
    const ok = el('button',
      'display:block;width:100%;background:none;border:0;border-top:1px solid rgba(255,255,255,.25);color:#0a84ff;' +
      'font:inherit;font-size:clamp(18px,3.4vmin,30px);font-weight:700;padding:2vh 0;cursor:pointer',
      'OK');
    ok.type = 'button';
    card.append(text, ok);
    stage.append(grid, el('div', abs + 'top:2vh;left:5vw;font-size:max(2.2vh,1.4vw);font-weight:600', clockText()), right, card);

    let phase2 = false, autoTimer = null, endTimer = null;
    const restart = () => {
      if (phase2) return;
      phase2 = true;
      clearTimeout(autoTimer);
      stage.replaceChildren();
      stage.style.background = '#000';
      stage.style.cursor = 'none';
      const NS = 'http://www.w3.org/2000/svg';
      const svg = doc.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 50 50');
      svg.style.cssText = 'width:7vmin;height:7vmin;animation:spin 1s linear infinite';
      const c = doc.createElementNS(NS, 'circle');
      [['cx', 25], ['cy', 25], ['r', 20], ['fill', 'none'], ['stroke', '#fff'], ['stroke-width', 4],
        ['stroke-linecap', 'round'], ['stroke-dasharray', '90 150']].forEach(([k, v]) => c.setAttribute(k, v));
      svg.appendChild(c);
      stage.append(svg);
      endTimer = setTimeout(finish, spinnerMs);
    };
    ok.addEventListener('click', restart);
    autoTimer = setTimeout(restart, seconds * 1000);
    cancel(() => { clearTimeout(autoTimer); clearTimeout(endTimer); });
  };

  /* ---------- Pièges de bouton (OK impossible à cliquer, par OS) ---------- */

  /** Style de bouton par OS : { primary(label), secondary(label) } -> éléments posés dans le conteneur. */
  const BUTTON_STYLE = {
    windows: (doc, label, primary) => {
      const b = doc.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = `font:15px "Segoe UI",sans-serif;padding:7px 22px;border-radius:3px;cursor:pointer;` +
        (primary ? 'background:#0078d4;color:#fff;border:1px solid #0078d4;' : 'background:#e1e1e1;color:#1a1a1a;border:1px solid #adadad;');
      return b;
    },
    mac: (doc, label, primary) => {
      const b = doc.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = `font:15px -apple-system,sans-serif;padding:8px 22px;border-radius:999px;cursor:pointer;border:0;` +
        (primary ? 'background:#0a84ff;color:#fff;' : 'background:#3a3a3c;color:#fff;');
      return b;
    },
    android: (doc, label, primary) => {
      const b = doc.createElement('button');
      b.type = 'button'; b.textContent = label.toUpperCase();
      b.style.cssText = `font:14px Roboto,sans-serif;font-weight:600;letter-spacing:.03em;padding:9px 14px;` +
        `border-radius:6px;cursor:pointer;border:0;background:transparent;` + (primary ? 'color:#8ab4f8;' : 'color:#ccc;');
      return b;
    },
    iphone: (doc, label, primary) => {
      const b = doc.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = `font:17px -apple-system,sans-serif;padding:11px 0;width:100%;cursor:pointer;` +
        `border:0;border-top:1px solid rgba(255,255,255,.25);background:transparent;` +
        (primary ? 'color:#0a84ff;font-weight:600;' : 'color:#0a84ff;');
      return b;
    },
  };

  /** Dessine le piège demandé (shrink, swap, fakeclick) stylé selon l'OS, dans ctx.stage. */
  function renderTrap(kind, os, ctx) {
    const c = setup(ctx);
    const name = Object.prototype.hasOwnProperty.call(BUTTON_STYLE, os) ? os : 'windows';
    const mk = BUTTON_STYLE[name];
    const stacked = name === 'iphone'; // iOS empile ses boutons plutôt que côte à côte

    const title = c.el('div', 'font:600 4vmin system-ui,sans-serif;margin-bottom:3vmin;max-width:80vw;text-align:center;');
    title.textContent = ctx.text || 'Continuer ?';
    const box = c.el('div', stacked
      ? 'display:flex;flex-direction:column;width:min(80vw,320px);'
      : 'display:flex;gap:2vmin;align-items:center;');
    c.stage.append(title, box);

    const okLabel = ctx.button || 'OK';
    const cancelLabel = ctx.button2 || 'Annuler';

    if (kind === 'swap') {
      const ok = mk(c.doc, okLabel, true), cancelBtn = mk(c.doc, cancelLabel, false);
      // Ordre habituel (Annuler puis OK) ; les deux boutons échangent de place à chaque survol.
      box.append(cancelBtn, ok);
      let swapped = false;
      const flip = () => { swapped = !swapped; box.replaceChildren(swapped ? ok : cancelBtn, swapped ? cancelBtn : ok); };
      ok.addEventListener('pointerenter', flip);
      cancelBtn.addEventListener('pointerenter', flip);
      ok.addEventListener('click', c.finish);
      cancelBtn.addEventListener('click', c.finish);
      c.cancel(() => {});
      return;
    }

    if (kind === 'shrink') {
      const ok = mk(c.doc, okLabel, true);
      box.append(ok);
      let scale = 1, tries = 0;
      ok.style.transition = 'transform .18s ease-out';
      ok.addEventListener('pointerenter', () => {
        if (tries >= 7) return; // au bout d'un moment, le bouton redevient cliquable
        tries += 1;
        scale = Math.max(0.28, scale - 0.11);
        ok.style.transform = `scale(${scale.toFixed(2)})`;
      });
      ok.addEventListener('click', () => {
        if (tries < 7) return; // encore trop petit pour un clic fiable : on ignore
        c.finish();
      });
      c.cancel(() => {});
      return;
    }

    // fakeclick : le bouton réagit (s'enfonce) mais ne valide rien les premières fois
    const PHRASES = ['Presque…', 'Toujours pas ?', 'Encore un petit effort…', 'Bon, d\'accord.'];
    const ok = mk(c.doc, okLabel, true);
    box.append(ok);
    let tries = 0;
    ok.addEventListener('click', () => {
      tries += 1;
      ok.style.transform = 'scale(.94)';
      setTimeout(() => { ok.style.transform = ''; }, 90);
      if (tries < 4) { title.textContent = PHRASES[Math.min(tries - 1, PHRASES.length - 1)]; return; }
      c.finish();
    });
    c.cancel(() => {});
  }

  /** Dessine l'écran demandé (Windows par défaut) et renvoie le nom réellement utilisé. */
  function render(os, ctx) {
    const name = Object.prototype.hasOwnProperty.call(screens, os) ? os : 'windows';
    screens[name](ctx);
    return name;
  }

  return { OS_LIST, render, renderTrap };
});
