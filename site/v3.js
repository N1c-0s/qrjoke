/* QRJoke V3 Cyber Rouge : navigation par onglets + chaos/soundboard/NFC/bibliothèque/studio.
   Le contrôleur existant (remote.html) reste la seule source de vérité pour l'envoi réel ;
   ce fichier ne fait que réorganiser l'affichage et relayer les commandes via window.QrJokeV3Bridge. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  if (!app) return;
  const sections = [...app.querySelectorAll(':scope > section')];

  // Chaque entrée : [id, icône, libellé, idSectionExplicite ou null].
  const navs = [
    ['dashboard', '⚡', 'Accueil', 'v3dashboard'],
    ['appairage', '🔗', 'Appairage', null],
    ['blagues', '😄', 'Blagues rapides', null],
    ['systeme', '💥', 'Système & pièges', null],
    ['medias', '📷', 'Médias', null],
    ['pranks', '🎭', 'Pranks avancés', null],
    ['chaos', '◈', 'Chaos', 'v3chaos'],
    ['sounds', '♫', 'Soundboard', 'v3sounds'],
    ['nfc', '◉', 'NFC / QR', 'v3nfc'],
    ['library', '▤', 'Bibliothèque', 'v3library'],
    ['studio', '⌘', 'Studio JS', 'v3studio'],
    ['mirror', '▣', 'Retour écran', 'v3mirror'],
    ['reglages', '⚙', 'Réglages', null],
  ];
  // Regroupement des sections historiques (par titre <h2>) sous chaque onglet.
  const mapping = {
    appairage: ['Appairer un écran', 'Écrans connectés'],
    blagues: ['Blagues', 'Scénario automatique', 'Texte libre'],
    systeme: ['Erreur système', 'Fausse mise à jour', 'Pièges de bouton'],
    medias: ['Photo', 'Message vocal', 'Caméra', 'Microphone'],
    pranks: ['pranks interactifs', 'Studio custom'],
    reglages: ['Salon'],
  };

  function match(section, terms) {
    const t = section.querySelector('h2')?.textContent || '';
    return terms.some((term) => t.toLowerCase().includes(term.toLowerCase()));
  }

  const nav = document.createElement('aside');
  nav.id = 'v3nav';
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.append('☠ QRJOKE ');
  const brandTag = document.createElement('small');
  brandTag.style.fontSize = '10px';
  brandTag.style.color = '#94a3b8';
  brandTag.textContent = 'V3';
  brand.append(brandTag);
  nav.append(brand);
  const mobile = document.createElement('nav');
  mobile.id = 'v3mobile';
  document.body.append(nav, mobile);

  function show(id) {
    sections.forEach((s) => {
      let visible = false;
      const v = navs.find((x) => x[0] === id);
      if (v && v[3] === s.id) visible = true;
      if (mapping[id] && match(s, mapping[id])) visible = true;
      s.classList.toggle('v3visible', visible);
    });
    [nav, mobile].forEach((n) => n.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === id)));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  navs.forEach(([id, icon, name]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = icon + '  ' + name;
    b.dataset.view = id;
    nav.append(b);
    if (['dashboard', 'appairage', 'blagues', 'pranks', 'studio'].includes(id)) {
      mobile.append(b.cloneNode(true));
    }
  });
  nav.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view); });
  mobile.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view); });

  const kill = document.createElement('button');
  kill.type = 'button';
  kill.className = 'kill';
  kill.textContent = '■ TOUT ARRÊTER';
  nav.append(kill);

  function msg(text) {
    const live = $('v3live');
    if (live) live.textContent = text;
    const mirror = $('v3mirrorContent');
    if (mirror) mirror.textContent = text;
    const time = $('v3mirrorTime');
    if (time) time.textContent = 'Dernière action : ' + new Date().toLocaleTimeString();
  }

  function originalClear() {
    return $('clear');
  }

  // Relais vers la vraie fonction d'envoi MQTT du contrôleur (définie plus bas dans remote.html).
  async function send(j, label) {
    const bridge = window.QrJokeV3Bridge;
    if (!bridge) { msg('Connexion à la régie en cours…'); return; }
    await bridge(j, label);
    msg(label + ' · aperçu des commandes, pas de capture d’écran');
  }
  function stop() {
    const clearBtn = originalClear();
    if (clearBtn) clearBtn.click();
    send({ type: 'v3chaos', action: 'stop' }, 'Effets arrêtés');
    msg('Arrêt général demandé');
  }
  kill.onclick = stop;
  $('v3kill').onclick = stop;
  $('v3goPranks').onclick = () => show('pranks');

  window.setInterval(() => {
    const count = document.querySelectorAll('#targets .target').length - (document.querySelector('#targets input[value="all"]') ? 1 : 0);
    $('v3count').textContent = count;
  }, 1500);

  /* ----- Soundboard ----- */
  const soundNames = [
    ['duck', '🦆 Canard'], ['laser', '🔫 Laser arcade'], ['robot', '🤖 Robot'],
    ['alert', '🚨 Alarme fictive'], ['win', '🏆 Victoire'], ['boing', '🌀 Boing'],
  ];
  soundNames.forEach(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'v3sound';
    b.textContent = label;
    b.onclick = () => send({ type: 'v3sound', sound: id }, 'Son ' + label);
    $('v3soundGrid').append(b);
  });
  $('v3soundStop').onclick = () => send({ type: 'v3sound', sound: 'stop' }, 'Arrêt sons');

  /* ----- Console de chaos ----- */
  ['shake', 'glitch', 'zoom'].forEach((k) => {
    $('v3' + k).oninput = () => { $('v3' + k + 'Val').textContent = $('v3' + k).value; };
  });
  function chaos(action) {
    send({ type: 'v3chaos', action, shake: +$('v3shake').value, glitch: +$('v3glitch').value, zoom: +$('v3zoom').value }, 'Chaos ' + action);
  }
  $('v3chaosStart').onclick = () => chaos('start');
  $('v3chaosUpdate').onclick = () => chaos('update');
  $('v3chaosStop').onclick = () => chaos('stop');

  /* ----- Bibliothèque de pranks + favoris (mémorisés localement) ----- */
  const definitions = window.QrJokePranks?.definitions || [];
  const favorites = new Set(JSON.parse(localStorage.getItem('qj-v3-favorites') || '[]'));
  let query = '';
  function library() {
    const grid = $('v3libraryGrid');
    grid.replaceChildren();
    definitions
      .filter(([id, icon, name]) => (name + ' ' + id).toLowerCase().includes(query))
      .sort((a, b) => Number(favorites.has(b[0])) - Number(favorites.has(a[0])))
      .forEach(([id, icon, name]) => {
        const tile = document.createElement('div');
        tile.className = 'v3tile';
        const title = document.createElement('div');
        title.textContent = icon + ' ' + name;
        const run = document.createElement('button');
        run.type = 'button';
        run.textContent = '▶ Lancer';
        run.onclick = () => send({ type: 'prank', prank: id, intensity: 65, duration: 0 }, name);
        const fav = document.createElement('button');
        fav.type = 'button';
        fav.textContent = favorites.has(id) ? '★ Favori' : '☆ Favori';
        fav.onclick = () => {
          if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
          localStorage.setItem('qj-v3-favorites', JSON.stringify([...favorites]));
          library();
        };
        tile.append(title, run, fav);
        grid.append(tile);
      });
  }
  $('v3search').oninput = (e) => { query = e.target.value.toLowerCase(); library(); };
  library();

  /* ----- Gestionnaire d'URL NFC / QR (lien HTTPS uniquement, pas de connexion directe au broker) ----- */
  const tagSel = $('v3tagPrank');
  definitions.forEach(([id, emoji, name]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = emoji + ' ' + name;
    tagSel.append(opt);
  });
  const tags = JSON.parse(localStorage.getItem('qj-v3-tags') || '{}');
  function tagURL() {
    const id = $('v3tag').value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    const u = new URL('/', location.origin);
    u.searchParams.set('tag', id);
    if (tagSel.value) u.searchParams.set('autoprank', tagSel.value);
    const room = new URLSearchParams(location.search).get('room') || localStorage.getItem('qj-room');
    if (room) u.searchParams.set('room', room);
    return u.toString();
  }
  function tagRender() {
    const url = tagURL();
    $('v3tagUrl').textContent = url;
    const img = $('v3tagQr');
    try {
      const holder = document.createElement('div');
      new window.QRCode(holder, { text: url, width: 160, height: 160 });
      const rendered = holder.querySelector('canvas, img');
      if (rendered) img.src = rendered.tagName === 'CANVAS' ? rendered.toDataURL() : rendered.src;
    } catch (e) {
      img.alt = 'QR indisponible : ' + e.message;
    }
    $('v3tagList').replaceChildren();
    Object.entries(tags).forEach(([id, data]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = id + ' · ' + (data.prank || 'manuel');
      b.onclick = () => { $('v3tag').value = id; tagSel.value = data.prank || ''; tagRender(); };
      $('v3tagList').append(b);
    });
  }
  $('v3tag').oninput = tagRender;
  tagSel.onchange = tagRender;
  $('v3tagSave').onclick = () => {
    const id = $('v3tag').value.trim();
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id)) { window.alert('Identifiant invalide (lettres, chiffres, - ou _, 60 max).'); return; }
    tags[id] = { prank: tagSel.value };
    localStorage.setItem('qj-v3-tags', JSON.stringify(tags));
    tagRender();
  };
  $('v3tagCopy').onclick = () => navigator.clipboard.writeText(tagURL()).catch(() => window.alert('Copie indisponible sur ce navigateur.'));
  tagRender();

  /* ----- Studio JS V3 : mêmes modèles que le studio principal, exécution dans un cadre isolé ----- */
  const templates = {
    confetti: 'for(let i=0;i<45;i++){const s=document.createElement("span");s.textContent="🎉";s.style.cssText=`position:absolute;left:${Math.random()*100}%;top:${Math.random()*100}%;font-size:26px`;document.body.append(s)}',
    message: 'const h=document.createElement("h1");h.textContent="SURPRISE ! 😈";h.style.cssText="color:#ff4565;text-align:center;margin-top:25vh";document.body.replaceChildren(h);',
    matrix: 'document.body.style.background="#020a04";for(let i=0;i<65;i++){const s=document.createElement("span");s.textContent=Math.random()>0.5?"1":"0";s.style.cssText=`position:absolute;left:${Math.random()*100}%;top:${Math.random()*100}%;color:#28ff70;font:24px monospace`;document.body.append(s)}',
  };
  const editor = $('v3editor');
  editor.value = localStorage.getItem('qj-v3-script') || templates.confetti;
  $('v3loadTemplate').onclick = () => { editor.value = templates[$('v3template').value] || templates.confetti; };
  $('v3saveScript').onclick = () => { localStorage.setItem('qj-v3-script', editor.value); msg('Script sauvegardé localement'); };
  function preview() {
    const frame = $('v3previewFrame');
    frame.srcdoc = '<!doctype html><html><body style="background:#0b1120;color:white;overflow:hidden"><script>' + editor.value.replace(/<\/script/gi, '<\\/script') + '</scr' + 'ipt></body></html>';
  }
  $('v3previewBtn').onclick = preview;
  $('v3stopPreview').onclick = () => { $('v3previewFrame').srcdoc = ''; };
  $('v3sendScript').onclick = () => {
    if (editor.value.length > 12000) { window.alert('Limite 12 000 caractères.'); return; }
    send({ type: 'custom', code: editor.value, duration: 0 }, 'Studio Custom');
  };

  // Appairage par défaut (code/lien/QR + écrans connectés) : c'est ce dont on a besoin en
  // arrivant sur la régie, pas le tableau de bord. Les autres onglets restent à un clic.
  show('appairage');
})();
