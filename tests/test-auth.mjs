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
const c = await import(cryptoUrl);
const authSource = (await readFile(new URL('../js/auth.js', import.meta.url), 'utf8'))
  .replace(/from '\.\/crypto\.js(?:\?v=[^']*)?'/, `from '${cryptoUrl}'`);
const { Auth } = await import(`data:text/javascript;base64,${Buffer.from(authSource).toString('base64')}`);

const writeSecret = 'write-value-with-at-least-32-characters';
const session = await c.createVault('master password');
const token = await c.sealVault(session, { n: 'Test' });

await assert.rejects(Auth.savePin('1234', session), /exactly 6 digits/);
await assert.rejects(Auth.savePin('123456', null), /not unlocked/);

// Current format: wraps the data key, never the master password.
await Auth.savePin('123456', session, writeSecret);
assert.equal(Auth.hasPin(), true);
assert.ok(!values.get('meiku.pin').includes('master password'));
const credentials = await Auth.credentialsFromPin('123456');
assert.equal(credentials.kind, 'key');
assert.equal(credentials.writeSecret, writeSecret);
assert.equal(credentials.keyId, c.tokenKeyId(token));
assert.equal(JSON.stringify(credentials).includes('master password'), false);
assert.deepEqual((await c.openVaultWithKey(token, credentials.dataKeyRaw)).data, { n: 'Test' });
await assert.rejects(Auth.credentialsFromPin('000000'));
await assert.rejects(Auth.credentialsFromPin('12'), /4-6 digits/);

// Legacy blob with master password keeps working and is detected as legacy.
Auth.clearPin();
assert.equal(Auth.hasPin(), false);
values.set('dv2.pinWrappedPassword', await c.encryptStringWithPin(JSON.stringify({ v: 1, masterPassword: 'master password', writeSecret }), '1234'));
assert.equal(Auth.hasPin(), true);
assert.equal(Auth.isLegacyPinFormat(), true);
assert.deepEqual(await Auth.credentialsFromPin('1234'), { kind: 'password', masterPassword: 'master password', writeSecret });

// Oldest blob: the plaintext is the password itself.
values.set('dv2.pinWrappedPassword', await c.encryptStringWithPin('plain legacy password', '4321'));
assert.deepEqual(await Auth.credentialsFromPin('4321'), { kind: 'password', masterPassword: 'plain legacy password', writeSecret: '' });

// Saving a new PIN replaces the legacy blob.
await Auth.savePin('654321', session, writeSecret);
assert.equal(values.has('dv2.pinWrappedPassword'), false);
assert.equal(Auth.isLegacyPinFormat(), false);

localStorage.setItem('dv2.passkeyMeta', '{}');
localStorage.setItem('dv2.passkeyWrappedPassword', '{}');
assert.equal(Auth.clearDeprecatedPasskey(), true);
assert.equal(localStorage.getItem('dv2.passkeyMeta'), null);
assert.equal(localStorage.getItem('dv2.passkeyWrappedPassword'), null);

Auth.clearPin();
assert.equal(Auth.hasPin(), false);

console.log('PIN authentication tests passed');
