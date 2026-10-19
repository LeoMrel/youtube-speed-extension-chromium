'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;
const { t } = YSS;

const DEFAULT_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MIN_RATE = 0.0625;
const MAX_RATE = 16;
const MAX_ITEMS = 40;
const SHORTCUT_COMMAND = 'toggle-overlay';
const IS_MAC = /Mac/i.test(navigator.platform || '');

const $ = (id) => document.getElementById(id);
const els = {
  input: $('speedsInput'),
  save: $('save'),
  defaults: $('defaults'),
  msg: $('msg'),
  remember: $('remember'),
  shortcutCurrent: $('shortcutCurrent'),
  shortcutChange: $('shortcutChange'),
  shortcutClear: $('shortcutClear'),
  shortcutReset: $('shortcutReset'),
  shortcutMsg: $('shortcutMsg'),
  sbEnabled: $('sbEnabled'),
  sbNotice: $('sbNotice'),
  sbRows: $('sbRows'),
  sbResetColors: $('sbResetColors'),
  langToggle: $('langToggle'),
  rules: $('shortcutRules'),
};

// Chromium (Chrome, Edge, Opera, Helium…) no tiene commands.update(): allí el atajo elegido aquí
// lo gestiona solo la página (content.js). Firefox sí puede reasignar el atajo oficial.
const CAN_UPDATE_COMMAND = !!(api.commands && typeof api.commands.update === 'function');
function shortcutsPage() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'edge://extensions/shortcuts';
  if (/OPR\//.test(ua)) return 'opera://extensions/shortcuts';
  return 'chrome://extensions/shortcuts';
}

// ---------------------------------------------------------------------------
// Lista de velocidades
// ---------------------------------------------------------------------------

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
  await api.storage.local.set({ speeds: parsed.speeds });
  els.input.value = parsed.speeds.join(', ');
  setMsg(t('speeds.saved', { n: parsed.speeds.length }), 'ok');
}

els.save.addEventListener('click', () => applyList(els.input.value));
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyList(els.input.value);
});
els.defaults.addEventListener('click', () => applyList(DEFAULT_SPEEDS.join(', ')));
els.remember.addEventListener('change', () => {
  api.storage.local.set({ remember: els.remember.checked });
});

// ---------------------------------------------------------------------------
// Atajo del control en la página
// ---------------------------------------------------------------------------

// Teclas que Firefox admite en un atajo de extensión (por posición física, no por layout).
function keyFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  const map = {
    Comma: 'Comma',
    Period: 'Period',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Space: 'Space',
    Insert: 'Insert',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  return map[code] || null;
}

// Convierte un keydown en el formato de Firefox ("Alt+Shift+S", "F8", ...).
// Devuelve { shortcut }, { error } o { pending } (solo se ha pulsado un modificador).
function shortcutFromEvent(e) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return { pending: true };

  const key = keyFromCode(e.code);
  if (!key) return { error: t('sc.errKey') };

  const mods = [];
  if (IS_MAC) {
    if (e.metaKey) mods.push('Command');
    if (e.ctrlKey) mods.push('MacCtrl');
  } else {
    if (e.metaKey) return { error: t('sc.errWin') };
    if (e.ctrlKey) mods.push('Ctrl');
  }
  if (e.altKey) mods.push('Alt');

  const hasPrimary = mods.length > 0;
  if (e.shiftKey) {
    if (!hasPrimary) return { error: t('sc.errShift') };
    mods.push('Shift');
  }
  if (mods.length > 2) return { error: t('sc.errMods') };
  if (!hasPrimary && !/^F\d+$/.test(key)) {
    return { error: t('sc.errPrimary') };
  }
  return { shortcut: [...mods, key].join('+') };
}

function setShortcutMsg(text, kind) {
  els.shortcutMsg.textContent = text;
  els.shortcutMsg.className = `msg${kind ? ` ${kind}` : ''}`;
}

// Atajo vigente: el elegido aquí (lo aplica la página) o, si nunca se personalizó, el del navegador.
async function currentShortcut() {
  const { shortcut } = await api.storage.local.get({ shortcut: null });
  if (typeof shortcut === 'string') return shortcut;
  const all = await api.commands.getAll();
  const cmd = all.find((c) => c.name === SHORTCUT_COMMAND);
  return cmd && cmd.shortcut ? cmd.shortcut : '';
}

async function refreshShortcut() {
  try {
    const sc = await currentShortcut();
    els.shortcutCurrent.textContent = sc || t('shortcut.none');
  } catch (_) {
    els.shortcutCurrent.textContent = '?';
  }
}

async function saveShortcut(shortcut) {
  // La página también escucha esta combinación (content.js), así que se guarda siempre:
  // si el navegador la rechaza o la usa para otra cosa, sigue funcionando con la página enfocada.
  let accepted = true;
  if (CAN_UPDATE_COMMAND) {
    try {
      await api.commands.update({ name: SHORTCUT_COMMAND, shortcut });
    } catch (_) {
      accepted = false;
    }
  }
  await api.storage.local.set({ shortcut });
  if (!shortcut) setShortcutMsg(t('sc.disabled'), 'ok');
  else if (accepted) setShortcutMsg(t('sc.saved', { s: shortcut }), 'ok');
  else setShortcutMsg(t('sc.savedPageOnly', { s: shortcut }), 'ok');
  await refreshShortcut();
}

let capturing = false;

function onCaptureKey(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    stopCapture();
    return;
  }
  const res = shortcutFromEvent(e);
  if (res.pending) return;
  if (res.error) {
    setShortcutMsg(res.error, 'error'); // sigue esperando otra combinación
    return;
  }
  stopCapture();
  saveShortcut(res.shortcut);
}

function startCapture() {
  capturing = true;
  els.shortcutCurrent.textContent = t('sc.press');
  els.shortcutChange.textContent = t('opt.cancel');
  setShortcutMsg(t('sc.captureHelp'), '');
  document.addEventListener('keydown', onCaptureKey, true);
}

function stopCapture() {
  capturing = false;
  els.shortcutChange.textContent = t('opt.change');
  document.removeEventListener('keydown', onCaptureKey, true);
  refreshShortcut();
}

els.shortcutChange.addEventListener('click', () => (capturing ? stopCapture() : startCapture()));

els.shortcutClear.addEventListener('click', () => {
  if (capturing) stopCapture();
  saveShortcut('');
});

els.shortcutReset.addEventListener('click', async () => {
  if (capturing) stopCapture();
  try {
    if (CAN_UPDATE_COMMAND && typeof api.commands.reset === 'function') {
      await api.commands.reset(SHORTCUT_COMMAND);
    }
    await api.storage.local.remove('shortcut');
    setShortcutMsg(t('sc.restored'), 'ok');
  } catch (_) {
    setShortcutMsg(t('sc.restoreFailed'), 'error');
  }
  await refreshShortcut();
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SponsorBlock
// ---------------------------------------------------------------------------

function buildSbRows(settings) {
  els.sbRows.replaceChildren();
  for (const c of YSS.CATEGORIES) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    const name = document.createElement('strong');
    name.textContent = YSS.catText(c.id, 'name');
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = YSS.catText(c.id, 'hint');
    tdName.append(name, hint);

    const select = document.createElement('select');
    select.dataset.cat = c.id;
    select.setAttribute('aria-label', t('opt.actionAria', { name: YSS.catText(c.id, 'name') }));
    for (const m of YSS.MODES) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = t(`mode.${m.id}`);
      select.appendChild(opt);
    }
    select.value = settings.categories[c.id].mode;
    select.addEventListener('change', saveSb);
    const tdMode = document.createElement('td');
    tdMode.appendChild(select);

    const color = document.createElement('input');
    color.type = 'color';
    color.dataset.cat = c.id;
    color.setAttribute('aria-label', t('opt.colorAria', { name: YSS.catText(c.id, 'name') }));
    color.value = settings.categories[c.id].color;
    color.addEventListener('change', saveSb);
    const tdColor = document.createElement('td');
    tdColor.appendChild(color);

    tr.append(tdName, tdMode, tdColor);
    els.sbRows.appendChild(tr);
  }
}

// Lee el estado de la pantalla, lo valida y lo guarda (clave "sb").
async function saveSb() {
  const draft = { enabled: els.sbEnabled.checked, notice: els.sbNotice.checked, categories: {} };
  for (const c of YSS.CATEGORIES) {
    draft.categories[c.id] = {
      mode: els.sbRows.querySelector(`select[data-cat="${c.id}"]`).value,
      color: els.sbRows.querySelector(`input[data-cat="${c.id}"]`).value,
    };
  }
  await api.storage.local.set({ sb: YSS.mergeSettings(draft) });
}

els.sbEnabled.addEventListener('change', saveSb);
els.sbNotice.addEventListener('change', saveSb);
els.sbResetColors.addEventListener('click', () => {
  for (const c of YSS.CATEGORIES) {
    els.sbRows.querySelector(`input[data-cat="${c.id}"]`).value = c.color;
  }
  saveSb();
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Idioma
// ---------------------------------------------------------------------------

// Pinta todos los textos en el idioma actual (y reconstruye lo que se genera por código).
async function render() {
  els.rules.dataset.i18nRich = CAN_UPDATE_COMMAND ? 'opt.rules' : 'opt.rulesChromium';
  els.rules.dataset.i18nVars = JSON.stringify({ page: shortcutsPage() });
  YSS.applyI18n();
  document.title = t('opt.title');
  els.langToggle.textContent = `🌐 ${YSS.getLang() === 'es' ? 'English' : 'Español'}`;
  els.shortcutChange.textContent = t(capturing ? 'opt.cancel' : 'opt.change');
  els.msg.textContent = '';
  els.shortcutMsg.textContent = '';
  const { sb } = await api.storage.local.get({ sb: null });
  buildSbRows(YSS.mergeSettings(sb));
  if (!capturing) await refreshShortcut();
}

els.langToggle.addEventListener('click', async () => {
  const next = YSS.getLang() === 'es' ? 'en' : 'es';
  YSS.setLang(next);
  try {
    await api.storage.local.set({ lang: next });
  } catch (_) {
    /* se aplica igualmente en esta página */
  }
  await render();
});

// ---------------------------------------------------------------------------

(async function init() {
  await YSS.initLang(); // idioma guardado o, si no hay, el del navegador
  const stored = await api.storage.local.get({ speeds: DEFAULT_SPEEDS, remember: true, sb: null });
  els.input.value = sanitizeStored(stored.speeds).join(', ');
  els.remember.checked = stored.remember !== false;

  const sb = YSS.mergeSettings(stored.sb);
  els.sbEnabled.checked = sb.enabled;
  els.sbNotice.checked = sb.notice;
  await render();
})();
