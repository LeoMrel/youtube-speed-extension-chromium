// Script de fondo (event page): atajo, página de opciones y consulta de segmentos de SponsorBlock.
'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;
const COMMAND = 'toggle-overlay';

// Si el usuario eligió otro atajo en las opciones y el navegador no pudo reasignar el oficial
// (Chromium no tiene commands.update), el oficial se ignora: lo gestiona la página (content.js).
async function officialShortcutIsOverridden() {
  try {
    const { shortcut } = await api.storage.local.get({ shortcut: null });
    if (typeof shortcut !== 'string') return false;
    const all = await api.commands.getAll();
    const cmd = all.find((c) => c.name === COMMAND);
    return (cmd && cmd.shortcut ? cmd.shortcut : '') !== shortcut;
  } catch (_) {
    return false;
  }
}

api.commands.onCommand.addListener(async (command) => {
  if (command !== COMMAND) return;
  if (await officialShortcutIsOverridden()) return;
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return;
    await api.tabs.sendMessage(tab.id, { type: 'toggleOverlay' });
  } catch (_) {
    // La pestaña activa no es de YouTube (o no tiene content script): no hay nada que mostrar.
  }
});

// Los content scripts no pueden abrir la página de opciones; lo hacen a través de este mensaje.
api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'openOptions') api.runtime.openOptionsPage();
});

// El atajo que elige el usuario se guarda también en storage y se reaplica al arrancar,
// por si Firefox no conservara el cambio hecho con commands.update().
async function restoreShortcut() {
  try {
    const { shortcut } = await api.storage.local.get({ shortcut: null });
    if (typeof shortcut !== 'string') return; // nunca se ha personalizado: vale el de por defecto
    const all = await api.commands.getAll();
    const cmd = all.find((c) => c.name === COMMAND);
    if (cmd && (cmd.shortcut || '') !== shortcut) {
      await api.commands.update({ name: COMMAND, shortcut });
    }
  } catch (_) {
    /* si falla, queda el atajo que tenga Firefox */
  }
}

api.runtime.onStartup.addListener(restoreShortcut);
api.runtime.onInstalled.addListener(restoreShortcut);

// Si el usuario lo cambia desde about:addons, guardamos ese valor para no pisarlo al reiniciar.
if (api.commands.onChanged) {
  api.commands.onChanged.addListener((change) => {
    if (change && change.name === COMMAND) {
      api.storage.local.set({ shortcut: change.newShortcut || '' }).catch(() => {});
    }
  });
}

// ---------------------------------------------------------------------------
// SponsorBlock
// ---------------------------------------------------------------------------

const SB_API = 'https://sponsor.ajay.app/api/skipSegments/';
const SB_TIMEOUT_MS = 8000;

// Privacidad: no se envía el ID del vídeo, solo los 4 primeros caracteres hexadecimales de su
// SHA-256 (lo recomendado por la API). La respuesta trae varios vídeos y aquí se filtra el nuestro.
async function sha256Prefix(videoID) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoID));
  const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 4);
}

async function fetchSegments(videoID, categories) {
  const allowed = new Set(YSS.CATEGORIES.map((c) => c.id));
  const cats = (Array.isArray(categories) ? categories : []).filter((c) => allowed.has(c));
  if (typeof videoID !== 'string' || !/^[\w-]{6,20}$/.test(videoID) || !cats.length) return [];

  const qs = new URLSearchParams();
  cats.forEach((c) => qs.append('category', c));
  qs.append('actionType', 'skip');

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), SB_TIMEOUT_MS);
  try {
    const res = await fetch(`${SB_API}${await sha256Prefix(videoID)}?${qs}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return []; // ningún vídeo con ese prefijo tiene segmentos
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const entry = Array.isArray(data) ? data.find((v) => v && v.videoID === videoID) : null;
    if (!entry || !Array.isArray(entry.segments)) return [];

    return entry.segments
      .filter(
        (s) =>
          s &&
          allowed.has(s.category) &&
          (s.actionType === undefined || s.actionType === 'skip') &&
          Array.isArray(s.segment) &&
          Number.isFinite(s.segment[0]) &&
          Number.isFinite(s.segment[1]) &&
          s.segment[1] > s.segment[0]
      )
      .map((s) => ({
        uuid: String(s.UUID),
        category: s.category,
        start: s.segment[0],
        end: s.segment[1],
        duration: Number(s.videoDuration) || 0,
      }));
  } finally {
    clearTimeout(timeout);
  }
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'sbSegments') return;
  fetchSegments(msg.videoID, msg.categories).then(
    (segments) => sendResponse({ ok: true, segments }),
    () => sendResponse({ ok: false })
  );
  return true; // respuesta asíncrona
});
