#!/usr/bin/env node
// Renders assets/banner-light.svg and assets/banner-dark.svg (README banner).
// Text is laid out by satori with Source Sans 3 and JetBrains Mono and drawn
// as SVG paths, so the banner looks the same without the fonts installed.
// Run by hand after a copy or design change, then commit the two SVGs.
//
// Needs satori 0.35.0, @fontsource/source-sans-3 5.2.8 and
// @fontsource/jetbrains-mono 5.3.0 installed in a folder of your choice
// (they are not dependencies of this repo):
//   DEPS=/path/to/folder node assets/render-banners.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const deps = process.env.DEPS;
if (!deps) throw new Error('set DEPS to the folder that holds satori and the fonts');
const require = createRequire(path.join(path.resolve(deps), 'package.json'));
const satoriModule = await import(pathToFileURL(require.resolve('satori')).href);
const satori = satoriModule.default?.default ?? satoriModule.default;
const font = (pkg, file) => fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files', file));
const fonts = [
  { name: 'Source Sans 3', weight: 400, style: 'normal', data: font('@fontsource/source-sans-3', 'source-sans-3-latin-400-normal.woff') },
  { name: 'Source Sans 3', weight: 700, style: 'normal', data: font('@fontsource/source-sans-3', 'source-sans-3-latin-700-normal.woff') },
  { name: 'JetBrains Mono', weight: 400, style: 'normal', data: font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff') },
];

const THEMES = {
  light: { bg: '#ffffff', ink: '#0a2540', muted: '#4b5563', rule: '#0a2540', card: '#f5f8fc', cardBorder: '#d7deea', cardInk: '#0a2540' },
  dark: { bg: '#0a2540', ink: '#ffffff', muted: '#c9d6e8', rule: '#c9d6e8', card: '#12335a', cardBorder: '#24507f', cardInk: '#ffffff' },
};
const h = (style, ...children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children } });

const W = 1280;
const H = 580;
function banner(t) {
  return h(
    { width: W, height: H, background: t.bg, color: t.ink, fontFamily: 'Source Sans 3', flexDirection: 'column', padding: '56px 77px', justifyContent: 'space-between' },
    h(
      { justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `3px solid ${t.rule}`, paddingBottom: 16 },
      h({ fontWeight: 700, fontSize: 26, color: t.ink }, 'Use AI Securely'),
      h({ fontSize: 20, color: t.muted }, 'agents.useaisecurely.com'),
    ),
    h(
      { flexDirection: 'column' },
      h({ fontWeight: 700, fontSize: 80, lineHeight: 1.0, letterSpacing: '-0.02em' }, 'Security training for agents'),
      h({ fontSize: 30, color: t.muted, marginTop: 22 }, 'Your agents do real work now. Give them security training.'),
    ),
    h(
      { flexDirection: 'column', background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 14, padding: '22px 30px' },
      h({ fontSize: 18, color: t.muted, marginBottom: 8 }, 'The one prompt'),
      h({ fontFamily: 'JetBrains Mono', fontSize: 21, color: t.cardInk }, 'Read https://agents.useaisecurely.com/start.md and follow it.'),
    ),
  );
}

const here = path.dirname(fileURLToPath(import.meta.url));
for (const theme of ['light', 'dark']) {
  const svg = await satori(banner(THEMES[theme]), { width: W, height: H, fonts });
  const file = path.join(here, `banner-${theme}.svg`);
  fs.writeFileSync(file, svg);
  console.log(`assets/banner-${theme}.svg ${(svg.length / 1024).toFixed(0)} KB`);
}
