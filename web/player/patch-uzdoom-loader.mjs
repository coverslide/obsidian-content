import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = process.argv[2];
if (!path) throw new Error('usage: patch-uzdoom-loader.mjs <uzdoom-loader.js>');

let source = await readFile(path, 'utf8');
const touchControls = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'touch-controls.js'), 'utf8');
const patches = [
  [
    'const out = { iwad: null, files: [], argv: [], nomelt: false };',
    'const out = { iwad: null, files: [], argv: [], nomelt: false, modURLs: [] };',
  ],
  [
    '    const fileStr = params.get(\'file\');',
    `    const modURLs = params.getAll('modurl');
    // Mods must come from this app's completed-job route or its read-only WAD mount.
    out.modURLs = modURLs.filter((url) => /^\\/api\\/jobs\\/\\d+\\/download$/.test(url) || /^\\/play\\/private\\/(?:available-wads\\/)?[A-Za-z0-9_.-]+\\.(?:wad|pk3)$/i.test(url));
    const fileStr = params.get('file');`,
  ],
  [
    '      await resolveSideloadedIwad();',
    `      await resolveSideloadedIwad();
      for (const modURL of launcherArgs.modURLs) {
        const modFile = await fetchWithProgress(modURL);
        const basename = modURL.split('/').pop().replace(/[^A-Za-z0-9_.-]/g, '_');
        state.mods.push({ name: basename || 'obsidian-addon.wad', data: modFile });
      }`,
  ],
  [
    `  const SIDELOADED_IWADS = {
    'doom.wad':  '/private/doom.wad',
    'doom2.wad': '/private/doom2.wad',
  };`,
    `  const SIDELOADED_IWADS = {
    'doom.wad': '/play/private/doom.wad',
    'doom2.wad': '/play/private/doom2.wad',
    'tnt.wad': '/play/private/tnt.wad',
    'plutonia.wad': '/play/private/plutonia.wad',
    'heretic.wad': '/play/private/heretic.wad',
    'hexen.wad': '/play/private/hexen.wad',
    'strife1.wad': '/play/private/strife1.wad',
    'hacx.wad': '/play/private/HACX.WAD',
    'chex3.wad': '/play/private/chex3.wad',
    'harm1.wad': '/play/private/harm1.wad',
  };`,
  ],
  [
    '  // ---- DOM helpers',
    `${touchControls}\n  const touchControls = window.ObsidianTouchControls.install({
    windowRef: window, documentRef: document, canvas: document.getElementById('canvas')
  });
  // ---- DOM helpers`,
  ],
  [
    '  function showExitPanel(code, reason) {',
    '  function showExitPanel(code, reason) {\n    touchControls?.hide();',
  ],
  [
    '      const announceReveal = () => {',
    '      const announceReveal = () => {\n        touchControls?.show();',
  ],
  [
    '    const c = $(\'canvas\');\n    if (document.fullscreenElement) {',
    '    const c = $(\'canvas\');\n    const target = touchControls ? document.documentElement : c;\n    if (document.fullscreenElement) {',
  ],
  [
    '    } else if (c.requestFullscreen) {\n      c.requestFullscreen({ navigationUI: \'hide\' }).catch((e) => {',
    '    } else if (target.requestFullscreen) {\n      target.requestFullscreen({ navigationUI: \'hide\' }).catch((e) => {',
  ],
];

for (const [before, after] of patches) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`expected one UZDoom loader patch anchor, found ${count}: ${before}`);
  source = source.replace(before, after);
}

await writeFile(path, source);
