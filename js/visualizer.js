/* ==========================================================
   Visualizador de audio — espectro reflejado, profesional.
   · FFT real (Web Audio) cuando el audio suena por el <audio>
     local (canciones importadas y previews de Spotify).
   · Animación suave de respaldo (idle) cuando no hay señal
     (silencio, o reproducción en Spotify Connect remoto).

   SEGURIDAD DE AUDIO: el grafo se conecta de forma perezosa solo
   tras un gesto del usuario (evento 'play'), reanudando primero el
   AudioContext. Si algo falla, se captura y el audio sigue sonando
   por la ruta normal del navegador — nunca se silencia.
   ========================================================== */
(() => {
  'use strict';

  const canvas = document.getElementById('visualizer');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // ---- Web Audio state ----
  let audioCtx = null, analyser = null, source = null, freqData = null;
  let connected = false, attaching = false;
  // Captura del audio del sistema (modo sync, para Spotify Connect)
  let capStream = null, capSource = null, capAnalyser = null;

  const NUM_BARS = 64;
  const FFT_SIZE = 2048;
  const smooth  = new Array(NUM_BARS).fill(0);
  const peaks   = new Array(NUM_BARS).fill(0);
  const peakVel = new Array(NUM_BARS).fill(0);

  // ---- Canvas sizing (nítido en pantallas HiDPI) ----
  let W = 0, H = 0, dpr = 1;
  const sizeCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, window.devicePixelRatio || 1);
    W = Math.max(120, Math.floor(rect.width));
    H = Math.max(60, Math.floor(rect.height));
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);
  if (window.ResizeObserver) new ResizeObserver(sizeCanvas).observe(canvas);

  // ---- Color helpers (siguen el acento del tema) ----
  const cssVar = (n, f) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return v || f;
  };
  const toRgb = (hex) => {
    if (hex.startsWith('rgb')) { const m = hex.match(/\d+/g); return { r: +m[0], g: +m[1], b: +m[2] }; }
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    return { r: parseInt(c.substr(0, 2), 16), g: parseInt(c.substr(2, 2), 16), b: parseInt(c.substr(4, 2), 16) };
  };
  const rgba = ({ r, g, b }, a = 1) => `rgba(${r},${g},${b},${a})`;

  // ---- Conexión perezosa al grafo de audio ----
  const tryAttach = async () => {
    if (connected) {
      if (audioCtx && audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch (e) {} }
      return;
    }
    if (attaching) return;
    attaching = true;
    try {
      if (!window.PlayerCore || !window.PlayerCore.audio) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch (e) {} }
      source = audioCtx.createMediaElementSource(window.PlayerCore.audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.82;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      connected = true;
    } catch (e) {
      console.warn('[viz] no se pudo conectar (el audio sigue sonando):', e);
      connected = false; audioCtx = null; source = null; analyser = null;
    } finally {
      attaching = false;
    }
  };

  // Engancha el evento play (gesto de usuario) para conectar de forma segura
  const hookAudio = () => {
    if (!window.PlayerCore || !window.PlayerCore.audio) { setTimeout(hookAudio, 150); return; }
    const a = window.PlayerCore.audio;
    a.addEventListener('play', () => { tryAttach(); });
    a.addEventListener('playing', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {}); });
  };
  hookAudio();

  // Watchdog: reanuda el contexto si el navegador lo suspende
  setInterval(() => {
    const a = window.PlayerCore && window.PlayerCore.audio;
    if (a && !a.paused && audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  });

  const isLive = () => {
    // Modo sync: el espectro viene del audio del sistema (Spotify u otro)
    if (capAnalyser && audioCtx && audioCtx.state === 'running') return true;
    const a = window.PlayerCore && window.PlayerCore.audio;
    return !!(analyser && connected && a && !a.paused && !a.ended && audioCtx && audioCtx.state === 'running');
  };

  // ---- Magnitudes del espectro (bandas log) ----
  const computeSpectrum = () => {
    (capAnalyser || analyser).getByteFrequencyData(freqData);
    const bins = freqData.length;
    let sum = 0;
    for (let i = 0; i < bins; i++) sum += freqData[i];
    if (sum === 0) return null;       // audio enrutado fuera / cambio de pista
    const out = new Array(NUM_BARS);
    const minF = 2, maxF = bins * 0.78;
    for (let i = 0; i < NUM_BARS; i++) {
      const lo = minF + Math.pow(i / NUM_BARS, 1.9) * (maxF - minF);
      const hi = minF + Math.pow((i + 1) / NUM_BARS, 1.9) * (maxF - minF);
      let max = 0;
      for (let j = Math.floor(lo); j < Math.ceil(hi) && j < bins; j++) if (freqData[j] > max) max = freqData[j];
      out[i] = max / 255;
    }
    return out;
  };

  // ---- Animación suave cuando no hay señal ----
  const idleSpectrum = () => {
    const t = performance.now() / 1000;
    const out = new Array(NUM_BARS);
    for (let i = 0; i < NUM_BARS; i++) {
      const x = i / NUM_BARS;
      const env = Math.sin(x * Math.PI);                                   // joroba central
      const wave = (Math.sin(t * 1.6 + x * 7) * 0.5 + 0.5) * 0.40
                 + (Math.sin(t * 2.7 + x * 13) * 0.5 + 0.5) * 0.16;
      out[i] = env * wave + 0.015;
    }
    return out;
  };

  // ---- Barra con tope redondeado ----
  const roundedTopBar = (x, y, w, h, r) => {
    r = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  };

  // ---- Modo SYNC: captura el audio del sistema (para Spotify) ----
  // El audio de Spotify Connect no pasa por el navegador, así que no se
  // puede analizar directo. Con getDisplayMedia el usuario comparte el
  // audio del sistema y el espectro reacciona a lo que realmente suena.
  // Solo se ANALIZA: no se conecta a destination (evitaría eco/duplicado).
  const setStatus = (msg) => { if (window.SevenStatus) window.SevenStatus(msg); };
  const syncBtn = document.getElementById('vizSyncBtn');

  const stopCapture = () => {
    if (capStream) capStream.getTracks().forEach(t => { t.onended = null; t.stop(); });
    try { if (capSource) capSource.disconnect(); } catch (e) {}
    capStream = null; capSource = null; capAnalyser = null;
    if (syncBtn) syncBtn.classList.remove('active');
  };

  const startCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
      });
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        stream.getTracks().forEach(t => t.stop());
        setStatus('✕ no se compartió audio — marca "compartir audio del sistema"');
        return false;
      }
      // No necesitamos el video: liberarlo ahorra recursos, pero mantenemos
      // el track para detectar cuando el usuario detiene la compartición.
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch (e) {} }
      capSource = audioCtx.createMediaStreamSource(stream);
      capAnalyser = audioCtx.createAnalyser();
      capAnalyser.fftSize = FFT_SIZE;
      capAnalyser.smoothingTimeConstant = 0.82;
      capAnalyser.minDecibels = -90;
      capAnalyser.maxDecibels = -10;
      capSource.connect(capAnalyser);
      if (!freqData) freqData = new Uint8Array(capAnalyser.frequencyBinCount);
      capStream = stream;
      stream.getTracks().forEach(t => { t.onended = () => { stopCapture(); setStatus('◈ sync desactivado'); }; });
      return true;
    } catch (e) {
      // el usuario canceló el diálogo de compartir, o falló la captura
      stopCapture();
      return false;
    }
  };

  if (syncBtn) syncBtn.addEventListener('click', async () => {
    if (capStream) {
      stopCapture();
      setStatus('◈ sync desactivado');
      return;
    }
    const ok = await startCapture();
    syncBtn.classList.toggle('active', ok);
    setStatus(ok
      ? '◈ espectro sincronizado con el audio del sistema'
      : '✕ sync cancelado');
  });

  // ---- Mini-EQ de la barra de estado: baila con el espectro real ----
  // Cuando hay FFT en vivo, las barritas usan bandas reales (graves → agudos)
  // cuantizadas a pasos de 3px (look pixel). Sin señal (p. ej. Spotify
  // Connect remoto) se quita la clase .live y vuelve la animación CSS.
  const miniEq = document.querySelector('.mini-eq');
  const eqBars = miniEq ? Array.from(miniEq.querySelectorAll('i')) : [];
  const eqIdx = [3, 10, 20, 33, 47];   // índices en smooth[] para cada barrita
  let eqLive = false;
  const updateMiniEq = (playing) => {
    if (!eqBars.length) return;
    if (playing) {
      if (!eqLive) { miniEq.classList.add('live'); eqLive = true; }
      for (let k = 0; k < eqBars.length; k++) {
        const v = Math.min(1, (smooth[eqIdx[k]] || 0) * 1.35);
        eqBars[k].style.height = (3 + Math.min(3, Math.round(v * 3)) * 3) + 'px';
      }
    } else if (eqLive) {
      miniEq.classList.remove('live');
      eqLive = false;
      for (const b of eqBars) b.style.height = '';
    }
  };

  // ---- Bucle de render ----
  const draw = () => {
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);

    const live = isLive();
    let vals = live ? computeSpectrum() : null;
    const playing = !!(live && vals);
    if (!vals) vals = idleSpectrum();

    const accent  = toRgb(cssVar('--accent', '#5ce1e6'));
    const glow    = toRgb(cssVar('--accent-glow', '#5ce1e6'));
    const magenta = toRgb(cssVar('--magenta', '#ff5cc8'));

    const center = H / 2;
    const gap = 2;
    const barW = (W - gap * (NUM_BARS - 1)) / NUM_BARS;
    const maxBar = H * 0.46;
    const radius = Math.min(barW / 2, 3);

    // Línea central tenue
    ctx.strokeStyle = rgba(accent, 0.10);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, center); ctx.lineTo(W, center); ctx.stroke();

    for (let i = 0; i < NUM_BARS; i++) {
      const target = vals[i];
      const s = smooth[i];
      // ataque rápido, caída lenta
      smooth[i] = target > s ? s + (target - s) * 0.5 : s + (target - s) * 0.12;
      const v = smooth[i];
      const bh = Math.max(1.5, v * maxBar);
      const x = i * (barW + gap);

      // pico que cae
      if (v > peaks[i]) { peaks[i] = v; peakVel[i] = 0; }
      else { peakVel[i] += 0.0009; peaks[i] = Math.max(v, peaks[i] - peakVel[i]); }

      // barra superior con degradado + glow
      const grad = ctx.createLinearGradient(0, center - bh, 0, center);
      grad.addColorStop(0,    rgba(magenta, playing ? 1 : 0.7));
      grad.addColorStop(0.55, rgba(accent, 0.95));
      grad.addColorStop(1,    rgba(accent, 0.55));
      ctx.shadowColor = rgba(glow, playing ? 0.9 : 0.4);
      ctx.shadowBlur = playing ? 12 : 6;
      ctx.fillStyle = grad;
      roundedTopBar(x, center - bh, barW, bh, radius);
      ctx.fill();

      // reflejo inferior, desvanecido (sin glow)
      ctx.shadowBlur = 0;
      const refl = ctx.createLinearGradient(0, center, 0, center + bh * 0.7);
      refl.addColorStop(0, rgba(accent, 0.30));
      refl.addColorStop(1, rgba(accent, 0));
      ctx.fillStyle = refl;
      ctx.fillRect(x, center, barW, bh * 0.7);

      // tope del pico
      const py = center - Math.max(1.5, peaks[i] * maxBar) - 2;
      ctx.shadowColor = rgba(magenta, 0.9);
      ctx.shadowBlur = 8;
      ctx.fillStyle = rgba(magenta, 0.95);
      ctx.fillRect(x, py, barW, 2);
      ctx.shadowBlur = 0;
    }

    updateMiniEq(playing);
  };
  draw();

  // API pública mínima
  window.VisualizerModule = {
    isConnected: () => connected,
    // Espectro suavizado remuestreado a n bandas (0..1, graves → agudos).
    // Con señal en vivo (local o ◈ sync) es FFT real; sin señal, la onda idle.
    getBands: (n) => {
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        const j = Math.min(NUM_BARS - 1, Math.round(i * (NUM_BARS - 1) / Math.max(1, n - 1)));
        out[i] = smooth[j];
      }
      return out;
    },
  };
})();
