#!/usr/bin/env node
// Stamps the release version into every local asset URL, so a release always
// loads one consistent set of files. Without it, a stale cache (browser, old
// service worker or reverse proxy) can serve an old module next to new ones,
// which breaks ES module imports ("does not provide an export named ...").
//
// Usage: node scripts/stamp-version.mjs 0.4.2
// tests/test-assets.mjs fails when any URL is missing the current version.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node scripts/stamp-version.mjs <major.minor.patch>');
  process.exit(2);
}
const root = new URL('..', import.meta.url).pathname;
const v = `?v=${version}`;
const strip = '(?:\\?v=[0-9A-Za-z.-]+)?';

async function rewrite(file, edits) {
  const path = join(root, file);
  const before = await readFile(path, 'utf8');
  let after = before;
  for (const [pattern, replacement] of edits) after = after.replace(pattern, replacement);
  if (after !== before) await writeFile(path, after);
  return after !== before;
}

const changed = [];
for (const name of (await readdir(join(root, 'js'))).filter(n => n.endsWith('.js'))) {
  if (await rewrite(`js/${name}`, [[new RegExp(`(from\\s+'(?:\\.\\.?/)[^'?]+\\.js)${strip}'`, 'g'), `$1${v}'`]])) changed.push(`js/${name}`);
}
if (await rewrite('index.html', [
  [new RegExp(`(href="css/meiku\\.css)${strip}"`), `$1${v}"`],
  [new RegExp(`(src="js/boot\\.js)${strip}"`), `$1${v}"`],
  [new RegExp(`(src="js/app\\.js)${strip}"`), `$1${v}"`]
])) changed.push('index.html');
if (await rewrite('css/meiku.css', [[new RegExp(`(@import url\\("\\.\\./design-system/components\\.css)${strip}"\\)`), `$1${v}")`]])) changed.push('css/meiku.css');
if (await rewrite('sw.js', [
  [/const CACHE_NAME = 'meiku-static-v[^']+';/, `const CACHE_NAME = 'meiku-static-v${version}';`],
  [/const ASSET_VERSION = '[^']+';/, `const ASSET_VERSION = '${version}';`]
])) changed.push('sw.js');
console.log(changed.length ? `Stamped ${version} into: ${changed.join(', ')}` : `Already at ${version}.`);
