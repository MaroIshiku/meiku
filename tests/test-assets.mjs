// Every local module, script and stylesheet URL must carry the release version
// from sw.js, so a release can never load a mix of old and new files from a
// stale cache. Fix failures with: node scripts/stamp-version.mjs <version>
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const sw = await read('sw.js');
const version = sw.match(/const ASSET_VERSION = '(\d+\.\d+\.\d+)';/)?.[1];
assert.ok(version, 'sw.js declares ASSET_VERSION');
assert.match(sw, new RegExp(`const CACHE_NAME = 'meiku-static-v${version.replace(/\./g, '\\.')}';`));

const problems = [];
for (const name of (await readdir(new URL('js/', root))).filter(n => n.endsWith('.js'))) {
  const source = await read(`js/${name}`);
  for (const [, spec] of source.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
    if (!spec.endsWith(`?v=${version}`)) problems.push(`js/${name}: ${spec}`);
  }
  if (/import\(\s*['"`]\.{1,2}\//.test(source)) problems.push(`js/${name}: dynamic local import without version check`);
}
const html = await read('index.html');
for (const asset of ['css/meiku.css', 'js/boot.js', 'js/app.js']) {
  if (!html.includes(`"${asset}?v=${version}"`)) problems.push(`index.html: ${asset}`);
}
const css = await read('css/meiku.css');
if (!css.includes(`@import url("../design-system/components.css?v=${version}")`)) problems.push('css/meiku.css: components.css import');
assert.deepEqual(problems, [], `unversioned or outdated asset URLs (expected ?v=${version})`);

// The service worker precaches every module in js/.
const modules = (await readdir(new URL('js/', root))).filter(n => n.endsWith('.js')).map(n => n.replace(/\.js$/, '')).sort();
const listed = [...sw.matchAll(/'([a-z]+)'/g)].map(m => m[1]).filter(name => modules.includes(name)).sort();
assert.deepEqual([...new Set(listed)], modules, 'sw.js precaches all modules in js/');

console.log(`asset version tests passed (v${version})`);
