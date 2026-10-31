import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const localValues = new Map();
const sessionValues = new Map();
globalThis.localStorage = {
  getItem: key => localValues.get(key) ?? null,
  setItem: (key, value) => localValues.set(key, String(value)),
  removeItem: key => localValues.delete(key)
};
globalThis.sessionStorage = {
  getItem: key => sessionValues.get(key) ?? null,
  setItem: (key, value) => sessionValues.set(key, String(value)),
  removeItem: key => sessionValues.delete(key)
};

const requests = [];
let nextResponse = null;
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, options });
  const { status, body } = nextResponse;
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
};

const source = await readFile(new URL('../js/store.js', import.meta.url), 'utf8');
const { Store, VersionConflictError, parseImport } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

assert.throws(() => Store.setSecret('replace-with-at-least-32-random-characters'), /must not be a placeholder/);
assert.throws(() => Store.setSecret('too-short'), /at least 32/);

const validSecret = 'client-secret-with-at-least-32-characters';
Store.setSecret(`  ${validSecret}  `);
assert.equal(Store.getSecret(), validSecret);
assert.equal(localStorage.getItem('dv2.sharedSecret'), null);

// Only the current endpoints are used.
nextResponse = { status: 200, body: { token: 'T'.repeat(64), updated: '2026-10-31T10:00:00Z', revision: 4 } };
assert.deepEqual(await Store.loadData(), { token: 'T'.repeat(64), updated: '2026-10-31T10:00:00Z', revision: 4 });
assert.equal(requests.at(-1).url, 'api/data');

nextResponse = { status: 200, body: { ok: true, updated: '2026-10-31T10:01:00Z', revision: 5 } };
const saved = await Store.saveToken('A'.repeat(64), 4);
assert.equal(saved.revision, 5);
assert.equal(requests.at(-1).url, 'api/token');
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { token: 'A'.repeat(64), expectedRevision: 4 });
assert.equal(requests.at(-1).options.headers['X-Auth-Token'], validSecret);

// A conflict surfaces as VersionConflictError with the current server state.
nextResponse = { status: 409, body: { ok: false, code: 'VERSION_CONFLICT', revision: 7, updated: 'x' } };
await assert.rejects(Store.saveToken('A'.repeat(64), 4), error => error instanceof VersionConflictError && error.current.revision === 7);

// Offline load: expectedRevision null tells the server "no vault seen".
nextResponse = { status: 200, body: { ok: true, revision: 1 } };
await Store.saveToken('A'.repeat(64), null);
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { token: 'A'.repeat(64), expectedRevision: null });

await assert.rejects(Store.saveToken('short', 1), /invalid/);
assert.throws(() => parseImport('{"token":"bad"}'), /valid token/);
assert.equal(parseImport(JSON.stringify({ token: 'B'.repeat(64), updated: null })).token, 'B'.repeat(64));

Store.clearSecret();
localStorage.setItem('dv2.sharedSecret', validSecret);
assert.equal(Store.migrateLegacySecret(), true);
assert.equal(Store.getSecret(), validSecret);
assert.equal(localStorage.getItem('dv2.sharedSecret'), null);

Store.clearSecret();
assert.equal(Store.getSecret(), '');
await assert.rejects(Store.saveToken('A'.repeat(64), 1), /secret is missing/);

console.log('store security tests passed');
