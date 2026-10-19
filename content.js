// Content script: aplica la velocidad al <video> y muestra el overlay inferior (Alt+S).
// El atajo llega desde background.js como mensaje { type: 'toggleOverlay' }.
(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const YSS = globalThis.YSS; // shared.js: idioma y textos

  const MIN_RATE = 0.0625; // límites que acepta Firefox para playbackRate
  const MAX_RATE = 16;
  const DEFAULT_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const AUTO_HIDE_MS = 3000;
  const NO_VIDEO_HIDE_MS = 2200;
  const FADE_MS = 250; // debe coincidir con la duración de la transición del CSS

  let remember = true;    // reaplicar la última velocidad en cada vídeo nuevo
  let desiredRate = null; // última velocidad elegida

  // ---------------------------------------------------------------------------
  // Vídeo
  // ---------------------------------------------------------------------------

  const clamp = (r) => Math.min(MAX_RATE, Math.max(MIN_RATE, r));

  // Páginas donde hay un reproductor "real" (no la home con previews al hacer hover)
  const isPlayerPage = () => /^\/(watch|shorts\/|live\/)/.test(location.pathname);

  const getVideos = () => Array.from(document.querySelectorAll('video'));

  // En /shorts hay varios <video>; el activo es el que está reproduciéndose.
  function mainVideo() {
    const vids = getVideos();
    return (
      vids.find((v) => v.classList.contains('html5-main-video') && !v.paused) ||
      vids.find((v) => !v.paused) ||
      vids.find((v) => v.classList.contains('html5-main-video')) ||
      vids[0] ||
      null
    );
  }

  function applyRate(rate) {
    const r = clamp(rate);
    for (const v of getVideos()) {
      try {
        v.playbackRate = r;
        // Mantener el tono al acelerar (por defecto ya es true; lo forzamos por si YouTube lo toca)
        v.preservesPitch = true;
        v.mozPreservesPitch = true;
      } catch (_) {
        /* ignorar elementos en estado raro */
      }
    }
    return r;
  }

  // Cambia la velocidad y la guarda como "última elegida".
  function setRate(rate) {
    const applied = applyRate(rate);
    desiredRate = applied;
    api.storage.local.set({ lastRate: applied }).catch(() => {});
    return applied;
  }

  function reapplyDesired() {
    if (!remember || desiredRate == null || !isPlayerPage()) return;
    applyRate(desiredRate);
  }

  // YouTube reutiliza el <video> y a veces restablece la velocidad al cargar otro vídeo
  // (o al terminar un anuncio). loadedmetadata no hace bubbling, pero sí se captura.
  document.addEventListener(
    'loadedmetadata',
    () => {
      reapplyDesired();
      setTimeout(reapplyDesired, 400);
    },
    true
  );
  document.addEventListener('yt-navigate-finish', () => {
    reapplyDesired();
    setTimeout(reapplyDesired, 800);
  });

  api.storage.local.get({ remember: true, lastRate: null }).then((s) => {
    remember = s.remember !== false;
    desiredRate = typeof s.lastRate === 'number' ? s.lastRate : null;
    reapplyDesired();
    setTimeout(reapplyDesired, 800);
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.remember) {
      remember = changes.remember.newValue !== false;
    }
  });

  // ---------------------------------------------------------------------------
  // Overlay (Shadow DOM, abajo en el centro)
  // ---------------------------------------------------------------------------

  const STYLE = `
    .panel {
      box-sizing: border-box;
      width: min(420px, 90vw);
      padding: 12px 16px 10px;
      border-radius: 12px;
      background: rgba(24, 24, 28, 0.94);
      color: #f1f1f1;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
      --thumb: 16px;
      --accent: #ff4e45;
      --track: #4a4a54;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 250ms ease, transform 250ms ease;
    }
    .top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .title { flex: 1; font-weight: 600; }
    .rate {
      font-size: 22px;
      font-weight: 700;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }
    .gear {
      padding: 0 4px;
      border: 0;
      background: transparent;
      color: #b4b4bc;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
    }
    .gear:hover { color: #ffffff; }
    .status { margin: 0 0 4px; color: #c9c9d1; }
    .slider {
      display: block;
      width: 100%;
      height: var(--thumb);
      margin: 0;
      background: transparent;
      -moz-appearance: none;
      appearance: none;
      cursor: pointer;
    }
    .slider::-moz-range-track { height: 4px; border-radius: 2px; background: var(--track); }
    .slider::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--accent); }
    .slider::-moz-range-thumb {
      width: var(--thumb);
      height: var(--thumb);
      border: 0;
      border-radius: 50%;
      background: var(--accent);
    }
    /* Chromium (Chrome, Edge, Opera…): no tiene ::-progress, el relleno se pinta con un degradado */
    .slider::-webkit-slider-runnable-track {
      height: 4px;
      border-radius: 2px;
      --stop: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--f, 0));
      background: linear-gradient(to right, var(--accent) var(--stop), var(--track) var(--stop));
    }
    .slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: var(--thumb);
      height: var(--thumb);
      margin-top: -6px;
      border: 0;
      border-radius: 50%;
      background: var(--accent);
    }
    .ticks {
      position: relative;
      height: 18px;
      margin-top: 2px;
      color: #a8a8b2;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .ticks span {
      position: absolute;
      top: 0;
      left: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--f));
      transform: translateX(-50%);
    }
    .hint { margin: 4px 0 0; font-size: 11px; color: #8a8a94; }
    .panel.visible { opacity: 1; transform: none; }
    .panel:not(.visible) { pointer-events: none; }
    @media (prefers-reduced-motion: reduce) {
      .panel { transition: none; }
    }
    [hidden] { display: none !important; }
  `;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  let host = null;
  let ui = null;
  let speeds = DEFAULT_SPEEDS.slice();
  let open = false;
  let controlsActive = false; // false cuando no hay vídeo: el overlay solo avisa
  let hideTimer = null;
  let fadeTimer = null;

  const fmt = (r) => `${Number(r.toFixed(3))}×`;

  function sanitizeSpeeds(list) {
    if (!Array.isArray(list)) return DEFAULT_SPEEDS.slice();
    const out = [];
    for (const x of list) {
      const n = Number(x);
      if (Number.isFinite(n) && n >= MIN_RATE && n <= MAX_RATE && !out.includes(n)) out.push(n);
    }
    return out.length >= 2 ? out : DEFAULT_SPEEDS.slice();
  }

  function nearestIndex(rate) {
    let best = 0;
    for (let i = 1; i < speeds.length; i++) {
      if (Math.abs(speeds[i] - rate) < Math.abs(speeds[best] - rate)) best = i;
    }
    return best;
  }

  function scheduleHide(ms) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideOverlay, ms == null ? AUTO_HIDE_MS : ms);
  }

  // Textos del overlay en el idioma actual (se llama al crearlo y cuando cambia el idioma).
  function applyOverlayLang() {
    if (!ui) return;
    const label = YSS.t('speed.aria');
    ui.panel.setAttribute('aria-label', label);
    ui.slider.setAttribute('aria-label', label);
    ui.title.textContent = YSS.t('speed.title');
    ui.hint.textContent = YSS.t('overlay.hint');
    ui.gear.title = YSS.t('overlay.gear');
    ui.gear.setAttribute('aria-label', YSS.t('overlay.gear'));
    if (open && !controlsActive) ui.status.textContent = YSS.t('status.openVideo');
  }

  function buildOverlay() {
    host = document.createElement('div');
    host.id = 'yt-speed-slider-host';
    host.style.cssText =
      'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:2147483647;display:none;';

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    const panel = el('div', 'panel');
    panel.setAttribute('role', 'dialog');
    
    const top = el('div', 'top');
    const rate = el('span', 'rate', '–');
    rate.setAttribute('aria-live', 'polite');
    const gear = el('button', 'gear', '⚙');
    gear.type = 'button';
    const title = el('span', 'title');
    top.append(title, rate, gear);

    const status = el('p', 'status');
    status.hidden = true;

    const controls = el('div', 'controls');
    const slider = el('input', 'slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '9';
    slider.step = '1';
    slider.value = '0';
    const ticks = el('div', 'ticks');
    ticks.setAttribute('aria-hidden', 'true');
    const hint = el('p', 'hint');
    controls.append(slider, ticks, hint);

    panel.append(top, status, controls);
    root.appendChild(panel);

    ui = { panel, rate, slider, ticks, status, controls, gear, title, hint };
    applyOverlayLang();

    ui.slider.addEventListener('input', () => setIndex(Number(ui.slider.value)));
    ui.gear.addEventListener('click', () => {
      api.runtime.sendMessage({ type: 'openOptions' }).catch(() => {});
      hideOverlay();
    });
    // Mientras el puntero está encima no se oculta; al salir, vuelve a contar.
    ui.panel.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    ui.panel.addEventListener('pointerleave', () => {
      if (open) scheduleHide();
    });
  }

  function buildTicks() {
    const n = speeds.length;
    ui.slider.min = 0;
    ui.slider.max = n - 1;
    ui.slider.step = 1;

    // Todas las etiquetas si caben; si hay muchas, se salta alguna pero siempre salen primera y última.
    ui.ticks.replaceChildren();
    const step = Math.ceil(n / 8);
    speeds.forEach((s, i) => {
      const isLast = i === n - 1;
      if (!isLast && (i % step !== 0 || n - 1 - i < step)) return;
      const span = document.createElement('span');
      span.textContent = String(Number(s.toFixed(3)));
      span.style.setProperty('--f', String(i / (n - 1)));
      ui.ticks.appendChild(span);
    });
  }

  // Valor del slider + posición del relleno (Chromium lo pinta con la variable --f).
  function setSlider(idx) {
    ui.slider.value = String(idx);
    const n = speeds.length;
    ui.slider.style.setProperty('--f', String(n > 1 ? idx / (n - 1) : 0));
  }

  function setIndex(i) {
    const idx = Math.min(speeds.length - 1, Math.max(0, i));
    const applied = setRate(speeds[idx]);
    setSlider(idx);
    ui.rate.textContent = fmt(applied);
    scheduleHide();
  }

  function step(dir) {
    setIndex(Number(ui.slider.value) + dir);
  }

  // En pantalla completa solo se ve el elemento a pantalla completa y sus descendientes,
  // así que el overlay se cuelga de él mientras dure.
  function overlayParent() {
    let p = document.fullscreenElement;
    if (p && p.tagName === 'VIDEO') p = p.parentElement;
    return p || document.documentElement;
  }

  function attachHost() {
    const p = overlayParent();
    if (host.parentNode !== p) p.appendChild(host);
  }

  document.addEventListener('fullscreenchange', () => {
    if (host && open) attachHost();
  });

  // Capturamos en window para ir antes que los atajos de YouTube (←/→ avanzan el vídeo, etc.).
  function onKeyDown(e) {
    if (!open || !controlsActive) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        step(-1);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        step(1);
        break;
      case 'Home':
        setIndex(0);
        break;
      case 'End':
        setIndex(speeds.length - 1);
        break;
      case 'Enter':
      case 'Escape':
        hideOverlay();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function onPointerDown(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (!path.includes(host)) hideOverlay();
  }

  async function showOverlay() {
    if (!host) buildOverlay();
    open = true; // antes del await: un segundo Alt+S mientras carga lo cierra

    let stored;
    try {
      stored = await api.storage.local.get({ speeds: DEFAULT_SPEEDS });
    } catch (_) {
      stored = { speeds: DEFAULT_SPEEDS };
    }
    if (!open) return;

    speeds = sanitizeSpeeds(stored.speeds);
    attachHost();

    const video = isPlayerPage() ? mainVideo() : null;
    controlsActive = !!video;
    ui.controls.hidden = !video;
    ui.status.hidden = !!video;

    if (video) {
      buildTicks();
      const idx = nearestIndex(video.playbackRate);
      setSlider(idx);
      ui.rate.textContent = fmt(video.playbackRate);
      scheduleHide();
    } else {
      ui.status.textContent = YSS.t('status.openVideo');
      ui.rate.textContent = '–';
      scheduleHide(NO_VIDEO_HIDE_MS);
    }

    clearTimeout(fadeTimer); // por si se reabre mientras se estaba desvaneciendo
    host.style.display = 'block';
    void ui.panel.offsetWidth; // fuerza el reflow para que la entrada también se anime
    ui.panel.classList.add('visible');
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
  }

  function hideOverlay() {
    open = false;
    controlsActive = false;
    clearTimeout(hideTimer);
    if (host) {
      // Fade-out: se quita la clase y, cuando acaba la transición, se oculta del todo.
      ui.panel.classList.remove('visible');
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        if (!open) host.style.display = 'none';
      }, FADE_MS);
    }
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
  }

  YSS.initLang(applyOverlayLang); // idioma guardado y cambios desde las opciones

  // --- Atajo propio -------------------------------------------------------
  // Firefox da prioridad a sus atajos (Ctrl+S, Ctrl+F…) sobre los de las extensiones, así que
  // además del atajo oficial (commands) la página escucha la misma combinación y cancela la
  // acción de Firefox. Solo la combinación actual se intercepta: si el usuario elige otra, la
  // anterior vuelve a funcionar como siempre. No se pueden pisar los atajos "reservados" de
  // Firefox (Ctrl+T, Ctrl+W, Ctrl+N…), ni funciona con el foco fuera de la página.
  const DEFAULT_SHORTCUT = 'Alt+S';
  const IS_MAC = /Mac/i.test(navigator.platform || '');
  const NAMED_KEYS = {
    Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Space: 'Space', Insert: 'Insert', Delete: 'Delete', Comma: 'Comma', Period: 'Period',
  };
  let combo = parseCombo(DEFAULT_SHORTCUT);
  let lastToggle = 0;

  // "Ctrl+Shift+S" -> { ctrl, alt, shift, meta, code } (o null si está vacío o no es válido)
  function parseCombo(text) {
    if (typeof text !== 'string' || !text) return null;
    const parts = text.split('+');
    const key = parts.pop();
    const c = { ctrl: false, alt: false, shift: false, meta: false, code: null };
    for (const m of parts) {
      if (m === 'Ctrl') c[IS_MAC ? 'meta' : 'ctrl'] = true; // en Mac, "Ctrl" de Firefox es Cmd
      else if (m === 'Command') c.meta = true;
      else if (m === 'MacCtrl') c.ctrl = true;
      else if (m === 'Alt') c.alt = true;
      else if (m === 'Shift') c.shift = true;
      else return null;
    }
    if (/^[A-Z]$/.test(key)) c.code = `Key${key}`;
    else if (/^[0-9]$/.test(key)) c.code = `Digit${key}`;
    else if (/^F([1-9]|1[0-2])$/.test(key)) c.code = key;
    else if (NAMED_KEYS[key]) c.code = NAMED_KEYS[key];
    else return null;
    return c;
  }

  function comboMatches(e) {
    return (
      !!combo &&
      !e.repeat &&
      e.code === combo.code &&
      e.ctrlKey === combo.ctrl &&
      e.altKey === combo.alt &&
      e.shiftKey === combo.shift &&
      e.metaKey === combo.meta
    );
  }

  // El atajo oficial (mensaje de background) y este listener pueden dispararse a la vez:
  // se ignora el segundo aviso para que no abra y cierre el overlay de golpe.
  function toggleOverlay() {
    const now = Date.now();
    if (now - lastToggle < 150) return;
    lastToggle = now;
    if (open) hideOverlay();
    else showOverlay();
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (!comboMatches(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleOverlay();
    },
    true
  );

  api.storage.local.get({ shortcut: null }).then((s) => {
    if (typeof s.shortcut === 'string') combo = parseCombo(s.shortcut);
  }).catch(() => {});
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.shortcut) return;
    const v = changes.shortcut.newValue;
    combo = parseCombo(typeof v === 'string' ? v : DEFAULT_SHORTCUT); // borrado = por defecto
  });

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'toggleOverlay') {
      // Atajo de teclado (llega desde background.js)
      toggleOverlay();
    } else if (msg.type === 'getState') {
      // Popup de la barra de extensiones
      const v = isPlayerPage() ? mainVideo() : null;
      sendResponse({ isVideo: !!v, rate: v ? v.playbackRate : null });
    } else if (msg.type === 'setRate') {
      const rate = Number(msg.rate);
      if (!Number.isFinite(rate)) {
        sendResponse({ ok: false });
        return;
      }
      const applied = setRate(rate);
      // Si el overlay está abierto a la vez, que no se quede con el valor antiguo.
      if (open && controlsActive) {
        setSlider(nearestIndex(applied));
        ui.rate.textContent = fmt(applied);
      }
      sendResponse({ ok: true, rate: applied });
    }
  });
})();
