import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { sentenceIcon } from '../extension/appearance.js';
// All icons derive from the exact vector used in the player and settings header.
const mark = sentenceIcon.slice(sentenceIcon.indexOf('>') + 1, sentenceIcon.lastIndexOf('</svg>'));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="128" height="128"><rect width="40" height="40" rx="12" fill="#81e3cb"/><g transform="translate(4 4)" color="#102520">${mark.replace('#64ddc2', '#102520')}</g></svg>`;
await mkdir('extension/icons', { recursive: true });
await writeFile('extension/icons/sentence.svg', svg);
for (const width of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  await writeFile(`extension/icons/sentence-${width}.png`, png);
}
console.log('Exported shared Sentence mark at 16, 32, 48 and 128 px.');
