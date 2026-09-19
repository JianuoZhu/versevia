// Only bundled/system fonts: appearance never downloads a font or executes CSS.
export const FONTS = {
  system: { label: 'System · clean', css: 'system-ui, "Segoe UI", sans-serif' },
  humanist: { label: 'Humanist · rounded', css: '"Trebuchet MS", "Segoe UI", sans-serif' },
  serif: { label: 'Serif · reading', css: 'Georgia, "Noto Serif CJK SC", "SimSun", serif' },
  mono: { label: 'Mono · precise', css: 'Consolas, "Cascadia Code", monospace' }
};
export const STYLE_DEFAULTS = Object.freeze({ fontFamily: 'system', fontWeight: '600', lineHeight: 1.4,
  originalColor: '#ffffff', translationColor: '#9bead8', subtitleBackground: '#080b10', accentColor: '#81e3cb' });
export const STYLE_KEYS = ['theme', ...Object.keys(STYLE_DEFAULTS), 'panelOpacity', 'subtitleOpacity', 'subtitleTextOpacity', 'fontSize', 'translationScale'];
export const TEXT_STYLE_KEYS = ['theme', 'fontFamily', 'fontWeight', 'originalColor', 'translationColor', 'subtitleBackground', 'accentColor'];
export function colorRGB(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(','); }
export function accentInk(hex) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#102520' : '#ffffff';
}
