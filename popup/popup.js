'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;
const { t } = YSS;

const DEFAULT_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MIN_RATE = 0.0625;
const MAX_RATE = 16;
const MAX_ITEMS = 40;

const $ = (id) => document.getElementById(id);
const els = {
  slider: $('slider'),
  ticks: $('ticks'),
  rate: $('rate'),
  status: $('status'),
  reset: $('reset'),
  input: $('speedsInput'),
  save: $('save'),
  defaults: $('defaults'),
  msg: $('msg'),
  remember: $('remember'),
  shortcutText: $('shortcutText'),
  changeShortcut: $('changeShortcut'),
  sbEnabled: $('sbEnabled'),
};

let speeds = DEFAULT_SPEEDS.slice();
let tabId = null;
let connected = false;
let currentRate = 1;

const fmt = (r) => `${Number(r.toFixed(3))}×`;

// ---------- Lista de velocidades ----------

// Devuelve { speeds } o { error }. Respeta el orden que escribe el usuario.
function parseSpeeds(text) {
  const tokens = text
    .split(/[\s,;]+/)
    .map((x) => x.replace(/^[x×]|[x×]$/gi, ''))
    .filter(Boolean);

  const out = [];
  for (const tok of tokens) {
    const n = Number(tok);
    if (!Number.isFinite(n)) {
      return { error: t('err.nan', { t: tok }) };
    }
    if (n < MIN_RATE || n > MAX_RATE) {
      return { error: t('err.range', { t: tok, min: MIN_RATE, max: MAX_RATE }) };
    }
    if (!out.includes(n)) out.push(n);
  }
  if (out.length < 2) return { error: t('err.min2') };
  if (out.length > MAX_ITEMS) return { error: t('err.max', { n: MAX_ITEMS }) };
  return { speeds: out };
}

function sanitizeStored(list) {
  if (!Array.isArray(list)) return DEFAULT_SPEEDS.slice();
  const parsed = parseSpeeds(list.join(','));
  return parsed.speeds || DEFAULT_SPEEDS.slice();
}

// ---------- Slider ----------

function nearestIndex(rate) {
  let best = 0;
  for (let i = 1; i < speeds.length; i++) {
    if (Math.abs(speeds[i] - rate) < Math.abs(speeds[best] - rate)) best = i;
  }
  return best;
}

function buildSlider(rate) {
  const n = speeds.length;
  els.slider.min = 0;
  els.slider.max = n - 1;
  els.slider.step = 1;
  els.slider.value = nearestIndex(rate);
  paintProgress();

  // Etiquetas: todas si caben; si hay muchas, se salta alguna pero siempre salen primera y última.
  els.ticks.replaceChildren();
  const step = Math.ceil(n / 8);
  speeds.forEach((s, i) => {
    const isLast = i === n - 1;
    if (!isLast && (i % step !== 0 || n - 1 - i < step)) return;
    const span = document.createElement('span');
    span.textContent = String(Number(s.toFixed(3)));
    span.style.setProperty('--f', String(i / (n - 1)));
    els.ticks.appendChild(span);
  });
}

// El relleno rojo de la izquierda lo pinta ::-moz-range-progress; esto solo mantiene
// el valor accesible para lectores de pantalla.
function paintProgress() {
  els.slider.setAttribute('aria-valuetext', fmt(speeds[Number(els.slider.value)]));
  // Chromium pinta el relleno con un degradado que usa esta variable (0–1).
  const n = speeds.length;
  els.slider.style.setProperty('--f', String(n > 1 ? Number(els.slider.value) / (n - 1) : 0));
}

function showRate(rate) {
  currentRate = rate;
  els.rate.textContent = fmt(rate);
}

function setStatus(text) {
  els.status.textContent = text;
  els.status.hidden = !text;
}

function setEnabled(on) {
  els.slider.disabled = !on;
  els.reset.disabled = !on;
}

// ---------- Comunicación con la pestaña ----------

async function send(message) {
  if (tabId == null) return null;
  try {
    return await api.tabs.sendMessage(tabId, message);
  } catch (_) {
    return null; // sin content script (pestaña abierta antes de instalar) o no es YouTube
  }
}

async function changeRate(rate) {
  showRate(rate);
  const res = await send({ type: 'setRate', rate });
  if (!res || !res.ok) {
    setStatus(t('status.failed'));
    setEnabled(false);
    return;
  }
  if (res.rate !== rate) showRate(res.rate);
}

// ---------- Eventos ----------

els.slider.addEventListener('input', () => {
  paintProgress();
  changeRate(speeds[Number(els.slider.value)]);
});

els.reset.addEventListener('click', () => {
  els.slider.value = nearestIndex(1);
  paintProgress();
  changeRate(1);
});

function setMsg(text, kind) {
  els.msg.textContent = text;
  els.msg.className = `msg${kind ? ` ${kind}` : ''}`;
}

async function applyList(text) {
  const parsed = parseSpeeds(text);
  if (parsed.error) {
    setMsg(parsed.error, 'error');
    return;
  }
  speeds = parsed.speeds;
  await api.storage.local.set({ speeds });
  els.input.value = speeds.join(', ');
  buildSlider(currentRate);
  setMsg(t('speeds.saved', { n: speeds.length }), 'ok');
}

els.save.addEventListener('click', () => applyList(els.input.value));
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyList(els.input.value);
});
els.defaults.addEventListener('click', () => applyList(DEFAULT_SPEEDS.join(', ')));

els.remember.addEventListener('change', () => {
  api.storage.local.set({ remember: els.remember.checked });
});

// Interruptor general de SponsorBlock (el resto de ajustes están en la página de opciones).
els.sbEnabled.addEventListener('change', async () => {
  const { sb } = await api.storage.local.get({ sb: null });
  await api.storage.local.set({ sb: { ...(sb || {}), enabled: els.sbEnabled.checked } });
});

// "Cambiar" abre la página de opciones, donde se reasigna el atajo.
els.changeShortcut.addEventListener('click', () => {
  api.runtime.openOptionsPage();
  window.close();
});

// Muestra el atajo que tiene ahora mismo (el usuario puede haberlo cambiado).
async function showShortcut() {
  try {
    const all = await api.commands.getAll();
    const cmd = all.find((c) => c.name === 'toggle-overlay');
    els.shortcutText.textContent = cmd && cmd.shortcut ? cmd.shortcut : t('shortcut.none');
  } catch (_) {
    /* se queda el texto por defecto */
  }
}

// Enter sobre el slider cierra el popup (Escape ya lo cierra Firefox).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target === els.slider) window.close();
});

// ---------- Arranque ----------

async function init() {
  await YSS.initLang(() => YSS.applyI18n());
  showShortcut();
  const stored = await api.storage.local.get({ speeds: DEFAULT_SPEEDS, remember: true, sb: null });
  els.sbEnabled.checked = !(stored.sb && stored.sb.enabled === false);
  speeds = sanitizeStored(stored.speeds);
  els.input.value = speeds.join(', ');
  els.remember.checked = stored.remember !== false;

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : null;

  // tab.url solo está disponible en pestañas donde tenemos permiso (youtube.com)
  const onYouTube = !!tab && /^https?:\/\/([^/]*\.)?youtube\.com\//.test(tab.url || '');

  let state = null;
  if (!onYouTube) {
    setStatus(t('status.notYT'));
  } else {
    state = await send({ type: 'getState' });
    if (!state) setStatus(t('status.reload'));
    else if (!state.isVideo) setStatus(t('status.openVideo'));
    else connected = true;
  }

  const rate = connected && state.rate ? state.rate : 1;
  buildSlider(rate);
  if (connected) showRate(rate);
  setEnabled(connected);
  setStatus(connected ? '' : els.status.textContent);

  // Abierto con el atajo de teclado: el foco queda en el slider para usar las flechas.
  if (connected) els.slider.focus();
}

init();
