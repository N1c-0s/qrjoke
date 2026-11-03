/* QRJoke Camera: WebRTC video, MQTT signaling only. Explicit on-screen opt-in. */
(function () {
  'use strict';
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const id = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^a-z0-9]/gi, '').slice(0, 24);
  function create(room, broker, code, role, status) {
    const topic = `qrjoke/${room}/${code}/camera`;
    const instance = id();
    const client = mqtt.connect(broker, { clientId: 'qjc_' + id(), reconnectPeriod: 2000 });
    let pc = null, stream = null, session = null, onSignal = () => {}, closed = false;
    client.on('connect', () => client.subscribe(topic));
    client.on('error', () => status('Connexion caméra indisponible'));
    client.on('message', (t, raw) => {
      if (t !== topic || raw.length > 18000) return;
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || m.from === instance || m.to !== role || typeof m.kind !== 'string') return;
      if (m.kind !== 'offer' && m.session !== session) return;
      onSignal(m);
    });
    const send = (kind, payload = {}) => {
      if (!closed && client.connected) client.publish(topic, JSON.stringify({ kind, from: instance, to: role === 'receiver' ? 'remote' : 'receiver', session, ...payload }), { qos: 0 });
    };
    const closePeer = () => {
      if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.close(); pc = null; }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    };
    const makePeer = () => {
      closePeer(); pc = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = e => { if (e.candidate) send('ice', { candidate: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => { if (pc && pc.connectionState === 'failed') status('Connexion vidéo échouée (réseau/NAT)'); };
      return pc;
    };
    async function receiverOffer(video) {
      session = id();
      const current = makePeer();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      stream.getTracks().forEach(t => current.addTrack(t, stream));
      const offer = await current.createOffer();
      await current.setLocalDescription(offer);
      send('offer', { sdp: current.localDescription });
      status('Caméra active · diffusion en attente de connexion');
    }
    async function handleReceiver(m) {
      if (!pc || !session) return;
      if (m.kind === 'answer' && m.sdp) { await pc.setRemoteDescription(m.sdp); status('Caméra active · vidéo partagée'); }
      if (m.kind === 'ice' && m.candidate) await pc.addIceCandidate(m.candidate).catch(() => {});
      if (m.kind === 'stop') { closePeer(); session = null; status('Diffusion arrêtée'); }
    }
    async function handleRemote(m, video) {
      if (m.kind === 'offer' && m.sdp && !session) {
        session = m.session;
        const current = makePeer();
        current.ontrack = e => { video.srcObject = e.streams[0]; status('Vidéo en direct'); };
        await current.setRemoteDescription(m.sdp);
        const answer = await current.createAnswer();
        await current.setLocalDescription(answer);
        send('answer', { sdp: current.localDescription });
      } else if (m.kind === 'ice' && pc && m.candidate) await pc.addIceCandidate(m.candidate).catch(() => {});
      else if (m.kind === 'stop') { closePeer(); session = null; video.srcObject = null; status('Diffusion terminée'); }
    }
    return {
      setHandler(fn) { onSignal = m => Promise.resolve(fn(m)).catch(e => status('Erreur caméra : ' + e.message)); },
      receiverOffer, handleReceiver, handleRemote,
      stop() { send('stop'); closePeer(); session = null; },
      destroy() { this.stop(); closed = true; client.end(true); },
    };
  }
  window.QrJokeCamera = { create };
})();
