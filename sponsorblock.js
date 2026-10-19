// SponsorBlock dentro de YouTube:
//  - pide los segmentos del vídeo (vía background.js),
//  - los marca en la barra de tiempo con el color de su categoría,
//  - y, según la configuración de cada categoría, los salta solo o muestra un botón «Saltar».
(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const YSS = globalThis.YSS;
  if (!YSS) return;

  const RETRY_MS = 30000; // si falla la consulta, no reintentar antes de este tiempo
  const UNDO_MS = 5000;   // cuánto dura el aviso «Deshacer» tras un salto automático
  const FADE_MS = 200;    // debe coincidir con la transición del CSS del botón

  let settings = YSS.mergeSettings(null);
  let segments = [];        // [{ uuid, category, start, end, duration }] ordenados por inicio
  let fetchedFor = null;    // ID del vídeo para el que ya se pidieron segmentos
  let fetchedCats = '';     // categorías que se pidieron
  let retryAt = 0;
  let token = 0;            // descarta respuestas que llegan tarde (se cambió de vídeo)
  const dismissed = new Set(); // segmentos que el usuario no quiere que se vuelvan a saltar
  let tickTimer = null;
  let bar = null;

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  function getVideoId() {
    const { pathname, search } = location;
    if (pathname === '/watch') return new URLSearchParams(search).get('v');
    const m = pathname.match(/^\/(?:shorts|live)\/([\w-]{6,20})/);
    return m ? m[1] : null;
  }

  function getVideo() {
    const vids = Array.from(document.querySelectorAll('video'));
    return (
      vids.find((v) => v.classList.contains('html5-main-video') && !v.paused) ||
      vids.find((v) => !v.paused) ||
      vids.find((v) => v.classList.contains('html5-main-video')) ||
      vids[0] ||
      null
    );
  }

  // Durante un anuncio el reproductor lleva esta clase: ahí no hay que saltar nada.
  const isAd = () => !!document.querySelector('.html5-video-player.ad-showing');


  function wantedCategories() {
    return YSS.CATEGORIES.filter((c) => settings.categories[c.id].mode !== 'off').map((c) => c.id);
  }

  // ---------------------------------------------------------------------------
  // Consulta de segmentos
  // ---------------------------------------------------------------------------

  function clearAll() {
    token++;
    segments = [];
    fetchedFor = null;
    fetchedCats = '';
    dismissed.clear();
    clearTimeout(tickTimer);
    removeBar();
    hideChip(true);
  }

  async function refresh() {
    const id = getVideoId();
    const cats = wantedCategories();

    if (!settings.enabled || !id || !cats.length) {
      if (fetchedFor !== null || segments.length || bar || chipState) clearAll();
      return;
    }

    const key = cats.join(',');
    if (id === fetchedFor && key === fetchedCats) return;
    if (Date.now() < retryAt) return;

    if (id !== fetchedFor) {
      segments = [];
      dismissed.clear();
      removeBar();
      hideChip(true);
    }
    fetchedFor = id;
    fetchedCats = key;

    const mine = ++token;
    let res = null;
    try {
      res = await api.runtime.sendMessage({ type: 'sbSegments', videoID: id, categories: cats });
    } catch (_) {
      res = null;
    }
    if (mine !== token) return; // mientras tanto se cambió de vídeo o de ajustes

    if (!res || !res.ok) {
      fetchedFor = null;
      fetchedCats = '';
      retryAt = Date.now() + RETRY_MS;
      return;
    }
    segments = res.segments.slice().sort((a, b) => a.start - b.start);
    renderBar();
    tick();
  }

  // ---------------------------------------------------------------------------
  // Marcas en la barra de tiempo
  // ---------------------------------------------------------------------------

  function removeBar() {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    bar = null;
  }

  function renderBar() {
    const parent = document.querySelector('.ytp-progress-bar');
    if (!parent || !settings.enabled || !segments.length) {
      removeBar();
      return;
    }
    const v = getVideo();
    const known = segments.find((s) => s.duration > 0);
    const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : known ? known.duration : 0;
    if (!dur) return;

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'yss-previewbar';
      bar.style.cssText =
        'position:absolute;left:0;right:0;top:0;height:100%;margin:0;padding:0;' +
        'pointer-events:none;overflow:hidden;z-index:42;';
    }
    if (bar.parentNode !== parent) parent.appendChild(bar);

    bar.replaceChildren();
    for (const s of segments) {
      const cfg = settings.categories[s.category];
      if (!cfg || cfg.mode === 'off') continue;
      const left = Math.max(0, Math.min(100, (s.start / dur) * 100));
      const width = Math.max(0.15, Math.min(100 - left, ((s.end - s.start) / dur) * 100));
      const mark = document.createElement('div');
      mark.className = 'yss-mark';
      mark.dataset.category = s.category;
      mark.style.cssText =
        `position:absolute;top:0;height:100%;left:${left}%;width:${width}%;` +
        `min-width:2px;background:${cfg.color};`;
      bar.appendChild(mark);
    }
  }

  // YouTube puede reconstruir la barra; se comprueba que la nuestra siga colgada de ella.
  function ensureBar() {
    if (!settings.enabled || !segments.length) return;
    const parent = document.querySelector('.ytp-progress-bar');
    if (parent && (!bar || bar.parentNode !== parent)) renderBar();
    if (bar) bar.style.display = isAd() ? 'none' : '';
  }

  // ---------------------------------------------------------------------------
  // Botón «Saltar» / aviso «Deshacer» (abajo a la derecha del reproductor)
  // ---------------------------------------------------------------------------

  const CHIP_STYLE = `
    .chip {
      display: flex;
      align-items: center;
      gap: 10px;
      box-sizing: border-box;
      padding: 11px 18px 11px 14px;
      background: rgba(24, 24, 24, 0.92);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.4);
      border-right: 0;
      border-radius: 6px 0 0 6px;
      font: 500 15px/1 Roboto, Arial, sans-serif;
      cursor: pointer;
      pointer-events: auto;
      opacity: 0;
      transform: translateX(12px);
      transition: opacity 200ms ease, transform 200ms ease;
    }
    .chip.visible { opacity: 1; transform: none; }
    .chip:not(.visible) { pointer-events: none; }
    .chip:hover { background: rgba(60, 60, 60, 0.95); }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    .label { white-space: nowrap; }
    .icon { font-size: 14px; }
    @media (prefers-reduced-motion: reduce) { .chip { transition: none; } }
  `;

  let chipHost = null;
  let chipEl = null;
  let chipDot = null;
  let chipLabel = null;
  let chipIcon = null;
  let chipState = null; // { mode: 'skip' | 'undo', seg }
  let chipTimer = null;
  let chipFade = null;

  function ensureChip() {
    if (chipHost) return;
    chipHost = document.createElement('div');
    chipHost.id = 'yss-chip-host';
    // Como el botón nativo de saltar anuncio: pegado al borde derecho, por encima de los controles.
    chipHost.style.cssText =
      'position:absolute;right:0;bottom:96px;z-index:60;pointer-events:none;display:none;';
    const root = chipHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CHIP_STYLE;
    chipEl = document.createElement('button');
    chipEl.type = 'button';
    chipEl.className = 'chip';
    chipDot = document.createElement('span');
    chipDot.className = 'dot';
    chipLabel = document.createElement('span');
    chipLabel.className = 'label';
    chipIcon = document.createElement('span');
    chipIcon.className = 'icon';
    chipEl.append(chipDot, chipLabel, chipIcon);
    root.append(style, chipEl);
    chipEl.addEventListener('click', onChipClick);
    // Que pulsar el botón no pause/reanude el vídeo por debajo.
    for (const ev of ['mousedown', 'pointerdown', 'dblclick']) {
      chipEl.addEventListener(ev, (e) => e.stopPropagation());
    }
  }

  function showChip(state) {
    const v = getVideo();
    if (!v) return;
    const player = v.closest('.html5-video-player') || v.parentElement;
    if (!player) return;
    ensureChip();
    if (chipHost.parentNode !== player) player.appendChild(chipHost);

    chipState = state;
    const short = YSS.catText(state.seg.category, 'short');
    const cfg = settings.categories[state.seg.category];
    chipDot.style.background = cfg.color;
    if (state.mode === 'skip') {
      chipLabel.textContent = YSS.t('chip.skip', { short });
      chipIcon.textContent = '⏭';
    } else {
      chipLabel.textContent = YSS.t('chip.undo', { short });
      chipIcon.textContent = '↩';
    }

    clearTimeout(chipTimer);
    clearTimeout(chipFade);
    chipHost.style.display = 'block';
    void chipEl.offsetWidth; // fuerza el reflow para que la entrada se anime
    chipEl.classList.add('visible');
    if (state.mode === 'undo') chipTimer = setTimeout(() => hideChip(), UNDO_MS);
  }

  function hideChip(immediate) {
    chipState = null;
    clearTimeout(chipTimer);
    if (!chipHost) return;
    clearTimeout(chipFade);
    chipEl.classList.remove('visible');
    if (immediate) {
      chipHost.style.display = 'none';
      return;
    }
    chipFade = setTimeout(() => {
      if (!chipState) chipHost.style.display = 'none';
    }, FADE_MS);
  }

  function onChipClick(e) {
    e.stopPropagation();
    const v = getVideo();
    const c = chipState;
    if (!v || !c) return;
    if (c.mode === 'skip') {
      skipSegment(v, c.seg, false);
    } else {
      dismissed.add(c.seg.uuid); // que no se vuelva a saltar este segmento
      v.currentTime = c.seg.start;
      hideChip();
    }
  }

  // ---------------------------------------------------------------------------
  // Saltos
  // ---------------------------------------------------------------------------

  function skipSegment(v, seg, auto) {
    const dur = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.min(seg.end, dur); // si llega al final, el vídeo termina
    if (auto && settings.notice) showChip({ mode: 'undo', seg });
    else hideChip();
  }

  function tick() {
    clearTimeout(tickTimer);
    if (!settings.enabled || !segments.length) return;
    const v = getVideo();
    if (!v) return;

    ensureBar();
    if (isAd()) {
      if (chipState && chipState.mode === 'skip') hideChip();
      return;
    }

    const t = v.currentTime;
    let buttonSeg = null;
    for (const s of segments) {
      const cfg = settings.categories[s.category];
      if (!cfg || dismissed.has(s.uuid)) continue;
      if (t >= s.start - 0.05 && t < s.end - 0.05) {
        if (cfg.mode === 'auto') {
          skipSegment(v, s, true);
          return; // el evento "seeked" volverá a llamar a tick()
        }
        if (cfg.mode === 'button' && !buttonSeg) buttonSeg = s;
      }
    }

    if (buttonSeg) {
      if (!chipState || chipState.mode !== 'skip' || chipState.seg.uuid !== buttonSeg.uuid) {
        showChip({ mode: 'skip', seg: buttonSeg });
      }
    } else if (chipState && chipState.mode === 'skip') {
      hideChip();
    }

    // "timeupdate" llega unas 4 veces por segundo: para no pasarse del inicio de un segmento
    // se programa un tick justo cuando toque.
    if (!v.paused) {
      const rate = v.playbackRate || 1;
      for (const s of segments) {
        const cfg = settings.categories[s.category];
        if (!cfg || dismissed.has(s.uuid) || s.start <= t) continue;
        if (cfg.mode !== 'auto' && cfg.mode !== 'button') continue;
        const ms = ((s.start - t) / rate) * 1000;
        if (ms < 3000) tickTimer = setTimeout(tick, Math.max(0, ms - 15));
        break; // los segmentos van ordenados: basta el siguiente
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Eventos y arranque
  // ---------------------------------------------------------------------------

  // Los eventos de <video> no hacen bubbling, pero sí se pueden capturar desde document.
  for (const ev of ['timeupdate', 'seeked', 'playing', 'ratechange', 'durationchange', 'loadedmetadata']) {
    document.addEventListener(
      ev,
      (e) => {
        if (!e.target || e.target.tagName !== 'VIDEO') return;
        if (ev === 'loadedmetadata' || ev === 'durationchange') {
          refresh();
          renderBar();
        }
        tick();
      },
      true
    );
  }

  document.addEventListener('yt-navigate-finish', () => refresh());

  // Red de seguridad: detecta cambios de vídeo sin evento y reconstruye la barra si YouTube la rehace.
  setInterval(() => {
    refresh();
    ensureBar();
  }, 1000);

  YSS.initLang(); // idioma del chip «Saltar…»

  api.storage.local.get({ sb: null }).then((s) => {
    settings = YSS.mergeSettings(s.sb);
    refresh();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.sb) return;
    settings = YSS.mergeSettings(changes.sb.newValue);
    hideChip(true);
    renderBar();
    refresh();
    tick();
  });
})();
