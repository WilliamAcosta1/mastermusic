/* ==========================================================
   Módulo Spotify — OAuth PKCE + Web API
   Sin backend, sin Client Secret.
   ========================================================== */
(() => {
  'use strict';

  const STORAGE = {
    CID: 'sp_client_id',
    TOKEN: 'sp_access_token',
    REFRESH: 'sp_refresh_token',
    EXPIRES: 'sp_expires_at',
    VERIFIER: 'sp_verifier',
  };

  // Spotify exige que la Redirect URI coincida EXACTAMENTE con la
  // registrada en el dashboard. Normalizamos para que abrir la app como
  // localhost, 127.0.0.1 o con /index.html dé siempre la misma URI:
  // http://127.0.0.1:5500/  (la que imprime server.js al arrancar).
  const REDIRECT_URI = window.location.origin.replace('//localhost', '//127.0.0.1')
    + window.location.pathname.replace(/index\.html$/, '');
  const SCOPES = [
    'user-read-private',
    'user-read-email',
    'user-read-currently-playing',
    'user-read-playback-state',
    'user-modify-playback-state',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-library-read',
  ].join(' ');

  // -------- PKCE helpers --------
  const randomString = (length) => {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  };

  const sha256 = async (text) => {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return new Uint8Array(hash);
  };

  const base64url = (bytes) => btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // -------- Client ID modal --------
  const askClientId = () => new Promise((resolve) => {
    const existing = localStorage.getItem(STORAGE.CID) || '';
    const modal = document.createElement('div');
    modal.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(8px)">
        <div style="background:#181818;border-radius:12px;padding:32px;max-width:520px;width:90%;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,0.6)">
          <h2 style="margin-bottom:8px;font-size:22px">Conectar con Spotify</h2>
          <p style="color:#b3b3b3;font-size:13px;margin-bottom:16px;line-height:1.5">
            Necesitas un <b>Client ID</b> gratuito de Spotify. Pasos:
          </p>
          <ol style="color:#b3b3b3;font-size:13px;margin:0 0 16px 18px;line-height:1.7">
            <li>Abre <a href="https://developer.spotify.com/dashboard" target="_blank" style="color:#1db954">developer.spotify.com/dashboard</a></li>
            <li>Login con tu cuenta normal de Spotify</li>
            <li>"Create app" → nombre libre (ej. "Mi Reproductor")</li>
            <li><b>Redirect URI:</b><br><code style="background:#000;padding:4px 8px;border-radius:4px;font-size:12px;word-break:break-all">${REDIRECT_URI}</code></li>
            <li>Marca <b>"Web API"</b> y guarda</li>
            <li>Copia el <b>Client ID</b> y pégalo aquí abajo</li>
          </ol>
          <input id="cidInput" placeholder="Pega tu Client ID aquí" value="${existing}"
            style="width:100%;padding:12px;border-radius:6px;background:#000;border:1px solid #333;color:#fff;font-size:14px;margin-bottom:12px;outline:none" />
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="cidCancel" style="padding:10px 18px;background:transparent;border:1px solid #555;border-radius:999px;color:#fff;cursor:pointer;font-weight:600">Cancelar</button>
            <button id="cidOk" style="padding:10px 18px;background:#1db954;border:none;border-radius:999px;color:#000;cursor:pointer;font-weight:700">Continuar</button>
          </div>
          <p style="color:#666;font-size:11px;margin-top:14px">
            Necesitas Spotify Premium para controlar la reproducción. Tu Client ID se guarda solo en tu navegador.
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('#cidInput');
    input.focus();
    const close = (val) => { document.body.removeChild(modal); resolve(val); };
    modal.querySelector('#cidOk').onclick = () => {
      const v = input.value.trim();
      if (v) { localStorage.setItem(STORAGE.CID, v); close(v); }
    };
    modal.querySelector('#cidCancel').onclick = () => close(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') modal.querySelector('#cidOk').click(); };
  });

  // -------- Auth flow --------
  const startAuth = async () => {
    let clientId = localStorage.getItem(STORAGE.CID);
    if (!clientId) {
      clientId = await askClientId();
      if (!clientId) return;
    }

    const verifier = randomString(64);
    localStorage.setItem(STORAGE.VERIFIER, verifier);
    const challenge = base64url(await sha256(verifier));

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES,
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
  };

  const exchangeCode = async (code) => {
    const clientId = localStorage.getItem(STORAGE.CID);
    const verifier = localStorage.getItem(STORAGE.VERIFIER);
    if (!clientId || !verifier) return false;

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return false;
    const data = await res.json();
    saveTokens(data);
    return true;
  };

  const refreshToken = async () => {
    const clientId = localStorage.getItem(STORAGE.CID);
    const refresh = localStorage.getItem(STORAGE.REFRESH);
    if (!clientId || !refresh) return false;
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return false;
    const data = await res.json();
    saveTokens(data);
    return true;
  };

  const saveTokens = (data) => {
    if (data.access_token) localStorage.setItem(STORAGE.TOKEN, data.access_token);
    if (data.refresh_token) localStorage.setItem(STORAGE.REFRESH, data.refresh_token);
    if (data.expires_in) localStorage.setItem(STORAGE.EXPIRES, String(Date.now() + data.expires_in * 1000));
  };

  const isLoggedIn = () => {
    const tok = localStorage.getItem(STORAGE.TOKEN);
    const exp = parseInt(localStorage.getItem(STORAGE.EXPIRES) || '0', 10);
    return tok && Date.now() < exp;
  };

  const getValidToken = async () => {
    if (isLoggedIn()) return localStorage.getItem(STORAGE.TOKEN);
    if (await refreshToken()) return localStorage.getItem(STORAGE.TOKEN);
    return null;
  };

  // -------- Web API helpers --------
  const api = async (path, opts = {}) => {
    const token = await getValidToken();
    if (!token) throw new Error('No token');
    const res = await fetch('https://api.spotify.com/v1' + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Spotify API ${res.status}: ${txt}`);
    }
    return res.json();
  };

  // -------- Polling current playback --------
  let pollTimer = null;
  let lastTrackId = null;
  let lastIsPlaying = false;   // último estado conocido (lo refresca el polling)

  // El polling llega cada 2s; entre poll y poll interpolamos con un reloj
  // local para que la letra y la barra avancen suaves a 60fps en vez de
  // dar saltos de 2 segundos.
  let progBase = 0;    // progreso (s) reportado en el último poll
  let progStamp = 0;   // performance.now() de ese poll
  let progDur = 0;     // duración (s) de la pista actual
  let rafId = null;

  const paintProgress = (sec) => {
    const pct = progDur ? Math.min(100, (sec / progDur) * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressThumb').style.left = pct + '%';
    document.getElementById('timeCurrent').textContent = formatTime(sec);
    if (window.LyricsModule) window.LyricsModule.tick(sec);
  };

  const smoothLoop = () => {
    rafId = requestAnimationFrame(smoothLoop);
    if (!lastIsPlaying || !progStamp) return;
    const st = window.PlayerCore && window.PlayerCore.state;
    if (st && st.isPreview) return;   // el preview de 30s ya lo mueve el audio local
    const sec = progBase + (performance.now() - progStamp) / 1000;
    paintProgress(progDur ? Math.min(progDur, sec) : sec);
  };

  const startPolling = () => {
    if (pollTimer) return;
    const poll = async () => {
      try {
        const t0 = performance.now();
        const data = await api('/me/player/currently-playing');
        const t1 = performance.now();
        if (data && data.item) {
          const it = data.item;
          const track = {
            id: 'sp:' + it.id,
            name: it.name,
            artist: it.artists.map(a => a.name).join(', '),
            album: it.album ? it.album.name : '',
            duration: it.duration_ms / 1000,
            cover: it.album && it.album.images && it.album.images[0] ? it.album.images[0].url : null,
            url: null,
            spotify: true,
            uri: it.uri,
          };
          // Update now playing bar
          document.getElementById('npTitle').textContent = track.name;
          document.getElementById('npArtist').textContent = track.artist;
          const npCover = document.getElementById('npCover');
          if (npCover && track.cover) {
            npCover.style.backgroundImage = `url('${track.cover}')`;
            npCover.innerHTML = '';
          }
          const coverArt = document.getElementById('coverArt');
          if (coverArt && track.cover) {
            coverArt.style.backgroundImage = `url('${track.cover}')`;
            coverArt.style.backgroundSize = 'cover';
            coverArt.style.backgroundPosition = 'center';
            coverArt.innerHTML = '';
          }
          document.getElementById('timeTotal').textContent = formatTime(track.duration);
          // Re-ancla el reloj local con el progreso real; smoothLoop interpola
          // entre polls para que letra y barra no salten cada 2s.
          const playing = !!data.is_playing;
          if (data.progress_ms != null) {
            // Compensa la latencia de red: el progreso reportado corresponde
            // aprox. al punto medio de la petición, no al momento de recibirla.
            let anchor = data.progress_ms / 1000 + (playing ? (t1 - t0) / 2000 : 0);
            // Anti-jitter: re-anclar en seco cada 2s hacía saltar el tiempo
            // ±200ms (la línea activa de la letra parpadeaba o volvía atrás
            // y se re-animaba). Diferencias pequeñas se corrigen suave; solo
            // un salto real (seek, cambio de canción) re-ancla directo.
            const est = (progStamp && lastIsPlaying && track.id === lastTrackId)
              ? progBase + (t1 - progStamp) / 1000
              : null;
            if (playing && est !== null && Math.abs(anchor - est) < 0.8) {
              anchor = est + (anchor - est) * 0.35;
            }
            progBase = anchor;
            progStamp = t1;
            progDur = it.duration_ms / 1000;
            // Reproduciendo pinta el rAF (smoothLoop); en pausa pintamos aquí
            if (!playing) paintProgress(progBase);
          }
          // Update play icon
          lastIsPlaying = playing;
          document.getElementById('playIcon').hidden = playing;
          document.getElementById('pauseIcon').hidden = !playing;
          document.body.classList.toggle('playing', playing);

          if (track.id !== lastTrackId) {
            lastTrackId = track.id;
            window.PlayerCore.state.currentTrack = track;
            if (window.LyricsModule) window.LyricsModule.fetch(track);
          }
        }
      } catch (e) {
        // silently ignore (e.g. nothing playing)
      }
    };
    poll();
    pollTimer = setInterval(poll, 2000);
    if (!rafId) smoothLoop();
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    progStamp = 0;
  };

  // -------- Controles de reproducción (Spotify Connect) --------
  // app.js delega aquí cuando la canción actual es de Spotify.
  const spTogglePlay = async () => {
    try {
      await api(lastIsPlaying ? '/me/player/pause' : '/me/player/play', { method: 'PUT' });
      lastIsPlaying = !lastIsPlaying;
      // Refleja el cambio al instante; el polling lo confirma después.
      document.getElementById('playIcon').hidden = lastIsPlaying;
      document.getElementById('pauseIcon').hidden = !lastIsPlaying;
      document.body.classList.toggle('playing', lastIsPlaying);
      startPolling();
    } catch (e) {
      setStatus('✕ Spotify no respondió. Abre la app de Spotify (Premium) en algún dispositivo.');
    }
  };

  const spNext = async () => {
    try {
      await api('/me/player/next', { method: 'POST' });
      lastTrackId = null;          // fuerza al polling a refrescar la canción
      startPolling();
    } catch (e) { setStatus('✕ no se pudo saltar de canción (¿hay un dispositivo activo?)'); }
  };

  const spPrev = async () => {
    try {
      await api('/me/player/previous', { method: 'POST' });
      lastTrackId = null;
      startPolling();
    } catch (e) { setStatus('✕ no se pudo volver atrás (¿hay un dispositivo activo?)'); }
  };

  const spSetVolume = async (pct) => {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    try { await api('/me/player/volume?volume_percent=' + pct, { method: 'PUT' }); }
    catch (e) { /* algunos dispositivos no aceptan volumen remoto; silencioso */ }
  };

  const spSeek = async (ms) => {
    try {
      await api('/me/player/seek?position_ms=' + Math.round(ms), { method: 'PUT' });
      // re-ancla el reloj local ya, sin esperar al siguiente poll (2s)
      progBase = ms / 1000;
      progStamp = performance.now();
      paintProgress(progBase);
    }
    catch (e) { setStatus('✕ no se pudo adelantar en Spotify'); }
  };

  const formatTime = (s) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const setStatus = (msg) => {
    if (window.SevenStatus) window.SevenStatus(msg);
    else { const s = document.getElementById('statusText'); if (s) s.textContent = msg; }
  };

  const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  // -------- Search & play tracks from the app --------
  let searchResults = [];
  let searchTimer = null;

  const showSearchBlock = (show) => {
    const block = document.getElementById('spotifySearchBlock');
    if (block) block.hidden = !show;
    const hint = document.getElementById('searchHint');
    if (hint) hint.hidden = show;
  };

  const renderResults = () => {
    const list = document.getElementById('spotifyResults');
    if (!list) return;
    if (!searchResults.length) {
      list.innerHTML = '<li class="sp-empty">▒ sin resultados ▒</li>';
      return;
    }
    list.innerHTML = searchResults.map((t, i) => `
      <li class="sp-result" data-idx="${i}">
        <div class="sp-thumb" ${t.cover ? `style="background-image:url('${t.cover}')"` : ''}>${t.cover ? '' : '♪'}</div>
        <div class="sp-meta">
          <div class="sp-name">${escapeHtml(t.name)}</div>
          <div class="sp-artist">${escapeHtml(t.artist)}</div>
        </div>
        <div class="sp-dur">${formatTime(t.duration)}</div>
        <button class="sp-play" title="Reproducir">▶</button>
      </li>
    `).join('');
  };

  const doSearch = async (query) => {
    const q = query.trim();
    if (!q) { searchResults = []; renderResults(); return; }
    try {
      // limit máx. 10: desde feb-2026 Spotify limita las búsquedas de apps
      // en development mode a 10 resultados (más devuelve 400 "Invalid limit").
      const data = await api('/search?type=track&limit=10&q=' + encodeURIComponent(q));
      const items = (data && data.tracks && data.tracks.items) || [];
      searchResults = items.map(it => ({
        id: 'sp:' + it.id,
        uri: it.uri,
        name: it.name,
        artist: it.artists.map(a => a.name).join(', '),
        album: it.album ? it.album.name : '',
        duration: it.duration_ms / 1000,
        cover: it.album && it.album.images && it.album.images[0] ? it.album.images[0].url : null,
        preview: it.preview_url || null,
        spotify: true,
      }));
      renderResults();
    } catch (e) {
      searchResults = [];
      const list = document.getElementById('spotifyResults');
      if (!list) return;
      const emsg = (e && e.message) || '';
      let msg;
      if (/No token/.test(emsg) || /Spotify API 401/.test(emsg)) {
        // Token caducado o ausente: el botón mentía "conectado".
        // Lo dejamos honesto y pedimos reconectar.
        try { window.PlayerCore.setSpotifyConnected(false); } catch {}
        msg = 'Tu sesión de Spotify caducó. Pulsa <b>[ conectar spotify ]</b> otra vez.<br>'
            + 'Para tu propia música usa <b>[ importar música ]</b> (no necesita Spotify).';
      } else {
        const m = emsg.match(/Spotify API (\d+):\s*([\s\S]*)$/);
        let detail = '';
        if (m && m[2]) {
          try { detail = JSON.parse(m[2]).error.message || ''; } catch { detail = m[2].slice(0, 120); }
        }
        console.error('[Spotify search] fallo:', emsg);
        msg = m
          ? `Spotify rechazó la búsqueda (error ${m[1]}).${detail ? '<br><b>' + escapeHtml(detail) + '</b>' : ''}`
          : 'No se pudo buscar en Spotify (sin conexión). Inténtalo de nuevo.';
      }
      list.innerHTML = `<li class="sp-empty" style="line-height:1.6">▒ ${msg} ▒</li>`;
    }
  };

  // Show a Spotify track in the now-playing bar (used by preview fallback)
  const showNowPlaying = (t) => {
    document.getElementById('npTitle').textContent = t.name;
    document.getElementById('npArtist').textContent = t.artist;
    const npCoverEl = document.getElementById('coverArt') || document.getElementById('npCover');
    if (npCoverEl && t.cover) {
      npCoverEl.style.backgroundImage = `url('${t.cover}')`;
      npCoverEl.style.backgroundSize = 'cover';
      npCoverEl.innerHTML = '';
    }
    document.getElementById('timeTotal').textContent = formatTime(t.duration);
    window.PlayerCore.state.currentTrack = t;
    if (window.LyricsModule) window.LyricsModule.fetch(t);
  };

  const playTrack = async (t) => {
    if (!t) return;
    setStatus('▣ cargando: ' + t.name);
    try {
      // Full playback via Spotify Connect (requiere Premium + un dispositivo activo)
      await api('/me/player/play', { method: 'PUT', body: JSON.stringify({ uris: [t.uri] }) });
      lastTrackId = null;          // fuerza al polling a refrescar la canción
      lastIsPlaying = true;
      window.PlayerCore.state.isPreview = false;
      startPolling();
      setStatus('▶ reproduciendo en Spotify: ' + t.name);
    } catch (e) {
      // Fallback: preview de 30s por el reproductor local
      if (t.preview && window.PlayerCore) {
        const audio = window.PlayerCore.audio;
        audio.src = t.preview;
        audio.play().catch(() => {});
        window.PlayerCore.state.isPlaying = true;
        window.PlayerCore.state.isPreview = true;
        document.getElementById('playIcon').hidden = true;
        document.getElementById('pauseIcon').hidden = false;
        showNowPlaying(t);
        setStatus('▶ preview 30s · para la canción completa necesitas Spotify Premium con la app abierta');
      } else {
        setStatus('✕ sin dispositivo activo. Abre Spotify (Premium) en tu móvil/PC y vuelve a intentar.');
        alert('Para reproducir la canción completa necesitas:\n\n· Spotify Premium\n· La app de Spotify abierta en algún dispositivo\n\nEsta canción tampoco tiene preview de 30s disponible.');
      }
    }
  };

  const wireSearch = () => {
    const input = document.getElementById('spotifySearchInput');
    if (input && !input._wired) {
      input._wired = true;
      input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => doSearch(input.value), 350);
      });
    }
    const list = document.getElementById('spotifyResults');
    if (list && !list._wired) {
      list._wired = true;
      list.addEventListener('click', (e) => {
        const row = e.target.closest('.sp-result');
        if (!row) return;
        const t = searchResults[parseInt(row.dataset.idx, 10)];
        if (t) playTrack(t);
      });
    }
  };

  // -------- Public --------
  const loadUser = async () => {
    try {
      const me = await api('/me');
      window.PlayerCore.setUser(me.display_name || me.id, (me.images && me.images[0]) ? me.images[0].url : null);
      window.PlayerCore.setSpotifyConnected(true);
      showSearchBlock(true);
      startPolling();
    } catch (e) {
      console.warn('Spotify load user failed', e);
    }
  };

  const connect = async () => {
    if (isLoggedIn()) {
      const ok = confirm('Ya estás conectado a Spotify. ¿Cerrar sesión?');
      if (ok) {
        localStorage.removeItem(STORAGE.TOKEN);
        localStorage.removeItem(STORAGE.REFRESH);
        localStorage.removeItem(STORAGE.EXPIRES);
        stopPolling();
        showSearchBlock(false);
        searchResults = [];
        renderResults();
        window.PlayerCore.setSpotifyConnected(false);
        window.PlayerCore.setUser('Invitado', null);
      }
      return;
    }
    await startAuth();
  };

  // -------- Handle redirect with ?code=... --------
  const init = async () => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) {
      alert('Error de autorización Spotify: ' + error);
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.pathname);
    }
    if (code) {
      const ok = await exchangeCode(code);
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      window.history.replaceState({}, '', url.pathname);
      if (ok) await loadUser();
    } else if (isLoggedIn()) {
      await loadUser();
    } else if (localStorage.getItem(STORAGE.REFRESH)) {
      if (await refreshToken()) await loadUser();
    }
    wireSearch();
  };

  window.SpotifyModule = {
    connect, api, search: doSearch, playTrack, isLoggedIn,
    togglePlay: spTogglePlay, next: spNext, prev: spPrev, seek: spSeek,
    setVolume: spSetVolume,
  };

  // Wait for PlayerCore to be ready
  document.addEventListener('DOMContentLoaded', () => {
    if (window.PlayerCore) init();
    else window.addEventListener('load', init);
  });
  // If DOM is already loaded
  if (document.readyState !== 'loading') {
    setTimeout(init, 0);
  }
})();
