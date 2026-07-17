/* ==========================================================
   MODO CINE — pantalla completa con las MISMAS animaciones del
   modo edit + carátula girando como vinilo al lado.
   Truco: mueve el elemento real #lyricsEdit dentro del cine
   (las animaciones calculan su tamaño según el contenedor, así
   que a pantalla completa crecen solas) y pide a LyricsModule
   que fuerce el render tipo edit sin cambiar la preferencia.
   ========================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const root = $('cinema');
  const lyricsEdit = $('lyricsEdit');
  if (!root || !lyricsEdit) return;

  const bg = $('cinemaBg');
  const disc = $('cinemaDisc');
  const stage = $('cinemaStage');
  const msg = $('cinemaMsg');
  const cover = $('cinemaCover');
  const title = $('cinemaTitle');
  const artist = $('cinemaArtist');
  const wave = $('cinemaWave');
  const waveCtx = wave ? wave.getContext('2d') : null;
  const mainFill = $('progressFill');
  const openBtn = $('cinemaBtn');
  const closeBtn = $('cinemaClose');

  let open = false;
  let rafId = null;
  let lastTrack = null;
  // marca la posición original de #lyricsEdit para devolverlo al cerrar
  const slot = document.createComment('lyricsEdit-slot');

  const paintTrack = () => {
    const t = window.PlayerCore && window.PlayerCore.state.currentTrack;
    const img = t && t.cover ? `url("${t.cover}")` : '';
    bg.style.backgroundImage = img;
    disc.style.backgroundImage = img;
    cover.style.backgroundImage = img;
    root.classList.toggle('no-cover', !img);
    title.textContent = t ? t.name : 'Sin canción';
    artist.textContent = t ? (t.artist || '') : 'reproduce algo para empezar';
  };

  const paintMsg = () => {
    const sync = window.LyricsModule && window.LyricsModule.getSync
      ? window.LyricsModule.getSync() : null;
    const lines = (sync && sync.lines) || [];
    const synced = lines.length > 0 && lines[0].time >= 0;
    const text = synced ? '' : (lines.length ? '♪ letra sin sincronizar ♪' : '♪ ♪ ♪');
    if (msg.textContent !== text) msg.textContent = text;
    msg.hidden = synced;
  };

  // ---- Onda de progreso: espectro real + porción reproducida en acento ----
  let wW = 0, wH = 0, dpr = 1;
  const sizeWave = () => {
    if (!wave) return;
    const rect = wave.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.max(1, window.devicePixelRatio || 1);
    wW = Math.floor(rect.width);
    wH = Math.floor(rect.height);
    wave.width = Math.floor(wW * dpr);
    wave.height = Math.floor(wH * dpr);
    waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener('resize', () => { if (open) sizeWave(); });

  const cssVar = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;

  const drawWave = () => {
    if (!waveCtx || !wW) return;
    waveCtx.clearRect(0, 0, wW, wH);
    // progreso: espejo de la barra principal (vale para local y Spotify)
    const pct = mainFill ? (parseFloat(mainFill.style.width) || 0) / 100 : 0;
    const bw = 3, gap = 2;
    const n = Math.max(24, Math.floor(wW / (bw + gap)));
    const bands = window.VisualizerModule && window.VisualizerModule.getBands
      ? window.VisualizerModule.getBands(64) : null;
    const accent = cssVar('--accent', '#5ce1e6');
    const mid = wH / 2;
    for (let i = 0; i < n; i++) {
      // mapeo triangular: graves al centro (joroba), agudos hacia los bordes
      const d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
      const b = Math.min(63, Math.round(Math.pow(d, 1.25) * 63));
      const v = bands ? bands[b] : 0.08;
      const h = Math.max(2, Math.min(wH - 2, v * wH * 0.94));
      const x = i * (bw + gap);
      if ((x + bw / 2) / wW <= pct) {
        waveCtx.fillStyle = accent;
        waveCtx.shadowColor = accent;
        waveCtx.shadowBlur = 6;
      } else {
        waveCtx.fillStyle = 'rgba(232, 236, 255, 0.22)';
        waveCtx.shadowBlur = 0;
      }
      waveCtx.fillRect(x, mid - h / 2, bw, h);
    }
    // cabeza de reproducción: aguja blanca con glow
    waveCtx.shadowColor = accent;
    waveCtx.shadowBlur = 9;
    waveCtx.fillStyle = '#fff';
    waveCtx.fillRect(Math.max(0, Math.min(wW - 2, pct * wW - 1)), 1, 2, wH - 2);
    waveCtx.shadowBlur = 0;
  };

  // clic sobre la onda = saltar a ese punto (local o Spotify Connect)
  if (wave) wave.addEventListener('click', (e) => {
    const rect = wave.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const PC = window.PlayerCore;
    if (!PC) return;
    const t = PC.state.currentTrack;
    if (t && t.spotify && !PC.state.isPreview && window.SpotifyModule) {
      const durMs = (t.duration || 0) * 1000;
      if (durMs) window.SpotifyModule.seek(pct * durMs);
    } else if (PC.audio.duration) {
      PC.audio.currentTime = pct * PC.audio.duration;
    }
  });

  const loop = () => {
    if (!open) return;
    rafId = requestAnimationFrame(loop);
    const t = window.PlayerCore && window.PlayerCore.state.currentTrack;
    if (t !== lastTrack) { lastTrack = t; paintTrack(); }
    paintMsg();
    drawWave();
  };

  const openCinema = () => {
    if (open) return;
    open = true;
    document.body.classList.add('cinema-open');
    // muda el modo edit real al escenario del cine
    lyricsEdit.parentNode.insertBefore(slot, lyricsEdit);
    stage.appendChild(lyricsEdit);
    lyricsEdit.hidden = false;
    root.hidden = false;
    sizeWave();   // el canvas ya es visible: medirlo ahora
    lastTrack = window.PlayerCore && window.PlayerCore.state.currentTrack;
    paintTrack();
    paintMsg();
    if (window.LyricsModule && window.LyricsModule.forceEdit) {
      window.LyricsModule.forceEdit(true);
    }
    loop();
  };

  const closeCinema = () => {
    if (!open) return;
    open = false;
    document.body.classList.remove('cinema-open');
    root.hidden = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    // devuelve #lyricsEdit a su sitio y restaura su visibilidad según el modo
    slot.parentNode.insertBefore(lyricsEdit, slot);
    slot.remove();
    const editMode = window.LyricsModule && window.LyricsModule.isEditMode
      ? window.LyricsModule.isEditMode() : false;
    lyricsEdit.hidden = !editMode;
    if (window.LyricsModule && window.LyricsModule.forceEdit) {
      window.LyricsModule.forceEdit(false);
    }
  };

  if (openBtn) openBtn.addEventListener('click', openCinema);
  if (closeBtn) closeBtn.addEventListener('click', closeCinema);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && open) closeCinema();
  });
})();
