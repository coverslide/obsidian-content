import { readFile, writeFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path) throw new Error('usage: patch-uzdoom-loader.mjs <uzdoom-loader.js>');

let source = await readFile(path, 'utf8');
const patches = [
  [
    'const out = { iwad: null, files: [], argv: [], nomelt: false };',
    'const out = { iwad: null, files: [], argv: [], nomelt: false, modURL: null };',
  ],
  [
    '    const fileStr = params.get(\'file\');',
    `    const modURL = params.get('modurl');
    // Only fetch this app's own completed-job download route.
    if (modURL && /^\\/api\\/jobs\\/\\d+\\/download$/.test(modURL)) out.modURL = modURL;
    const fileStr = params.get('file');`,
  ],
  [
    '      await resolveSideloadedIwad();',
    `      await resolveSideloadedIwad();
      if (launcherArgs.modURL) {
        const generatedWad = await fetchWithProgress(launcherArgs.modURL);
        state.mods.push({ name: 'obsidian-generated.wad', data: generatedWad });
      }`,
  ],
];

for (const [before, after] of patches) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`expected one UZDoom loader patch anchor, found ${count}: ${before}`);
  source = source.replace(before, after);
}

await writeFile(path, source);
