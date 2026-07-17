/* ==========================================================
   Dynamic background — extracts dominant color from album art
   Sets CSS variables on body for smooth animated background.
   ========================================================== */
(() => {
  'use strict';

  const root = document.documentElement;
  const body = document.body;

  // Initial vars
  root.style.setProperty('--dyn-1', '#1a1f4a');
  root.style.setProperty('--dyn-2', '#0a0e2e');

  // --- Color extraction ---
  // Muestra 96x96 (antes 60x60), cuantización fina (16 niveles por canal,
  // antes 8) y fusión de tonos vecinos: un mismo color repartido entre
  // varios buckets ya no pierde contra un color menor pero concentrado.
  // Los píxeles del centro pesan más (el sujeto de la carátula suele
  // estar ahí; los bordes/fondos pesan menos).
  const SAMPLE_SIZE = 96;

  const extractColors = (img) => {
    const c = document.createElement('canvas');
    c.width = SAMPLE_SIZE;
    c.height = SAMPLE_SIZE;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    let data;
    try {
      data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    } catch (e) {
      return null; // CORS taint
    }

    const half = SAMPLE_SIZE / 2;
    const maxDist = Math.hypot(half, half);

    const buckets = new Map();
    let px = 0;
    for (let i = 0; i < data.length; i += 4, px++) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = (r + g + b) / 3;
      if (lum < 20 || lum > 240) continue;
      if (max - min < 10) continue; // near-grayscale

      const x = px % SAMPLE_SIZE;
      const y = (px / SAMPLE_SIZE) | 0;
      const centrality = 1.25 - (Math.hypot(x - half, y - half) / maxDist) * 0.5;
      const sat = (max - min) / max;
      const weight = (1 + sat * 2) * centrality;

      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const cur = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      cur.count += weight;
      cur.r += r * weight;
      cur.g += g * weight;
      cur.b += b * weight;
      buckets.set(key, cur);
    }

    // Carátula en blanco y negro / muy oscura: antes devolvía null y se
    // quedaban los colores de la canción ANTERIOR. Ahora promediamos todo.
    if (!buckets.size) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
      if (!n) return null;
      return [{ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }];
    }

    // Fusiona buckets de tono similar (media ponderada por peso)
    const sorted = [...buckets.values()]
      .map(bk => ({ r: bk.r / bk.count, g: bk.g / bk.count, b: bk.b / bk.count, count: bk.count }))
      .sort((a, b) => b.count - a.count);

    const merged = [];
    for (const cand of sorted) {
      const near = merged.find(m =>
        Math.hypot(m.r - cand.r, m.g - cand.g, m.b - cand.b) < 44
      );
      if (near) {
        const t = near.count + cand.count;
        near.r = (near.r * near.count + cand.r * cand.count) / t;
        near.g = (near.g * near.count + cand.g * cand.count) / t;
        near.b = (near.b * near.count + cand.b * cand.count) / t;
        near.count = t;
      } else {
        merged.push({ ...cand });
      }
    }
    merged.sort((a, b) => b.count - a.count);
    return merged.slice(0, 6).map(m => ({
      r: Math.round(m.r), g: Math.round(m.g), b: Math.round(m.b), count: m.count,
    }));
  };

  // --- Tweak: darken & make rich ---
  const adjustColor = (c, lightness) => {
    // lightness: target average brightness (0-255)
    const cur = (c.r + c.g + c.b) / 3;
    if (cur === 0) return c;
    const ratio = lightness / cur;
    return {
      r: Math.max(0, Math.min(255, Math.round(c.r * ratio))),
      g: Math.max(0, Math.min(255, Math.round(c.g * ratio))),
      b: Math.max(0, Math.min(255, Math.round(c.b * ratio))),
    };
  };

  const rgbStr = (c) => `rgb(${c.r}, ${c.g}, ${c.b})`;

  const rgbToHex = ({ r, g, b }) => '#' + [r, g, b].map(v =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  ).join('');

  // --- HSL helpers (para normalizar el acento sin cambiar su tono) ---
  const rgbToHsl = ({ r, g, b }) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h, s, l };
  };
  const hslToRgb = ({ h, s, l }) => {
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return {
      r: Math.round(f(h + 1 / 3) * 255),
      g: Math.round(f(h) * 255),
      b: Math.round(f(h - 1 / 3) * 255),
    };
  };

  // Elige el color más representativo Y vivo para el acento (letra activa,
  // bordes, botones): equilibrio entre cuánto ocupa y cuánta saturación
  // tiene. Luego se ajusta solo la luminosidad para que sea legible sobre
  // fondo oscuro — el TONO de la carátula se conserva intacto.
  const pickAccent = (top) => {
    let best = null, bestScore = -1;
    for (const c of top) {
      const max = Math.max(c.r, c.g, c.b);
      const min = Math.min(c.r, c.g, c.b);
      const sat = max ? (max - min) / max : 0;
      const score = (0.2 + sat) * Math.sqrt(c.count || 1);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return null;
    const hsl = rgbToHsl(best);
    if (hsl.s > 0.05) hsl.s = Math.min(1, Math.max(hsl.s, 0.45));
    hsl.l = Math.min(0.72, Math.max(0.55, hsl.l));
    return hslToRgb(hsl);
  };

  const applyColors = (top) => {
    if (!top || !top.length) return;
    const mc = window.MasterColors || {};

    // Fondo + paneles: solo en modo auto (bg-manual = el usuario eligió fondo)
    if (!body.classList.contains('bg-manual')) {
      const primary = top[0];
      const secondary = top[1] || top[0];
      const upper = adjustColor(primary, 75);   // mid-dark
      const lower = adjustColor(secondary, 25); // very dark
      root.style.setProperty('--dyn-1', rgbStr(upper));
      root.style.setProperty('--dyn-2', rgbStr(lower));
      // Drive all internal panel/window shades from the lower (deepest) color
      if (mc.applyPanelsFromBase) mc.applyPanelsFromBase(rgbToHex(lower));
    }

    // Acento por canción: la letra activa cambia con cada carátula
    // (independiente del modo de fondo; seven.js decide si está en auto)
    const accent = pickAccent(top);
    if (accent && mc.applyAccentFromCover) mc.applyAccentFromCover(rgbToHex(accent));
  };

  const resetColors = () => {
    const mc = window.MasterColors || {};
    if (!body.classList.contains('bg-manual')) {
      root.style.setProperty('--dyn-1', '#1a1f4a');
      root.style.setProperty('--dyn-2', '#0a0e2e');
      if (mc.resetPanels) mc.resetPanels();
    }
    if (mc.resetAccentFromCover) mc.resetAccentFromCover();
  };

  // --- Process a cover source ---
  const processCover = (src) => {
    if (!src) { resetColors(); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const colors = extractColors(img);
      if (colors) applyColors(colors);
    };
    img.onerror = () => {
      // Retry without crossOrigin (works for data: URIs and same-origin)
      const img2 = new Image();
      img2.onload = () => {
        const colors = extractColors(img2);
        if (colors) applyColors(colors);
      };
      img2.src = src;
    };
    img.src = src;
  };

  // --- Watch the cover-art element for background-image changes ---
  const coverArt = document.getElementById('coverArt');
  let lastSrc = null;

  const checkCover = () => {
    if (!coverArt) return;
    const bg = coverArt.style.backgroundImage;
    const match = bg.match(/url\(["']?(.+?)["']?\)/);
    const src = match ? match[1] : null;
    if (src !== lastSrc) {
      lastSrc = src;
      if (src) processCover(src);
      else resetColors();
    }
  };

  // Poll because backgroundImage style change doesn't fire MutationObserver reliably
  setInterval(checkCover, 400);
  checkCover();

  // Re-extracción forzada (p. ej. al devolver el fondo a modo auto)
  window.CoverColors = {
    refresh: () => { lastSrc = null; checkCover(); },
  };
})();
