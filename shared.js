// Valores comunes a los content scripts, el script de fondo, el popup y la página de opciones.
'use strict';

globalThis.YSS = (() => {
  const api = typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null;

  // Categorías de SponsorBlock que soporta la extensión (todas con actionType "skip").
  // Los textos (nombre, nombre corto, descripción) están en TEXTS: cat.<id>.name / .short / .hint
  const CATEGORIES = [
    { id: 'sponsor', color: '#00d400', mode: 'auto' },
    { id: 'selfpromo', color: '#ffff00', mode: 'button' },
    { id: 'interaction', color: '#cc00ff', mode: 'button' },
    { id: 'intro', color: '#00ffff', mode: 'mark' },
    { id: 'outro', color: '#0202ed', mode: 'mark' },
    { id: 'preview', color: '#008fd6', mode: 'mark' },
    { id: 'music_offtopic', color: '#ff9900', mode: 'mark' },
    { id: 'filler', color: '#7300ff', mode: 'mark' },
  ];

  const MODES = [{ id: 'off' }, { id: 'mark' }, { id: 'button' }, { id: 'auto' }];

  const COLOR_RE = /^#[0-9a-f]{6}$/i;

  // Rellena y valida lo guardado en storage (clave "sb"), con los valores por defecto donde falte algo.
  function mergeSettings(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    const out = { enabled: s.enabled !== false, notice: s.notice !== false, categories: {} };
    for (const c of CATEGORIES) {
      const sc = (s.categories && s.categories[c.id]) || {};
      out.categories[c.id] = {
        mode: MODES.some((m) => m.id === sc.mode) ? sc.mode : c.mode,
        color: typeof sc.color === 'string' && COLOR_RE.test(sc.color) ? sc.color.toLowerCase() : c.color,
      };
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Idiomas: español si el navegador está en español (cualquier variante), inglés para el resto.
  // El usuario puede forzar uno desde la página de opciones (clave "lang" en storage).
  // ---------------------------------------------------------------------------

  const LANGS = ['es', 'en'];

  const TEXTS = {
    es: {
      'lang.name': 'Español',
      'lang.switch': 'Cambiar idioma a inglés',

      'speed.aria': 'Velocidad de reproducción',
      'speed.title': 'Velocidad',
      'remember': 'Recordar la velocidad en los siguientes vídeos',
      'save': 'Guardar',
      'restore': 'Restaurar',
      'shortcut.none': 'sin asignar',

      'status.notYT': 'Esta pestaña no es de YouTube.',
      'status.reload': 'Recarga la pestaña de YouTube para activar la extensión.',
      'status.openVideo': 'Abre un vídeo de YouTube para cambiar su velocidad.',
      'status.failed': 'No se pudo cambiar la velocidad. Recarga la pestaña de YouTube.',

      'err.nan': '"{t}" no es un número (usa punto decimal: 1.5).',
      'err.range': '{t} está fuera de rango ({min}–{max}).',
      'err.min2': 'Necesito al menos dos velocidades distintas.',
      'err.max': 'Máximo {n} velocidades.',
      'speeds.saved': 'Guardado ({n} velocidades).',

      'overlay.hint': '← → cambian · Inicio/Fin extremos · Enter cierra',
      'overlay.gear': 'Personalizar velocidades y atajo',

      'popup.title': 'Velocidad de YouTube',
      'popup.kbd': 'Teclado: ← → cambian · Inicio/Fin extremos · Enter cierra',
      'popup.shortcut': 'Atajo para mostrar este control abajo, en la propia página:',
      'popup.change': 'Cambiar',
      'popup.sb': 'SponsorBlock: marcar y saltar patrocinios',
      'popup.customize': 'Personalizar velocidades',
      'popup.listHelp': 'Lista separada por comas. La primera queda en el extremo izquierdo del slider y la última en el derecho (punto decimal: 1.5).',

      'opt.title': 'YouTube Speed Slider: opciones',
      'opt.speeds': 'Velocidades',
      'opt.speedsHelp': 'Lista separada por comas. La primera queda en el extremo izquierdo del slider y la última en el derecho. Usa punto decimal (1.5). Rango permitido: 0.0625 a 16.',
      'opt.speedsAria': 'Lista de velocidades',
      'opt.sbLead': 'Marca en la barra de tiempo los segmentos de promoción que ha enviado la comunidad de <a>SponsorBlock</a> y permite saltarlos. Elige qué hacer con cada categoría y de qué color se marca.',
      'opt.sbEnabled': 'Activar SponsorBlock',
      'opt.sbNotice': 'Mostrar «Deshacer» tras un salto automático',
      'opt.thCategory': 'Categoría',
      'opt.thAction': 'Acción',
      'opt.thColor': 'Color',
      'opt.resetColors': 'Restaurar colores',
      'opt.privacy': 'Privacidad: para conocer los segmentos, la extensión envía a <c>sponsor.ajay.app</c> solo los 4 primeros caracteres del hash SHA-256 del ID de cada vídeo que ves, no el ID completo. Como en cualquier petición web, el servicio recibe también tu dirección IP. Esta extensión no recopila ni envía ningún otro dato.',
      'opt.disclaimer': 'Esta extensión es independiente y no está afiliada ni respaldada por SponsorBlock.',
      'opt.shortcutTitle': 'Atajo del control en la página',
      'opt.shortcutLead': 'Muestra u oculta el control de velocidad, abajo en el centro de YouTube. Por defecto: <k>Alt</k>+<k>S</k>.',
      'opt.change': 'Cambiar…',
      'opt.cancel': 'Cancelar',
      'opt.clear': 'Desactivar atajo',
      'opt.reset': 'Restaurar Alt+S',
      'opt.rules': 'Reglas de Firefox: la combinación debe llevar <k>Ctrl</k> o <k>Alt</k> (<k>Shift</k> solo como segunda tecla), o ser una tecla F1–F12 sola. Si tu combinación choca con otra de Firefox, esta extensión la sustituye con la página de YouTube enfocada (salvo atajos reservados como Ctrl+T, Ctrl+W o Ctrl+N). También se puede cambiar en <c>about:addons</c> → engranaje → <em>Administrar atajos de las extensiones</em>.',
      'opt.rulesChromium': 'Reglas: la combinación debe llevar <k>Ctrl</k> o <k>Alt</k> (<k>Shift</k> solo como segunda tecla), o ser una tecla F1–F12 sola. El atajo funciona con la página de YouTube enfocada y sustituye al del navegador si coinciden (salvo atajos reservados como Ctrl+T, Ctrl+W o Ctrl+N). Si no lo personalizas aquí, vale el que asignes en <c>{page}</c>.',

      'sc.press': 'Pulsa la nueva combinación…',
      'sc.captureHelp': 'Esc o "Cancelar" para salir sin cambiar nada.',
      'sc.saved': 'Atajo guardado: {s}. Si choca con uno del navegador, esta extensión lo sustituye con la página de YouTube enfocada (no con atajos reservados como Ctrl+T/W/N).',
      'sc.savedPageOnly': 'Guardado {s}, pero solo funcionará con la página de YouTube enfocada.',
      'sc.disabled': 'Atajo desactivado.',
      'sc.restored': 'Atajo restaurado al de por defecto.',
      'sc.restoreFailed': 'No se pudo restaurar el atajo.',
      'sc.errKey': 'Esa tecla no se puede usar en un atajo de extensión.',
      'sc.errWin': 'La tecla Windows no se puede usar en un atajo.',
      'sc.errShift': 'Shift no puede usarse solo: añade Ctrl o Alt.',
      'sc.errMods': 'Como máximo dos teclas modificadoras (por ejemplo Alt+Shift+S).',
      'sc.errPrimary': 'Hace falta Ctrl o Alt (o una tecla F1–F12 sola).',
      'opt.actionAria': 'Acción para {name}',
      'opt.colorAria': 'Color de {name}',

      'mode.off': 'Ignorar',
      'mode.mark': 'Solo marcar en la barra',
      'mode.button': 'Mostrar botón «Saltar»',
      'mode.auto': 'Saltar automáticamente',

      'chip.skip': 'Saltar {short}',
      'chip.undo': 'Saltado: {short} · Deshacer',

      'cat.sponsor.name': 'Patrocinio',
      'cat.sponsor.short': 'patrocinio',
      'cat.sponsor.hint': 'Promoción pagada o menciones de marcas dentro del vídeo.',
      'cat.selfpromo.name': 'Autopromoción',
      'cat.selfpromo.short': 'autopromoción',
      'cat.selfpromo.hint': 'Promoción de productos, canales o servicios propios del creador.',
      'cat.interaction.name': 'Recordatorio de interacción',
      'cat.interaction.short': 'recordatorio',
      'cat.interaction.hint': '«Suscríbete», «dale a like», «activa la campana»…',
      'cat.intro.name': 'Intro / animación',
      'cat.intro.short': 'intro',
      'cat.intro.hint': 'Tramo sin contenido real: animación o pausa de entrada.',
      'cat.outro.name': 'Créditos / tarjetas finales',
      'cat.outro.short': 'créditos',
      'cat.outro.hint': 'Créditos o pantalla final sin contenido.',
      'cat.preview.name': 'Avance / resumen',
      'cat.preview.short': 'avance',
      'cat.preview.hint': 'Recopilación de lo que viene o de lo ya visto.',
      'cat.music_offtopic.name': 'Música: parte sin música',
      'cat.music_offtopic.short': 'parte sin música',
      'cat.music_offtopic.hint': 'En vídeos musicales, tramos que no son música.',
      'cat.filler.name': 'Relleno / tangente',
      'cat.filler.short': 'relleno',
      'cat.filler.hint': 'Escenas añadidas solo como relleno o humor.',
    },
    en: {
      'lang.name': 'English',
      'lang.switch': 'Switch language to Spanish',

      'speed.aria': 'Playback speed',
      'speed.title': 'Speed',
      'remember': 'Remember the speed in following videos',
      'save': 'Save',
      'restore': 'Restore',
      'shortcut.none': 'not set',

      'status.notYT': 'This tab is not a YouTube tab.',
      'status.reload': 'Reload the YouTube tab to activate the extension.',
      'status.openVideo': 'Open a YouTube video to change its speed.',
      'status.failed': 'Could not change the speed. Reload the YouTube tab.',

      'err.nan': '"{t}" is not a number (use a decimal point: 1.5).',
      'err.range': '{t} is out of range ({min}–{max}).',
      'err.min2': 'I need at least two different speeds.',
      'err.max': 'Maximum {n} speeds.',
      'speeds.saved': 'Saved ({n} speeds).',

      'overlay.hint': '← → change · Home/End extremes · Enter closes',
      'overlay.gear': 'Customize speeds and shortcut',

      'popup.title': 'YouTube speed',
      'popup.kbd': 'Keyboard: ← → change · Home/End extremes · Enter closes',
      'popup.shortcut': 'Shortcut to show this control at the bottom of the page itself:',
      'popup.change': 'Change',
      'popup.sb': 'SponsorBlock: mark and skip sponsors',
      'popup.customize': 'Customize speeds',
      'popup.listHelp': 'Comma-separated list. The first value is the left end of the slider and the last is the right end (decimal point: 1.5).',

      'opt.title': 'YouTube Speed Slider: options',
      'opt.speeds': 'Speeds',
      'opt.speedsHelp': 'Comma-separated list. The first value is the left end of the slider and the last is the right end. Use a decimal point (1.5). Allowed range: 0.0625 to 16.',
      'opt.speedsAria': 'List of speeds',
      'opt.sbLead': 'Marks on the progress bar the sponsor segments submitted by the <a>SponsorBlock</a> community and lets you skip them. Choose what to do with each category and which color marks it.',
      'opt.sbEnabled': 'Enable SponsorBlock',
      'opt.sbNotice': 'Show "Undo" after an automatic skip',
      'opt.thCategory': 'Category',
      'opt.thAction': 'Action',
      'opt.thColor': 'Color',
      'opt.resetColors': 'Reset colors',
      'opt.privacy': 'Privacy: to find the segments, the extension sends to <c>sponsor.ajay.app</c> only the first 4 characters of the SHA-256 hash of the ID of each video you watch, not the full ID. Like any web request, the service also receives your IP address. This extension does not collect or send any other data.',
      'opt.disclaimer': 'This extension is independent and is not affiliated with or endorsed by SponsorBlock.',
      'opt.shortcutTitle': 'On-page control shortcut',
      'opt.shortcutLead': 'Shows or hides the speed control at the bottom center of YouTube. Default: <k>Alt</k>+<k>S</k>.',
      'opt.change': 'Change…',
      'opt.cancel': 'Cancel',
      'opt.clear': 'Disable shortcut',
      'opt.reset': 'Reset to Alt+S',
      'opt.rules': 'Firefox rules: the combination must include <k>Ctrl</k> or <k>Alt</k> (<k>Shift</k> only as a second key), or be a single F1–F12 key. If your combination clashes with a Firefox one, this extension overrides it while the YouTube page is focused (except reserved shortcuts such as Ctrl+T, Ctrl+W or Ctrl+N). It can also be changed in <c>about:addons</c> → gear → <em>Manage Extension Shortcuts</em>.',
      'opt.rulesChromium': 'Rules: the combination must include <k>Ctrl</k> or <k>Alt</k> (<k>Shift</k> only as a second key), or be a single F1–F12 key. The shortcut works while the YouTube page is focused and overrides the browser one if they clash (except reserved shortcuts such as Ctrl+T, Ctrl+W or Ctrl+N). If you do not customize it here, the one you assign in <c>{page}</c> applies.',

      'sc.press': 'Press the new combination…',
      'sc.captureHelp': 'Esc or "Cancel" to leave without changing anything.',
      'sc.saved': 'Shortcut saved: {s}. If it clashes with a browser one, this extension overrides it while the YouTube page is focused (not reserved shortcuts such as Ctrl+T/W/N).',
      'sc.savedPageOnly': 'Saved {s}, but it will only work while the YouTube page is focused.',
      'sc.disabled': 'Shortcut disabled.',
      'sc.restored': 'Shortcut restored to the default.',
      'sc.restoreFailed': 'Could not restore the shortcut.',
      'sc.errKey': 'That key cannot be used in an extension shortcut.',
      'sc.errWin': 'The Windows key cannot be used in a shortcut.',
      'sc.errShift': 'Shift cannot be used alone: add Ctrl or Alt.',
      'sc.errMods': 'At most two modifier keys (for example Alt+Shift+S).',
      'sc.errPrimary': 'Ctrl or Alt is required (or a single F1–F12 key).',
      'opt.actionAria': 'Action for {name}',
      'opt.colorAria': 'Color of {name}',

      'mode.off': 'Ignore',
      'mode.mark': 'Only mark on the bar',
      'mode.button': 'Show "Skip" button',
      'mode.auto': 'Skip automatically',

      'chip.skip': 'Skip {short}',
      'chip.undo': 'Skipped: {short} · Undo',

      'cat.sponsor.name': 'Sponsor',
      'cat.sponsor.short': 'sponsor',
      'cat.sponsor.hint': 'Paid promotion or brand mentions inside the video.',
      'cat.selfpromo.name': 'Self-promotion',
      'cat.selfpromo.short': 'self-promo',
      'cat.selfpromo.hint': "Promotion of the creator's own products, channels or services.",
      'cat.interaction.name': 'Interaction reminder',
      'cat.interaction.short': 'reminder',
      'cat.interaction.hint': '"Subscribe", "like the video", "turn on the bell"…',
      'cat.intro.name': 'Intro / animation',
      'cat.intro.short': 'intro',
      'cat.intro.hint': 'Section with no real content: intro animation or opening pause.',
      'cat.outro.name': 'Credits / end cards',
      'cat.outro.short': 'credits',
      'cat.outro.hint': 'Credits or end screen with no content.',
      'cat.preview.name': 'Preview / recap',
      'cat.preview.short': 'recap',
      'cat.preview.hint': 'Collection of clips showing what comes next or what was already seen.',
      'cat.music_offtopic.name': 'Music: non-music section',
      'cat.music_offtopic.short': 'non-music part',
      'cat.music_offtopic.hint': 'In music videos, sections that are not music.',
      'cat.filler.name': 'Filler / tangent',
      'cat.filler.short': 'filler',
      'cat.filler.hint': 'Scenes added only as filler or humor.',
    },
  };

  // Español (cualquier variante: es, es-ES, es-MX, es_AR…) -> 'es'; todo lo demás -> 'en'.
  function detectLang() {
    let ui = '';
    try {
      if (api && api.i18n && typeof api.i18n.getUILanguage === 'function') ui = api.i18n.getUILanguage();
    } catch (_) {
      /* se usa navigator.language */
    }
    if (!ui && typeof navigator !== 'undefined') ui = navigator.language || '';
    return /^es([-_]|$)/i.test(ui) ? 'es' : 'en';
  }

  const resolveLang = (stored) => (LANGS.includes(stored) ? stored : detectLang());

  let lang = detectLang();

  const getLang = () => lang;
  const setLang = (l) => {
    lang = resolveLang(l);
    return lang;
  };

  // t('chip.skip', { short: 'x' }) -> texto en el idioma actual (si falta, el inglés; si no, la clave)
  function t(key, vars) {
    let s = (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  }

  const catText = (id, field) => t(`cat.${id}.${field}`);

  // Carga el idioma guardado y avisa (onChange) al cargar y cada vez que cambie en otra pestaña/página.
  async function initLang(onChange) {
    const notify = () => {
      if (typeof onChange === 'function') onChange(lang);
    };
    try {
      if (api && api.storage && api.storage.onChanged) {
        api.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local' || !changes.lang) return;
          lang = resolveLang(changes.lang.newValue);
          notify();
        });
      }
      const s = await api.storage.local.get({ lang: null });
      lang = resolveLang(s.lang);
    } catch (_) {
      /* se queda el idioma detectado */
    }
    notify();
    return lang;
  }

  // --- Textos en páginas HTML (popup y opciones) ---
  const RICH = { k: 'kbd', c: 'code', em: 'em', a: 'a' };

  // Texto con etiquetas mínimas (<k>, <c>, <em>, <a>) convertido a nodos DOM, sin innerHTML.
  function setRich(el, text) {
    el.replaceChildren();
    const re = /<(k|c|em|a)>([\s\S]*?)<\/\1>/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.append(text.slice(last, m.index));
      const node = document.createElement(RICH[m[1]]);
      node.textContent = m[2];
      if (m[1] === 'a') {
        node.href = 'https://sponsor.ajay.app';
        node.target = '_blank';
        node.rel = 'noopener';
      }
      el.append(node);
      last = re.lastIndex;
    }
    if (last < text.length) el.append(text.slice(last));
  }

  // data-i18n="clave" (texto), data-i18n-rich="clave" (texto con etiquetas),
  // data-i18n-attr="atributo:clave;otro:clave" (atributos).
  function applyI18n(root) {
    const scope = root || document;
    document.documentElement.lang = lang;
    const varsOf = (el) => {
      try {
        return el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : undefined;
      } catch (_) {
        return undefined;
      }
    };
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n, varsOf(el));
    });
    scope.querySelectorAll('[data-i18n-rich]').forEach((el) => setRich(el, t(el.dataset.i18nRich, varsOf(el))));
    scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(';').forEach((pair) => {
        const i = pair.indexOf(':');
        if (i > 0) el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
      });
    });
  }

  return {
    CATEGORIES, MODES, mergeSettings,
    LANGS, t, catText, getLang, setLang, detectLang, initLang, applyI18n,
  };
})();
