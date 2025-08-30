/* ====== UI / Player ====== */
const video = document.getElementById('player');
const fileInput = document.getElementById('fileInput');
const urlForm = document.getElementById('urlForm');
const urlInput = document.getElementById('urlInput');
const volumeRange = document.getElementById('volumeRange');
const boostRange = document.getElementById('boostRange');
const rateRange = document.getElementById('playbackRate');
const statusEl = document.getElementById('status');
const airplayBtn = document.getElementById('airplayBtn');
const castBtn = document.getElementById('castBtn');

function setStatus(msg) { statusEl.textContent = msg; console.log(msg); }

/* Show AirPlay button if supported (Safari/iOS/macOS) */
if (window.WebKitPlaybackTargetAvailabilityEvent || (video && 'webkitShowPlaybackTargetPicker' in video)) {
  airplayBtn.hidden = false;
}

airplayBtn?.addEventListener('click', () => {
  if (video && typeof video.webkitShowPlaybackTargetPicker === 'function') {
    video.webkitShowPlaybackTargetPicker();
  } else {
    alert("AirPlay non disponible dans ce navigateur.");
  }
});

/* Load local file (AirPlay OK, Cast nécessite URL publique) */
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  loadMediaIntoVideo(url, file.type || guessContentType(file.name));
  setStatus(`Fichier chargé: ${file.name}`);
});

/* Load URL */
urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const src = urlInput.value.trim();
  if (!src) return;
  loadMediaIntoVideo(src, guessContentType(src));
  setStatus(`URL chargée: ${src}`);
});

/* WebAudio: Gain (boost) + Compressor anti-clip */
let audioCtx, sourceNode, gainNode, compressor;
function ensureAudioGraph() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaElementSource(video);
  gainNode = audioCtx.createGain();
  compressor = audioCtx.createDynamicsCompressor();
  // Compresseur doux pour éviter la saturation avec le boost
  compressor.threshold.setValueAtTime(-16, audioCtx.currentTime);
  compressor.knee.setValueAtTime(24, audioCtx.currentTime);
  compressor.ratio.setValueAtTime(6, audioCtx.currentTime);
  compressor.attack.setValueAtTime(0.005, audioCtx.currentTime);
  compressor.release.setValueAtTime(0.1, audioCtx.currentTime);

  sourceNode.connect(gainNode).connect(compressor).connect(audioCtx.destination);
}
video.addEventListener('play', ensureAudioGraph);

volumeRange.addEventListener('input', () => {
  video.volume = parseFloat(volumeRange.value);
});
boostRange.addEventListener('input', () => {
  ensureAudioGraph();
  const boost = parseFloat(boostRange.value); // 1–4
  gainNode.gain.setValueAtTime(boost, audioCtx.currentTime);
});
rateRange.addEventListener('input', () => {
  video.playbackRate = parseFloat(rateRange.value);
});

/* Helper: load media into <video> */
function loadMediaIntoVideo(src, type = '') {
  const wasPlaying = !video.paused;
  video.src = src;
  if (type) video.type = type;
  video.load();
  if (wasPlaying) video.play().catch(()=>{});
}

/* Guess content-type from extension */
function guessContentType(url) {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp4') || u.endsWith('.m4v')) return 'video/mp4';
  if (u.endsWith('.webm')) return 'video/webm';
  if (u.endsWith('.mp3')) return 'audio/mpeg';
  if (u.endsWith('.aac')) return 'audio/aac';
  if (u.endsWith('.ogg') || u.endsWith('.oga')) return 'audio/ogg';
  if (u.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'; // HLS
  return '';
}

/* ====== Google Cast (Chromecast) ====== */
/*
  NOTE:
  - Fonctionne depuis Chrome/Edge (desktop/mobile).
  - Pour caster via l'app Cast (pas "Caster l’onglet"), la vidéo DOIT être accessible par l’appareil Chromecast (URL publique).
  - APP_ID par défaut du Media Receiver: 'CC1AD845'.
*/
const CAST_APP_ID = 'CC1AD845';
let castContext, currentCastSession = null;

window.__onGCastApiAvailable = function(isAvailable) {
  if (isAvailable) {
    const cf = cast.framework;
    castContext = cf.CastContext.getInstance();
    castContext.setOptions({
      receiverApplicationId: CAST_APP_ID,
      autoJoinPolicy: cf.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED
    });
    castBtn.disabled = false;
    setStatus('Chromecast prêt.');
  }
};

castBtn.addEventListener('click', async () => {
  if (!window.cast || !castContext) {
    alert('Chromecast non disponible dans ce navigateur.');
    return;
  }
  try {
    await castContext.requestSession();
    currentCastSession = castContext.getCurrentSession();
    setStatus('Connecté à un appareil Cast.');
    // Si une source est déjà chargée et publique, on tente de la charger sur le Cast
    tryLoadCurrentOnCast();
  } catch (e) {
    console.warn(e);
    setStatus('Aucun appareil Cast sélectionné.');
  }
});

function tryLoadCurrentOnCast() {
  if (!currentCastSession) return;
  const mediaUrl = video.currentSrc || video.src;
  if (!mediaUrl || mediaUrl.startsWith('blob:')) {
    setStatus('Pour Chromecast, fournis une URL publique (pas un fichier local).');
    return;
  }

  const contentType = guessContentType(mediaUrl) || 'video/mp4';
  const mediaInfo = new chrome.cast.media.MediaInfo(mediaUrl, contentType);
  const request = new chrome.cast.media.LoadRequest(mediaInfo);
  request.autoplay = true;
  request.currentTime = Math.floor(video.currentTime || 0);

  currentCastSession.loadMedia(request).then(() => {
    setStatus('Lecture envoyée au Chromecast.');
  }, (err) => {
    console.error(err);
    setStatus('Échec de l’envoi au Chromecast (URL inaccessible ?)');
  });
}

/* Sync basic controls to Cast session (play/pause/seek) if needed */
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (video.paused) video.play(); else video.pause();
  }
});

/* ====== Tips: Auto-unlock audio on iOS ====== */
document.addEventListener('touchstart', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}, {passive:true});
