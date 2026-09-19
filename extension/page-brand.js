import { sentenceIcon } from './appearance.js';
import { FONTS, STYLE_DEFAULTS, accentInk, colorRGB } from './style-prefs.js';

export function applyPageBrand(prefs) {
  const page = document.documentElement;
  page.dataset.theme = prefs.theme || 'midnight';
  page.style.setProperty('--accent', prefs.accentColor || STYLE_DEFAULTS.accentColor);
  page.style.setProperty('--accent-ink', accentInk(prefs.accentColor || STYLE_DEFAULTS.accentColor));
  if (!document.querySelector('.brand-banner')) {
    const brand = document.createElement('div'); brand.className = 'brand-banner';
    brand.innerHTML = `<span class="brand-mark">${sentenceIcon}</span><span>Sentence<small>Two languages. One thought.</small></span>`;
    document.querySelector('main').prepend(brand);
  }
}

export function createStyleEditor() {
  const section = document.createElement('section'); section.id = 'style-editor';
  section.innerHTML = `<div class="eyebrow">Make it yours</div><h2>Colors &amp; typography</h2><p class="muted">A shared look across the player and settings. Uses fonts already on your device.</p>
  <div class="grid"><label>Interface theme<select id="style-theme"><option value="midnight">Midnight</option><option value="mint">Mint</option></select></label>
  <label>Subtitle font<select id="style-fontFamily">${Object.entries(FONTS).map(([id, font]) => `<option value="${id}">${font.label}</option>`).join('')}</select></label>
  <label>Weight<select id="style-fontWeight"><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label>
  <label>Line spacing<input id="style-lineHeight" type="range" min="1.1" max="2" step="0.05"></label></div>
  <div class="palette">${[['originalColor', 'Original'], ['translationColor', 'Translation'], ['subtitleBackground', 'Background'], ['accentColor', 'UI accent']].map(([id, label]) => `<label>${label}<input type="color" id="style-${id}"></label>`).join('')}</div>
  <div class="subtitle-preview" aria-label="Subtitle style preview"><span class="preview-original">Every sentence opens a new world.</span><span class="preview-translation">每一句话，都打开一个新世界。</span></div>
  <button id="save-style">Save appearance</button><p id="style-status" class="status" role="status"></p>`;
  document.querySelector('main').insertBefore(section, document.getElementById('clear-cache').closest('section'));
  return section;
}
export function createSettingsNavigation() {
  const sections = [...document.querySelectorAll('main > section')];
  const details = document.querySelector('main > details');
  const nav = document.createElement('nav'); nav.className = 'settings-nav'; nav.setAttribute('aria-label', 'Settings sections');
  const labels = ['Providers', 'Reading', 'Appearance', 'Local data'];
  const select = index => {
    sections.forEach((section, i) => { section.hidden = i !== index; });
    [...nav.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    if (details) details.hidden = index !== 3;
  };
  sections.forEach((section, i) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = labels[i];
    button.onclick = () => select(i); nav.append(button);
  });
  sections[0].before(nav); select(0);
}
export function readStyleEditor() {
  return Object.fromEntries(['theme', ...Object.keys(STYLE_DEFAULTS)].map(key => {
    const value = document.getElementById(`style-${key}`).value;
    return [key, key === 'lineHeight' ? Number(value) : value];
  }));
}
export function previewStyle(prefs) {
  const preview = document.querySelector('.subtitle-preview'); if (!preview) return;
  const style = { ...STYLE_DEFAULTS, ...prefs };
  preview.style.fontFamily = FONTS[style.fontFamily]?.css || FONTS.system.css;
  preview.style.fontWeight = style.fontWeight; preview.style.lineHeight = style.lineHeight;
  preview.style.setProperty('--preview-bg', `rgba(${colorRGB(style.subtitleBackground)},.85)`);
  preview.querySelector('.preview-original').style.color = style.originalColor;
  preview.querySelector('.preview-translation').style.color = style.translationColor;
}
export function loadStyleEditor(prefs) {
  for (const [key, value] of Object.entries({ ...STYLE_DEFAULTS, theme: 'midnight', ...prefs })) {
    const control = document.getElementById(`style-${key}`); if (control) control.value = value;
  }
  previewStyle(prefs);
}
