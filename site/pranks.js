/* QRJoke extensions: effets visuels autonomes, nettoyage à chaque changement. */
(function(root){'use strict';
 const definitions=[
 ['possessed','👻','Écran possédé'],['infinite_update','🔄','Mise à jour infinie'],['cursors','🖱️','Invasion des curseurs'],['windows','🪟','Fenêtres immortelles'],['hacker','💀','Hacker fantôme'],['eye','👁️','Œil qui te suit'],['impossible_button','🏃','Bouton impossible'],['mind_reader','🔮','Détecteur de pensées'],['sassy_bot','🤖','Assistant insolent'],['lie_detector','📈','Détecteur de mensonges'],['cracked','💥','Écran fissuré']
 ];
 function run(stage,j){
  const name=j.prank, level=Math.max(1,Math.min(100,Number(j.intensity)||55));
  const timers=[], listeners=[]; let dead=false;
  const later=(f,ms)=>{const t=setTimeout(()=>{if(!dead)f();},ms);timers.push(['timeout',t]);return t;};
  const every=(f,ms)=>{const t=setInterval(()=>{if(!dead)f();},ms);timers.push(['interval',t]);return t;};
  const on=(el,ev,fn)=>{el.addEventListener(ev,fn);listeners.push([el,ev,fn]);};
  const el=(tag,cls,txt,parent=stage)=>{const x=document.createElement(tag);if(cls)x.className='qjp-'+cls;if(txt!==undefined)x.textContent=txt;parent.append(x);return x;};
  const title=(t)=>el('div','title',t);
  const rand=(n)=>Math.floor(Math.random()*n);
  const say=(t)=>{const p=el('div','message',t);return p;};
  stage.classList.add('qjp-stage');
  const css=document.createElement('style');css.textContent=`
 .qjp-stage{background:radial-gradient(ellipse at 50% 20%,#252044,#080b17 75%)!important;color:#f8fafc!important;cursor:default!important;font-family:system-ui,sans-serif!important}
 .qjp-title{font-weight:900;font-size:clamp(24px,5vw,65px);letter-spacing:.02em;text-shadow:0 0 30px #8b5cf6;text-align:center;z-index:2}
 .qjp-message{font-size:clamp(16px,2.5vw,28px);z-index:2;max-width:90%;text-align:center}
 .qjp-button{font-size:clamp(16px,2vw,26px);background:#7c3aed;color:white;border:2px solid #c4b5fd;padding:15px 26px;border-radius:16px;cursor:pointer;z-index:3}
 .qjp-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}
 .qjp-float{position:absolute;pointer-events:none;user-select:none}
 .qjp-panel{background:#181a30;border:1px solid #7c7aab;border-radius:16px;padding:22px;box-shadow:0 16px 60px #0009;max-width:min(85vw,580px);z-index:2}
 .qjp-bar{height:22px;width:min(78vw,550px);background:#24263a;border-radius:20px;overflow:hidden;border:1px solid #64748b;z-index:2}
 .qjp-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#f472b6);transition:width .35s}
 .qjp-glitch{animation:qjpglitch .13s steps(2) infinite alternate}
 @keyframes qjpglitch{from{filter:hue-rotate(0deg);transform:translate(-2px,1px)}to{filter:hue-rotate(120deg);transform:translate(3px,-2px)}}
 @keyframes qjpblink{50%{opacity:.1}}`;
  stage.append(css);
  const layer=el('div','layer');
  if(name==='possessed'){
   const t=title('SIGNAL INSTABLE');say('Quelque chose ne tourne pas rond…');
   every(()=>{t.classList.toggle('qjp-glitch');stage.style.filter=rand(3)===0?'contrast(1.8) hue-rotate('+rand(270)+'deg)':'';},Math.max(110,700-level*5));
   every(()=>{const x=el('div','float',rand(2)?'◉':'☠',layer);x.style.cssText=`left:${rand(85)}%;top:${rand(85)}%;font-size:${40+rand(100)}px;color:#f43f5e;text-shadow:0 0 40px red`;later(()=>x.remove(),250);},1100);
  }else if(name==='infinite_update'){
   title('Installation des mises à jour');const p=say('Préparation…');const bar=el('div','bar');const fill=el('div','fill',undefined,bar);let n=0,cycle=0;
   every(()=>{n+=1+rand(4);if(n>=99){n=cycle++%2?7:12;p.textContent='Recalcul des '+(4821+cycle*13)+' mises à jour restantes…';}else p.textContent=n+' % terminé · Ne pas éteindre (pour de faux)';fill.style.width=n+'%';},Math.max(140,750-level*5));
  }else if(name==='cursors'){
   title('La souris a des amis');const pointers=[];
   every(()=>{if(pointers.length>Math.min(85,10+level))pointers.shift().remove();const x=el('div','float','➤',layer);x.style.cssText=`left:${rand(95)}%;top:${rand(90)}%;font-size:${18+rand(30)}px;color:${['#fff','#f472b6','#38bdf8'][rand(3)]};transform:rotate(${rand(360)}deg)`;pointers.push(x);},Math.max(75,450-level*3));
   on(stage,'pointermove',e=>{pointers.slice(-12).forEach((p,i)=>{p.style.left=(e.clientX+rand(180)-90)+'px';p.style.top=(e.clientY+rand(180)-90)+'px';});});
  }else if(name==='windows'){
   title('Une petite confirmation…');let count=0;
   const spawn=()=>{if(count++>30){say('Vous avez gagné 30 fenêtres !');return;}const d=el('div','panel');d.style.cssText=`position:absolute;left:${rand(65)}%;top:${rand(65)}%;width:min(280px,80vw);padding:14px;z-index:${10+count}`;el('div','', 'Erreur imaginaire n° '+count,d);const b=el('button','button','Fermer',d);on(b,'click',()=>{d.remove();spawn();spawn();});};spawn();
  }else if(name==='hacker'){
   title('☠ ACCÈS CINÉMATOGRAPHIQUE ☠');const term=el('pre','panel');term.style.cssText='width:min(90vw,800px);height:55vh;overflow:hidden;text-align:left;font:clamp(11px,2vw,17px) monospace;color:#4ade80;white-space:pre-wrap';const lines=['[SIMULATION] Connexion au serveur des blagues','Analyse des chaussettes quantiques…','Protocole CANARD/9000 activé','Déchiffrement de la recette des crêpes','Accès refusé : trop de style','Injection de confettis virtuelle','Système de prank opérationnel'];
   every(()=>{term.textContent=(term.textContent+'\n> '+lines[rand(lines.length)]).slice(-2600);term.scrollTop=term.scrollHeight;},Math.max(80,400-level*3));
  }else if(name==='eye'){
   title('Je te vois… enfin, ton curseur');const eye=el('div','', '👁️');eye.style.cssText='font-size:clamp(100px,30vmin,320px);filter:drop-shadow(0 0 25px #a78bfa);transition:transform .1s';
   on(stage,'pointermove',e=>{eye.style.transform=`translate(${(e.clientX-innerWidth/2)*.06}px,${(e.clientY-innerHeight/2)*.06}px) rotate(${(e.clientX/innerWidth-.5)*20}deg)`;});on(stage,'pointerdown',()=>say('Aïe, pas dans l’œil !'));
  }else if(name==='impossible_button'){
   title('Clique sur ce bouton');const b=el('button','button','Continuer');b.style.position='absolute';b.style.left='42%';b.style.top='55%';let tries=0;
   const dodge=()=>{tries++;b.style.left=(5+rand(65))+'%';b.style.top=(20+rand(65))+'%';b.textContent=tries>7?'Toujours raté 😈':'Continuer';};on(b,'pointerenter',dodge);on(b,'touchstart',e=>{e.preventDefault();dodge();},{passive:false});on(b,'click',()=>{say('Tu m’as eu ! 🎉');b.remove();});
  }else if(name==='mind_reader'){
   title('🔮 Lecture de pensées');say('Pense très fort à une couleur…');const b=el('button','button','J’ai choisi !');const answers=['Tu pensais à… une pizza ?','Je vois… un canard intergalactique.','La réponse est 42. Évidemment.','Je lis : « Pourquoi ai-je scanné ce QR code ? »'];on(b,'click',()=>{b.remove();say(answers[rand(answers.length)]);});
  }else if(name==='sassy_bot'){
   title('🤖 Assistant QRJoke');const face=el('div','','🤖');face.style.fontSize='clamp(90px,25vmin,240px)';const p=say('Bonjour, humain.');const phrases=['Encore un clic ? Ambitieux.','Je demande une augmentation en pixels.','Tu es sûr de savoir ce que tu fais ?','Je crois que le bouton est plus intelligent.','Analyse terminée : 100 % de curiosité.'];every(()=>{p.textContent=phrases[rand(phrases.length)];face.style.transform='rotate('+(rand(20)-10)+'deg)';},2600);
  }else if(name==='lie_detector'){
   title('📈 Détecteur de mensonges (100 % bidon)');const q=say('As-tu déjà mangé la dernière part de pizza ?');const result=el('div','message','');const yes=el('button','button','Oui');const no=el('button','button','Non');const answer=()=>{yes.remove();no.remove();q.textContent='Analyse scientifique totalement inventée…';later(()=>result.textContent=rand(2)?'MENSONGE DÉTECTÉ 🚨':'VÉRITÉ… probablement 😇',1600);};on(yes,'click',answer);on(no,'click',answer);
  }else if(name==='cracked'){
   title('Oups…');say('Ne touche surtout pas à l’écran !');let count=0;
   const crack=(x,y)=>{const s=el('div','float','✳',layer);s.style.cssText=`left:${x}px;top:${y}px;color:#e0f2fe;text-shadow:0 0 6px #fff;font-size:${60+rand(100)}px;transform:translate(-50%,-50%) rotate(${rand(360)}deg)`;count++;if(count>=6)say('Pas de panique, ce sont juste des pixels 😄');};
   on(stage,'pointerdown',e=>crack(e.clientX,e.clientY));every(()=>{if(count<6)crack(rand(innerWidth),rand(innerHeight));},Math.max(650,2200-level*10));
  }else{title('Prank inconnu');}
  return ()=>{dead=true;timers.forEach(([kind,t])=>kind==='interval'?clearInterval(t):clearTimeout(t));listeners.forEach(([node,ev,fn])=>node.removeEventListener(ev,fn));stage.style.filter='';stage.classList.remove('qjp-stage');};
 }
 root.QrJokePranks={definitions,run};
})(window);
