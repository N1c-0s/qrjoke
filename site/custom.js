/* Le code personnalisé s'exécute dans un iframe sandboxé sans accès à QRJoke, MQTT ou à la page parente. */
(function(root){'use strict';
 function run(stage,code){
  const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('title','Prank personnalisé');
  frame.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0;background:#070a18;z-index:2';
  const safe=JSON.stringify(String(code||'')).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  frame.srcdoc=`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>html,body{height:100%;margin:0;background:#070a18;color:white;font:20px system-ui;overflow:hidden}body{display:flex;align-items:center;justify-content:center;text-align:center}button{cursor:pointer}</style><body><div id="app">🎭 Chargement du prank personnalisé…</div><script>try{(new Function('app','document','window',${safe}))(document.getElementById('app'),document,window)}catch(e){document.getElementById('app').textContent='Erreur dans ton script : '+e.message}<\/script></body></html>`;
  stage.append(frame);return ()=>frame.remove();
 }
 root.QrJokeCustom={run};
})(window);
