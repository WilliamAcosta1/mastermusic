/* ==========================================================
   SEVEN.FM — orchestration: tabs, themes, clock, track list,
   cover art mirroring, status bar
   ========================================================== */
(() => {
  'use strict';

  // ---------- Tab switching ----------
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      const name = t.dataset.tab;
      tabs.forEach(x => x.classList.toggle('active', x === t));
      contents.forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
      if (name === 'queue') renderQueue();   // refresco inmediato al abrir la cola
      if (name === 'search') {               // foco directo al buscador
        const inp = document.getElementById('spotifySearchInput');
        if (inp && !inp.closest('[hidden]')) setTimeout(() => inp.focus(), 0);
      }
    });
  });

  // ---------- Color theme (presets + custom pickers) ----------
  const STORAGE_KEYS = {
    THEME: 'mm_theme',
    ACCENT: 'mm_accent_custom',
    ACCENT_MODE: 'mm_accent_mode',   // 'auto' (de la carátula) | 'manual'
    BG_MODE: 'mm_bg_mode',
    BG_COLOR: 'mm_bg_color',
    TEXT: 'mm_text_custom',
  };

  const root = document.documentElement;
  const body = document.body;

  const applyAccent = (hex) => {
    body.removeAttribute('data-theme');
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-glow', hex);
    root.style.setProperty('--accent-dim', darken(hex, 0.5));
    applyBordersFromAccent(hex);
  };

  const applyTheme = (name) => {
    body.dataset.theme = name;
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-glow');
    root.style.removeProperty('--accent-dim');
    // Read the resolved accent from the [data-theme] cascade and derive borders
    setTimeout(() => {
      const computed = getComputedStyle(root).getPropertyValue('--accent').trim() || '#5ce1e6';
      applyBordersFromAccent(computed);
    }, 0);
  };

  // Derives 4 border shades (hi / light / pixel / dark) from a base accent color.
  // Result is desaturated towards a darker base so borders feel like frames, not glows.
  const applyBordersFromAccent = (hex) => {
    let rgb;
    try { rgb = hexToRgb(hex); } catch (e) { return; }
    // Mix accent with a deep navy for a "pixel border" feel
    const mix = (c1, c2, t) => ({
      r: c1.r * (1 - t) + c2.r * t,
      g: c1.g * (1 - t) + c2.g * t,
      b: c1.b * (1 - t) + c2.b * t,
    });
    const base = { r: 26, g: 31, b: 74 }; // navy
    const mid = mix(rgb, base, 0.55);
    root.style.setProperty('--border-hi',    rgbToHex(mix(rgb, { r: 255, g: 255, b: 255 }, 0.35))); // bright highlight
    root.style.setProperty('--border-light', rgbToHex(mid));
    root.style.setProperty('--border-pixel', rgbToHex(mix(mid, { r: 0, g: 0, b: 0 }, 0.25)));
    root.style.setProperty('--border-dark',  rgbToHex(mix(mid, { r: 0, g: 0, b: 0 }, 0.7)));
  };

  const applyText = (hex) => {
    root.style.setProperty('--text', hex);
  };

  // ---------- Acento automático desde la carátula ----------
  // En modo 'auto' el color de acento (letra activa, bordes, botones)
  // sale de la carátula de cada canción. Elegir un swatch o color
  // personalizado pasa a 'manual'; el swatch AUTO vuelve a activarlo.
  let accentMode = localStorage.getItem(STORAGE_KEYS.ACCENT_MODE)
    || ((localStorage.getItem(STORAGE_KEYS.THEME) || localStorage.getItem(STORAGE_KEYS.ACCENT)) ? 'manual' : 'auto');
  let lastCoverAccent = null;

  const applyAccentFromCover = (hex) => {
    lastCoverAccent = hex;
    if (accentMode !== 'auto') return;
    applyAccent(hex); // solo pinta; no persiste como elección manual
  };

  const resetAccentFromCover = () => {
    lastCoverAccent = null;
    if (accentMode !== 'auto') return;
    applyTheme('cyan');
  };

  const applyBgManual = (hex) => {
    body.classList.add('bg-manual');
    root.style.setProperty('--dyn-1', lighten(hex, 0.15));
    root.style.setProperty('--dyn-2', hex);
    applyPanelsFromBase(hex);
  };

  const applyBgAuto = () => {
    body.classList.remove('bg-manual');
    // Reset panels — colors.js will repopulate them from cover
    resetPanels();
    if (window.CoverColors) window.CoverColors.refresh();
  };

  // Set all chrome panels (window, panels, frame) as shades of a base color.
  // Brighter = "raised" buttons, darker = inner panels.
  const applyPanelsFromBase = (hex) => {
    let baseRgb;
    try { baseRgb = hexToRgb(hex); } catch (e) { return; }

    // Detect if base is very light → use dark shades instead of light
    const lum = (baseRgb.r + baseRgb.g + baseRgb.b) / 3;
    const isLight = lum > 180;

    const shade = (t) => {
      // t > 0 → lighter, t < 0 → darker
      if (t >= 0) {
        return rgbToHex({
          r: baseRgb.r + (255 - baseRgb.r) * t,
          g: baseRgb.g + (255 - baseRgb.g) * t,
          b: baseRgb.b + (255 - baseRgb.b) * t,
        });
      }
      return rgbToHex({
        r: baseRgb.r * (1 + t),
        g: baseRgb.g * (1 + t),
        b: baseRgb.b * (1 + t),
      });
    };

    if (isLight) {
      // Light base: window slightly darker, panels darker still
      root.style.setProperty('--bg-window',  shade(-0.05));
      root.style.setProperty('--bg-panel',   shade(-0.12));
      root.style.setProperty('--bg-panel-2', shade(-0.20));
      root.style.setProperty('--bg-frame',   shade(0.05));
    } else {
      // Dark base: window=base, panels darker, frame brighter
      root.style.setProperty('--bg-window',  shade(0.12));
      root.style.setProperty('--bg-panel',   shade(0.04));
      root.style.setProperty('--bg-panel-2', shade(-0.25));
      root.style.setProperty('--bg-frame',   shade(0.22));
    }
  };

  const resetPanels = () => {
    root.style.removeProperty('--bg-window');
    root.style.removeProperty('--bg-panel');
    root.style.removeProperty('--bg-panel-2');
    root.style.removeProperty('--bg-frame');
  };

  // Expose for colors.js to call when auto-extracting from cover
  window.MasterColors = { applyPanelsFromBase, resetPanels, applyAccentFromCover, resetAccentFromCover };

  // Color math helpers
  const hexToRgb = (hex) => {
    const c = hex.replace('#', '');
    return {
      r: parseInt(c.substr(0, 2), 16),
      g: parseInt(c.substr(2, 2), 16),
      b: parseInt(c.substr(4, 2), 16),
    };
  };
  const rgbToHex = ({ r, g, b }) => '#' + [r, g, b].map(v =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  ).join('');
  const darken = (hex, factor) => {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex({ r: r * (1 - factor), g: g * (1 - factor), b: b * (1 - factor) });
  };
  const lighten = (hex, factor) => {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex({
      r: r + (255 - r) * factor,
      g: g + (255 - g) * factor,
      b: b + (255 - b) * factor,
    });
  };

  // Preset accent swatches
  const presetSwatches = document.querySelectorAll('.swatch[data-color]');
  const accentAutoBtn = document.getElementById('accentAuto');
  const updateActiveSwatch = (color) => {
    presetSwatches.forEach(s => s.classList.toggle('active', s.dataset.color === color));
    if (accentAutoBtn) accentAutoBtn.classList.toggle('active', color === 'auto');
  };
  const setAccentManual = () => {
    accentMode = 'manual';
    localStorage.setItem(STORAGE_KEYS.ACCENT_MODE, 'manual');
  };
  presetSwatches.forEach(s => {
    s.addEventListener('click', () => {
      const name = s.dataset.color;
      setAccentManual();
      applyTheme(name);
      localStorage.setItem(STORAGE_KEYS.THEME, name);
      localStorage.removeItem(STORAGE_KEYS.ACCENT);
      updateActiveSwatch(name);
    });
  });

  // Custom accent picker
  const customAccent = document.getElementById('customAccent');
  customAccent.addEventListener('input', (e) => {
    const hex = e.target.value;
    setAccentManual();
    applyAccent(hex);
    localStorage.setItem(STORAGE_KEYS.ACCENT, hex);
    localStorage.removeItem(STORAGE_KEYS.THEME);
    updateActiveSwatch(null);
  });

  // Swatch AUTO: el acento sigue a la carátula de cada canción
  if (accentAutoBtn) {
    accentAutoBtn.addEventListener('click', () => {
      accentMode = 'auto';
      localStorage.setItem(STORAGE_KEYS.ACCENT_MODE, 'auto');
      localStorage.removeItem(STORAGE_KEYS.THEME);
      localStorage.removeItem(STORAGE_KEYS.ACCENT);
      updateActiveSwatch('auto');
      if (lastCoverAccent) applyAccent(lastCoverAccent);
      else applyTheme('cyan');
    });
  }

  // Background mode
  const bgAuto = document.getElementById('bgAuto');
  const bgManual = document.getElementById('bgManual');
  const bgPresets = document.querySelectorAll('.bg-preset');
  const customBg = document.getElementById('customBg');

  bgAuto.addEventListener('change', () => {
    if (bgAuto.checked) {
      applyBgAuto();
      localStorage.setItem(STORAGE_KEYS.BG_MODE, 'auto');
    }
  });
  bgManual.addEventListener('change', () => {
    if (bgManual.checked) {
      const saved = localStorage.getItem(STORAGE_KEYS.BG_COLOR) || '#0a0e2e';
      applyBgManual(saved);
      localStorage.setItem(STORAGE_KEYS.BG_MODE, 'manual');
    }
  });
  bgPresets.forEach(b => {
    b.addEventListener('click', () => {
      const hex = b.dataset.bg;
      bgManual.checked = true;
      applyBgManual(hex);
      customBg.value = hex;
      localStorage.setItem(STORAGE_KEYS.BG_MODE, 'manual');
      localStorage.setItem(STORAGE_KEYS.BG_COLOR, hex);
    });
  });
  customBg.addEventListener('input', (e) => {
    bgManual.checked = true;
    applyBgManual(e.target.value);
    localStorage.setItem(STORAGE_KEYS.BG_MODE, 'manual');
    localStorage.setItem(STORAGE_KEYS.BG_COLOR, e.target.value);
  });

  // Text color presets + custom
  const textPresets = document.querySelectorAll('.text-preset');
  const customText = document.getElementById('customText');
  textPresets.forEach(b => {
    b.addEventListener('click', () => {
      const hex = b.dataset.text;
      applyText(hex);
      customText.value = hex;
      localStorage.setItem(STORAGE_KEYS.TEXT, hex);
    });
  });
  customText.addEventListener('input', (e) => {
    applyText(e.target.value);
    localStorage.setItem(STORAGE_KEYS.TEXT, e.target.value);
  });

  // Lyrics offset slider
  const offsetSlider = document.getElementById('offsetSlider');
  const offsetValue = document.getElementById('offsetValue');
  const offsetMinus = document.getElementById('offsetMinus');
  const offsetPlus = document.getElementById('offsetPlus');
  const offsetReset = document.getElementById('offsetReset');
  if (offsetSlider) {
    const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + 's';
    const paint = (sec) => {
      offsetSlider.value = sec;
      offsetValue.textContent = fmt(sec);
    };
    const apply = (v) => {
      const sec = Math.max(-5, Math.min(5, +v || 0));
      paint(sec);
      if (window.LyricsOffset) window.LyricsOffset.set(sec);
    };
    const initial = parseFloat(localStorage.getItem('mm_lyrics_offset') || '0') || 0;
    paint(initial);
    // cada canción tiene su propio offset guardado; al cambiar de pista,
    // lyrics.js avisa con este evento para que el slider muestre el suyo
    window.addEventListener('mm:lyrics-offset', (e) => {
      paint(Math.max(-5, Math.min(5, +e.detail || 0)));
    });
    offsetSlider.addEventListener('input', () => apply(parseFloat(offsetSlider.value)));
    offsetMinus.addEventListener('click', () => apply(parseFloat(offsetSlider.value) - 0.25));
    offsetPlus.addEventListener('click',  () => apply(parseFloat(offsetSlider.value) + 0.25));
    offsetReset.addEventListener('click', () => apply(0));
  }

  // Reset button
  document.getElementById('resetColors').addEventListener('click', () => {
    [STORAGE_KEYS.THEME, STORAGE_KEYS.ACCENT, STORAGE_KEYS.ACCENT_MODE, STORAGE_KEYS.BG_MODE, STORAGE_KEYS.BG_COLOR, STORAGE_KEYS.TEXT]
      .forEach(k => localStorage.removeItem(k));
    body.removeAttribute('data-theme');
    body.classList.remove('bg-manual');
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-glow');
    root.style.removeProperty('--accent-dim');
    root.style.removeProperty('--text');
    root.style.removeProperty('--dyn-1');
    root.style.removeProperty('--dyn-2');
    resetPanels();
    accentMode = 'auto'; // por defecto el acento sigue a la carátula
    if (lastCoverAccent) applyAccent(lastCoverAccent);
    else applyTheme('cyan');
    updateActiveSwatch('auto');
    bgAuto.checked = true;
    customAccent.value = '#5ce1e6';
    customBg.value = '#0a0e2e';
    customText.value = '#e8ecff';
  });

  // ---------- Restore saved settings ----------
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
  const savedAccent = localStorage.getItem(STORAGE_KEYS.ACCENT);
  const savedBgMode = localStorage.getItem(STORAGE_KEYS.BG_MODE) || 'auto';
  const savedBgColor = localStorage.getItem(STORAGE_KEYS.BG_COLOR);
  const savedText = localStorage.getItem(STORAGE_KEYS.TEXT);

  if (accentMode === 'auto') {
    // El acento vendrá de la carátula; cyan de arranque mientras carga
    applyTheme('cyan');
    updateActiveSwatch('auto');
  } else if (savedAccent) {
    applyAccent(savedAccent);
    customAccent.value = savedAccent;
    updateActiveSwatch(null);
  } else {
    applyTheme(savedTheme || 'cyan');
    updateActiveSwatch(savedTheme || 'cyan');
  }
  if (savedBgMode === 'manual' && savedBgColor) {
    bgManual.checked = true;
    applyBgManual(savedBgColor);
    customBg.value = savedBgColor;
  } else {
    bgAuto.checked = true;
  }
  if (savedText) {
    applyText(savedText);
    customText.value = savedText;
  }

  // ---------- Clock ----------
  const clockEl = document.getElementById('clock');
  const tickClock = () => {
    const d = new Date();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    // Los ":" van en spans para que el CSS los haga parpadear
    clockEl.innerHTML = `${hh}<span class="c">:</span>${mm}<span class="c">:</span>${ss}`;
  };
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- Mirror cover art + album ----------
  const coverArt = document.getElementById('coverArt');
  const npAlbumEl = document.getElementById('npAlbum');
  const npTitleEl = document.getElementById('npTitle');

  const updateCover = () => {
    if (!window.PlayerCore) return;
    const t = window.PlayerCore.state.currentTrack;
    if (!t) {
      coverArt.style.backgroundImage = '';
      coverArt.classList.remove('has-image');
      coverArt.innerHTML = '<span class="cover-placeholder">♪</span>';
      npAlbumEl.textContent = '';
      return;
    }
    if (t.cover) {
      coverArt.style.backgroundImage = `url('${t.cover}')`;
      coverArt.classList.add('has-image');
      coverArt.innerHTML = '';
    } else {
      coverArt.style.backgroundImage = '';
      coverArt.classList.remove('has-image');
      coverArt.innerHTML = '<span class="cover-placeholder">♪</span>';
    }
    npAlbumEl.textContent = t.album || '';
    updateStatus(`♪ ${t.name} — ${t.artist || 'desconocido'}`);
  };

  // Watch the title element — every time it changes, refresh cover & album
  const obs = new MutationObserver(updateCover);
  obs.observe(npTitleEl, { childList: true, characterData: true, subtree: true });
  setInterval(updateCover, 500); // safety re-sync

  // ---------- Vinyl mode (carátula giratoria, opcional) ----------
  const vinylToggle = document.getElementById('vinylToggle');
  if (vinylToggle) {
    const applyVinyl = (on) => {
      body.classList.toggle('vinyl-mode', on);
      vinylToggle.classList.toggle('active', on);
    };
    applyVinyl(localStorage.getItem('mm_vinyl') === 'true');
    vinylToggle.addEventListener('click', () => {
      const on = !body.classList.contains('vinyl-mode');
      applyVinyl(on);
      localStorage.setItem('mm_vinyl', on ? 'true' : 'false');
      if (window.SevenStatus) window.SevenStatus(on ? '▣ modo vinilo activado' : '▣ modo vinilo desactivado');
    });
  }

  // ---------- Status bar ----------
  const statusText = document.getElementById('statusText');
  let statusTimeout = null;
  const updateStatus = (msg) => {
    statusText.textContent = msg;
    // Reinicia el flicker retro de entrada
    statusText.classList.remove('flash');
    void statusText.offsetWidth;
    statusText.classList.add('flash');
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => { statusText.textContent = '▣ listo'; }, 4000);
  };
  window.SevenStatus = updateStatus;

  // ---------- Render track list into Library tab ----------
  const renderRetroTrackList = () => {
    if (!window.PlayerCore) return;
    const tracks = window.PlayerCore.state.tracks;
    const list = document.getElementById('trackList');
    if (!tracks.length) {
      list.innerHTML = `<li style="text-align:center;color:var(--text-muted);padding:30px;font-style:italic">▒ biblioteca vacía — importa música ▒</li>`;
      return;
    }
    list.innerHTML = tracks.map((t, i) => {
      const isPlaying = window.PlayerCore.state.currentTrack && window.PlayerCore.state.currentTrack.id === t.id;
      return `
        <li class="track-row ${isPlaying ? 'playing' : ''}" data-track-id="${t.id}">
          <div class="tr-num">${String(i + 1).padStart(2, '0')}</div>
          <div class="tr-info">
            <div class="tr-title">${escapeHtml(t.name)}</div>
            <div class="tr-artist">${escapeHtml(t.artist || 'desconocido')}${t.album ? ' · ' + escapeHtml(t.album) : ''}</div>
          </div>
          <div class="tr-duration">${formatTime(t.duration)}</div>
          <button class="tr-del" data-del-id="${t.id}" title="Quitar de la biblioteca">✕</button>
        </li>
      `;
    }).join('');
  };

  const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  const formatTime = (s) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Periodic refresh to catch new tracks added by app.js
  setInterval(renderRetroTrackList, 500);

  // ---------- Cola de reproducción (pestaña "cola") ----------
  const queueList = document.getElementById('queueList');
  let queueBusy = false;

  const queueEmpty = (msg) =>
    `<li style="text-align:center;color:var(--text-muted);padding:30px;font-style:italic">${msg}</li>`;

  const queueRow = (t, i, clickable) => `
    <li class="track-row ${clickable ? '' : 'no-click'}" ${clickable ? `data-track-id="${t.id}"` : ''}>
      <div class="tr-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="tr-info">
        <div class="tr-title">${escapeHtml(t.name)}</div>
        <div class="tr-artist">${escapeHtml(t.artist || 'desconocido')}</div>
      </div>
      <div class="tr-duration">${formatTime(t.duration)}</div>
    </li>`;

  const renderQueue = async () => {
    if (!queueList || !window.PlayerCore || queueBusy) return;
    const st = window.PlayerCore.state;
    const cur = st.currentTrack;

    // Spotify: pedir la cola real de la cuenta a la API
    if (cur && cur.spotify && window.SpotifyModule && window.SpotifyModule.isLoggedIn()) {
      queueBusy = true;
      try {
        const data = await window.SpotifyModule.api('/me/player/queue');
        const items = (data && data.queue) || [];
        queueList.innerHTML = items.length
          ? items.slice(0, 15).map((it, i) => queueRow({
              name: it.name,
              artist: (it.artists || []).map(a => a.name).join(', '),
              duration: (it.duration_ms || 0) / 1000,
            }, i, false)).join('')
          : queueEmpty('▒ nada en cola en spotify ▒');
      } catch (e) {
        queueList.innerHTML = queueEmpty('▒ no se pudo leer la cola de spotify ▒');
      } finally {
        queueBusy = false;
      }
      return;
    }

    // Local: lo que queda de la cola del reproductor
    const up = (st.queue || []).slice(st.queueIndex + 1).map(ix => st.tracks[ix]).filter(Boolean);
    queueList.innerHTML = up.length
      ? up.map((t, i) => queueRow(t, i, true)).join('')
      : queueEmpty(cur ? '▒ no hay más canciones en cola ▒' : '▒ reproduce algo para ver la cola ▒');
  };

  // Refresca solo mientras la pestaña está visible (evita llamadas de sobra)
  setInterval(() => {
    const tab = document.getElementById('tab-queue');
    if (tab && tab.classList.contains('active')) renderQueue();
  }, 2500);

  // ---------- Tamaño de la ventana (redimensionable + maximizar) ----------
  const winEl = document.querySelector('.window');
  const SIZE_KEY = 'mm_window_size';

  // Restaura el tamaño que el usuario haya elegido antes
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
    if (saved && saved.w && saved.h) {
      winEl.style.width = saved.w + 'px';
      winEl.style.height = saved.h + 'px';
    }
  } catch (_) {}

  // Guarda el tamaño cada vez que el usuario arrastra la esquina
  if ('ResizeObserver' in window) {
    let saveTimer = null;
    new ResizeObserver(() => {
      if (winEl.classList.contains('maximized')) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        localStorage.setItem(SIZE_KEY, JSON.stringify({
          w: Math.round(winEl.offsetWidth),
          h: Math.round(winEl.offsetHeight)
        }));
      }, 250);
    }).observe(winEl);
  }

  // ---------- Title bar buttons ----------
  document.querySelectorAll('.tb-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.classList.contains('tb-close')) {
        if (confirm('¿Cerrar MASTER MUSIC?')) window.close();
      } else if (b.title === 'Maximizar') {
        // Agranda la ventana para llenar toda la pantalla, o la restaura
        winEl.classList.toggle('maximized');
      } else if (b.title === 'Minimizar') {
        // Restaura el tamaño normal guardado
        winEl.classList.remove('maximized');
      }
    });
  });

  // ---------- Extra keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'l' || e.key === 'L') {
      const lyricsTab = document.querySelector('.tab[data-tab="lyrics"]');
      if (lyricsTab) lyricsTab.click();
    } else if (e.key === ',' || e.key === 's') {
      const setTab = document.querySelector('.tab[data-tab="settings"]');
      if (setTab) setTab.click();
    } else if (e.key === 'q' || e.key === 'Q' || e.key === 'c' || e.key === 'C') {
      const qTab = document.querySelector('.tab[data-tab="queue"]');
      if (qTab) qTab.click();
    } else if (e.key === 'f' || e.key === 'F' || e.key === '/') {
      e.preventDefault();
      const sTab = document.querySelector('.tab[data-tab="search"]');
      if (sTab) sTab.click();
    } else if (['1', '2', '3', '4'].includes(e.key)) {
      const map = { '1': 'lyrics', '2': 'search', '3': 'queue', '4': 'settings' };
      const tab = document.querySelector(`.tab[data-tab="${map[e.key]}"]`);
      if (tab) tab.click();
    }
  });

  // ---------- Ambiente: notas flotantes en el panel de letras ----------
  // Puramente decorativo: mientras suena música y el tab de letras está a la
  // vista, cada ~1.4s sube una nota con deriva y giro aleatorios. Van por
  // debajo del texto (z-index) y sesgadas a los bordes para no estorbar.
  const lyricsAmbient = document.getElementById('lyricsAmbient');
  if (lyricsAmbient) {
    const GLYPHS = ['♪', '♫', '♩', '♬', '✦', '✧', '·'];
    const spawnNote = () => {
      if (document.hidden) return;
      if (!document.body.classList.contains('playing')) return;
      const tab = document.getElementById('tab-lyrics');
      if (!tab || !tab.classList.contains('active')) return;
      if (lyricsAmbient.querySelectorAll('.la-note').length > 18) return;

      const n = document.createElement('span');
      n.className = 'la-note';
      n.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      // 42% borde izquierdo, 42% borde derecho, 16% por el medio
      const zona = Math.random();
      const x = zona < 0.42 ? 2 + Math.random() * 16
        : zona < 0.84 ? 80 + Math.random() * 17
        : 25 + Math.random() * 50;
      n.style.setProperty('--nx', x.toFixed(1) + '%');
      n.style.setProperty('--nfs', (12 + Math.random() * 18).toFixed(0) + 'px');
      n.style.setProperty('--ndur', (5 + Math.random() * 5).toFixed(1) + 's');
      n.style.setProperty('--nh', (lyricsAmbient.clientHeight + 50) + 'px');
      n.style.setProperty('--ndx', (Math.random() * 60 - 30).toFixed(0) + 'px');
      n.style.setProperty('--nrot', (Math.random() * 50 - 25).toFixed(0) + 'deg');
      n.style.setProperty('--nop', (0.14 + Math.random() * 0.28).toFixed(2));
      lyricsAmbient.appendChild(n);
      n.addEventListener('animationend', () => n.remove());
    };
    setInterval(spawnNote, 1400);
  }

  // ---------- Welcome status ----------
  setTimeout(() => updateStatus('▣ bienvenido a MASTER MUSIC · [F] buscar · [Q] cola · [S] config'), 200);

  // ---------- Boot fix: ensure cover updates once ----------
  setTimeout(updateCover, 100);
})();
