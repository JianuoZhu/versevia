import { FONTS, STYLE_DEFAULTS, STYLE_KEYS, TEXT_STYLE_KEYS, colorRGB, accentInk } from './style-prefs.js';
// Optically centred, code-native vector mark; crisp at player-control sizes.
export const sentenceIcon = `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false"><path d="M7 5.5h18a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-4l-5 4v-4H7a3 3 0 0 1-3-3v-12a3 3 0 0 1 3-3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12h14M9 17h5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M18 17h5" stroke="#64ddc2" stroke-width="2.4" stroke-linecap="round"/></svg>`;

export const appearanceMarkup = `<div id="appearance-settings" hidden>
  <label>Theme<select id="theme"><option value="midnight">Midnight · dark</option><option value="mint">Mint · light</option></select></label>
  <div class="grid"><label>Font<select id="fontFamily">${Object.entries(FONTS).map(([id, font]) => `<option value="${id}">${font.label}</option>`).join('')}</select></label>
  <label>Weight<select id="fontWeight"><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label></div>
  <div class="grid color-grid"><label>Original<input type="color" id="originalColor"></label><label>Translation<input type="color" id="translationColor"></label><label>Subtitle background<input type="color" id="subtitleBackground"></label><label>UI accent<input type="color" id="accentColor"></label></div>
  <label>Line spacing <output id="lineHeight-value"></output><input id="lineHeight" type="range" min="1.1" max="2" step="0.05"></label>
  <label>Panel opacity <output id="panelOpacity-value"></output><input id="panelOpacity" type="range" min="35" max="100"></label>
  <label>Subtitle background <output id="subtitleOpacity-value"></output><input id="subtitleOpacity" type="range" min="0" max="100"></label>
  <label>Subtitle text opacity <output id="subtitleTextOpacity-value"></output><input id="subtitleTextOpacity" type="range" min="30" max="100"></label>
  <label>Original text size <output id="fontSize-value"></output><input id="fontSize" type="range" min="16" max="64"></label>
  <label>Translation / original size <output id="translationScale-value"></output><input id="translationScale" type="range" min="0.5" max="1.8" step="0.05"></label>
  <button id="edit-layout" class="primary wide" aria-pressed="false">Adjust subtitles with mouse</button>
  <p class="help">Drag the subtitles to move. Drag ↘ to resize both lines, or ↕ to resize the translation. Scroll to scale; Shift + scroll changes the ratio.</p>
  <button id="reset-layout" class="wide">Reset subtitle layout</button>
  <button id="reset-style" class="wide">Reset colors &amp; typography</button>
</div>`;

export const appearanceStyles = `
:host{--panel-rgb:20,27,38;--control:#293342;--border:#455366;--ink:#edf5f7;--muted:#a7b8c8;--accent:#81e3cb;--accent-ink:#123b31;--panel-alpha:.96;--subtitle-alpha:.85;--subtitle-text-alpha:1;--translation-scale:.9}
:host([data-theme=mint]){color-scheme:light;--panel-rgb:242,252,248;--control:#ffffffb8;--border:#b3d4c8;--ink:#163b33;--muted:#4d7368;--accent:#087e65;--accent-ink:#fff}
#panel{color:var(--ink);background:rgba(var(--panel-rgb),var(--panel-alpha));border-color:var(--border);border-radius:16px;padding:16px;width:320px;box-shadow:0 14px 45px #0005;backdrop-filter:blur(16px)}
#panel button,#panel select{color:var(--ink);background:var(--control);border-color:var(--border)}
#panel button:hover{filter:brightness(1.1)}#panel label,#status{color:var(--muted)}#panel .eyebrow{color:var(--accent)}
#panel header{margin-bottom:10px}#panel strong{font-size:18px;letter-spacing:-.025em}#panel .tabs{display:flex;gap:5px;padding:4px;background:var(--control);border-radius:10px;margin-bottom:14px}
#panel .tabs button{flex:1;background:transparent;border:0}#panel .tabs button[aria-selected=true],#panel .primary{background:var(--accent);color:var(--accent-ink)}
#appearance-settings{display:grid;gap:12px}#appearance-settings label{font-size:12px;position:relative;gap:6px}#appearance-settings output{position:absolute;right:0;top:0;font-variant-numeric:tabular-nums}
#panel input[type=range]{width:100%;padding:0;accent-color:var(--accent);cursor:pointer}#panel .help{font-size:11px;color:var(--muted);margin:0;line-height:1.6}#credit{color:var(--muted)}
#subtitle-frame{position:absolute;left:var(--subtitle-x,50%);top:var(--subtitle-y,88%);transform:translate(-50%,-100%);width:var(--subtitle-width,88%);max-width:calc(100% - 24px);pointer-events:none}
#subtitles{position:relative;inset:auto;font-size:var(--sentence-font-size);line-height:1.35;gap:6px;width:100%}
#subtitles div{background:rgba(8,11,16,var(--subtitle-alpha));opacity:var(--subtitle-text-alpha);padding:4px 12px;border-radius:6px}
#translated{font-size:calc(var(--sentence-font-size) * var(--translation-scale))}
#subtitles{font-family:var(--subtitle-font);font-weight:var(--subtitle-weight,600);line-height:var(--subtitle-line-height,1.4)}
#subtitles #original{color:var(--original-color,#fff)}#subtitles #translated{color:var(--translation-color,#9bead8)}
#subtitles div{background:rgba(var(--subtitle-bg-rgb,8,11,16),var(--subtitle-alpha))}
#panel .color-grid input{width:100%;height:30px;padding:2px;border:1px solid var(--border);border-radius:6px;background:var(--control);cursor:pointer}
#panel header .brand{display:flex;align-items:center;gap:9px}#panel header svg{color:var(--ink);flex-shrink:0}#panel .eyebrow{letter-spacing:.1em;font-size:9px;color:var(--muted)}
#panel .speech-help{padding:10px;border:1px solid var(--border);border-radius:10px;margin-top:12px;font-size:11px;color:var(--muted)}
.layout-handle{display:none;position:absolute;pointer-events:auto;touch-action:none;color:white!important;background:#087e65!important;border:1px solid #b3ffee!important;padding:4px 9px!important;line-height:1.2;border-radius:7px!important;z-index:5;font-size:12px!important}
#subtitle-frame[data-editing=true]{pointer-events:auto;touch-action:none;cursor:move;outline:1px dashed #6be9cc;outline-offset:8px;min-height:55px;border-radius:7px}
#subtitle-frame[data-editing=true] .layout-handle{display:block}#move-handle{left:0;top:-38px;cursor:move}#resize-handle{right:-8px;bottom:-32px;cursor:nwse-resize}#ratio-handle{right:-8px;top:-36px;cursor:ns-resize}#done-layout{left:50%;top:-38px;transform:translateX(-50%);cursor:pointer}
@media(max-height:420px){#panel{top:12px;bottom:50px;max-height:calc(100% - 62px)}}
`;

export function applyAppearance(host, root, prefs) {
  host.dataset.theme = prefs.theme || 'midnight';
  for (const [name, value] of Object.entries({ '--panel-alpha': (prefs.panelOpacity ?? 96) / 100, '--subtitle-alpha': (prefs.subtitleOpacity ?? 85) / 100,
    '--subtitle-text-alpha': (prefs.subtitleTextOpacity ?? 100) / 100, '--subtitle-x': `${prefs.subtitleX ?? 50}%`, '--subtitle-y': `${prefs.subtitleY ?? 88}%`,
    '--subtitle-width': `${Math.min(88, 2 * Math.min(prefs.subtitleX ?? 50, 100 - (prefs.subtitleX ?? 50)) - 4)}%`,
    '--sentence-font-size': `${prefs.fontSize}px`, '--translation-scale': prefs.translationScale ?? .9 })) host.style.setProperty(name, String(value));
  const style = { ...STYLE_DEFAULTS, ...prefs };
  for (const [name, value] of Object.entries({ '--subtitle-font': FONTS[style.fontFamily]?.css || FONTS.system.css, '--subtitle-weight': style.fontWeight,
    '--subtitle-line-height': style.lineHeight, '--original-color': style.originalColor, '--translation-color': style.translationColor,
    '--subtitle-bg-rgb': colorRGB(style.subtitleBackground), '--accent': style.accentColor, '--accent-ink': accentInk(style.accentColor) })) host.style.setProperty(name, value);
  for (const key of STYLE_KEYS) {
    const input = root.getElementById(key); if (!input) continue;
    input.value = style[key] ?? (key === 'subtitleTextOpacity' ? 100 : '');
    const output = root.getElementById(`${key}-value`);
    if (output) output.textContent = key === 'lineHeight' ? `${input.value}×` : key === 'translationScale' ? `${Math.round(input.value * 100)}%` : `${input.value}${key === 'fontSize' ? ' px' : '%'}`;
  }
}

export function bindAppearance({ host, root, player, getPreferences, preview, save }) {
  const frame = root.getElementById('subtitle-frame');
  const editButton = root.getElementById('edit-layout');
  const setEditing = on => { frame.dataset.editing = String(on); editButton.setAttribute('aria-pressed', String(on)); editButton.textContent = on ? 'Finish adjusting subtitles' : 'Adjust subtitles with mouse'; };
  root.getElementById('reading-tab').onclick = () => setTab(false);
  root.getElementById('appearance-tab').onclick = () => setTab(true);
  function setTab(appearance) {
    root.getElementById('reading-settings').hidden = appearance;
    root.getElementById('appearance-settings').hidden = !appearance;
    root.getElementById('reading-tab').setAttribute('aria-selected', String(!appearance));
    root.getElementById('appearance-tab').setAttribute('aria-selected', String(appearance));
  }
  for (const key of STYLE_KEYS) {
    const input = root.getElementById(key);
    input.oninput = () => preview({ [key]: TEXT_STYLE_KEYS.includes(key) ? input.value : Number(input.value) });
    input.onchange = () => { input.oninput(); save({ [key]: getPreferences()[key] }); };
  }
  root.getElementById('reset-style').onclick = () => { preview(STYLE_DEFAULTS); save({ ...STYLE_DEFAULTS }); };
  editButton.onclick = () => { setEditing(frame.dataset.editing !== 'true'); root.getElementById('close').click(); if (frame.dataset.editing === 'true') root.getElementById('done-layout').focus(); };
  root.getElementById('done-layout').onclick = () => setEditing(false);
  root.getElementById('reset-layout').onclick = () => { const defaults = { subtitleX: 50, subtitleY: 88, fontSize: 24, translationScale: .9 }; preview(defaults); save(defaults); };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let drag, wheelTimer;
  frame.addEventListener('pointerdown', event => {
    if (frame.dataset.editing !== 'true' || event.button !== 0 || event.target.id === 'done-layout') return;
    event.preventDefault(); event.stopPropagation();
    drag = { x: event.clientX, y: event.clientY, prefs: { ...getPreferences() }, type: event.target.id, rect: player.getBoundingClientRect(), pointer: event.pointerId, patch: {} };
    frame.setPointerCapture(event.pointerId);
  });
  frame.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (drag.type === 'resize-handle') drag.patch = { fontSize: Math.round(clamp(drag.prefs.fontSize + (dx + dy) / 8, 16, 64)) };
    else if (drag.type === 'ratio-handle') drag.patch = { translationScale: Math.round(clamp(drag.prefs.translationScale + dy / 100, .5, 1.8) * 100) / 100 };
    else drag.patch = { subtitleX: clamp(drag.prefs.subtitleX + dx / Math.max(1, drag.rect.width) * 100, 10, 90), subtitleY: clamp(drag.prefs.subtitleY + dy / Math.max(1, drag.rect.height) * 100, Math.min(90, Math.max(20, frame.getBoundingClientRect().height / Math.max(1, drag.rect.height) * 100 + 4)), 95) };
    preview(drag.patch);
  });
  const finish = () => { if (!drag) return; const patch = drag.patch; drag = undefined; save(patch); };
  frame.addEventListener('pointerup', finish); frame.addEventListener('pointercancel', finish); frame.addEventListener('lostpointercapture', finish);
  frame.addEventListener('wheel', event => {
    if (frame.dataset.editing !== 'true') return;
    event.preventDefault(); event.stopPropagation();
    const prefs = getPreferences(), key = event.shiftKey ? 'translationScale' : 'fontSize';
    preview({ [key]: event.shiftKey ? clamp(prefs[key] - Math.sign(event.deltaY) * .05, .5, 1.8) : clamp(prefs[key] - Math.sign(event.deltaY) * 2, 16, 64) });
    clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { if (host.isConnected) save({ fontSize: getPreferences().fontSize, translationScale: getPreferences().translationScale }); }, 200);
  }, { passive: false });
  frame.addEventListener('keydown', event => { if (event.key === 'Escape') setEditing(false); });
}
