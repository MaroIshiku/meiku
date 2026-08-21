import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key)
};
globalThis.addEventListener = () => {};

const cryptoSource = await readFile(new URL('../js/crypto.js', import.meta.url), 'utf8');
const cryptoUrl = `data:text/javascript;base64,${Buffer.from(cryptoSource).toString('base64')}`;
const authSource = (await readFile(new URL('../js/auth.js', import.meta.url), 'utf8'))
  .replace("from './crypto.js'", `from '${cryptoUrl}'`);
const { Auth } = await import(`data:text/javascript;base64,${Buffer.from(authSource).toString('base64')}`);

await assert.rejects(Auth.savePin('1234', 'master password'), /exactly 6 digits/);

await Auth.savePin('123456', 'master password', 'write-value-with-at-least-32-characters');
assert.equal(Auth.hasPin(), true);
const credentials = await Auth.credentialsFromPin('123456');
assert.deepEqual(credentials, {
  masterPassword: 'master password',
  writeSecret: 'write-value-with-at-least-32-characters',
  legacy: false
});

localStorage.setItem('dv2.passkeyMeta', '{}');
localStorage.setItem('dv2.passkeyWrappedPassword', '{}');
assert.equal(Auth.clearDeprecatedPasskey(), true);
assert.equal(localStorage.getItem('dv2.passkeyMeta'), null);
assert.equal(localStorage.getItem('dv2.passkeyWrappedPassword'), null);

Auth.clearPin();
assert.equal(Auth.hasPin(), false);

console.log('PIN authentication tests passed');
