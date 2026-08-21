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

const source = await readFile(new URL('../js/store.js', import.meta.url), 'utf8');
const { Store } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

assert.throws(
  () => Store.setSecret('replace-with-at-least-32-random-characters'),
  /must not be a placeholder/
);
assert.throws(() => Store.setSecret('too-short'), /at least 32/);

const validSecret = 'client-secret-with-at-least-32-characters';
Store.setSecret(`  ${validSecret}  `);
assert.equal(Store.getSecret(), validSecret);
assert.equal(localStorage.getItem('dv2.sharedSecret'), null);

Store.clearSecret();
localStorage.setItem('dv2.sharedSecret', validSecret);
assert.equal(Store.migrateLegacySecret(), true);
assert.equal(Store.getSecret(), validSecret);
assert.equal(localStorage.getItem('dv2.sharedSecret'), null);

Store.clearSecret();
assert.equal(Store.getSecret(), '');

console.log('store security tests passed');
