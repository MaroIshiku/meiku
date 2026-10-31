import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/crypto.js', import.meta.url), 'utf8');
const c = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const password = 'test-master-password';
const payload = { n: 'Meiku Test', m: '+49 151 0000000' };

// v3 round trip with key wrapping.
const session = await c.createVault(password);
assert.equal(session.dataKeyRaw.length, 32);
const token = await c.sealVault(session, payload);
assert.equal(c.tokenVersion(token), 3);
const bytes = Buffer.from(token, 'base64');
assert.equal(bytes.readUInt32BE(1), c.PASSWORD_ITERATIONS);
assert.ok(c.PASSWORD_ITERATIONS >= 600000);
const opened = await c.openVault(token, password);
assert.deepEqual(opened.data, payload);
assert.equal(opened.upgraded, false);
assert.equal(opened.session.keyId, c.tokenKeyId(token));
assert.deepEqual([...opened.session.dataKeyRaw], [...session.dataKeyRaw]);

// Re-sealing keeps the same wrapped key header, so the PIN key id stays valid.
const resealed = await c.sealVault(opened.session, { ...payload, n: 'Changed' });
assert.equal(c.tokenKeyId(resealed), c.tokenKeyId(token));
assert.equal((await c.openVault(resealed, password)).data.n, 'Changed');

// Wrong password fails.
await assert.rejects(c.openVault(token, 'wrong-password'));

// Direct key unlock (PIN path) works and rejects a wrong key.
assert.deepEqual((await c.openVaultWithKey(token, session.dataKeyRaw)).data, payload);
await assert.rejects(c.openVaultWithKey(token, new Uint8Array(32)));

// Header tampering is detected: change the iteration count.
const tampered = Buffer.from(bytes);
tampered.writeUInt32BE(200000, 1);
await assert.rejects(c.openVault(tampered.toString('base64'), password));
// Payload tampering is detected even with the right key.
const flipped = Buffer.from(bytes);
flipped[flipped.length - 1] ^= 1;
await assert.rejects(c.openVaultWithKey(flipped.toString('base64'), session.dataKeyRaw));

// Legacy v2 tokens still open and are flagged for upgrade without data loss.
const legacy = await c.encryptLegacyJson(payload, password);
assert.equal(c.tokenVersion(legacy), 2);
const migrated = await c.openVault(legacy, password);
assert.deepEqual(migrated.data, payload);
assert.equal(migrated.upgraded, true);
const upgradedToken = await c.sealVault(migrated.session, migrated.data);
assert.equal(c.tokenVersion(upgradedToken), 3);
assert.deepEqual((await c.openVault(upgradedToken, password)).data, payload);
await assert.rejects(c.openVaultWithKey(legacy, migrated.session.dataKeyRaw), /upgraded/);

// Iteration bounds for legacy and current headers.
function legacyTokenWithIterations(iterations) {
  const out = Buffer.alloc(50);
  out[0] = 2;
  out.writeUInt32BE(iterations, 1);
  return out.toString('base64');
}
await assert.rejects(c.openVault(legacyTokenWithIterations(1), password), /outside the supported range/);
await assert.rejects(c.openVault(legacyTokenWithIterations(1_000_001), password), /outside the supported range/);
await assert.rejects(c.createVault(password, 10), /outside the supported range/);
await assert.rejects(c.openVault(Buffer.from([9, 0, 0, 0, 0, 1, 2, 3]).toString('base64'), password), /Unsupported token version/);

// PIN blobs: current format and legacy v2 blob format.
await assert.rejects(
  c.decryptStringWithPin(JSON.stringify({
    v: 2,
    kdf: 'PBKDF2-SHA256',
    iter: 1,
    salt: Buffer.alloc(16).toString('base64'),
    iv: Buffer.alloc(12).toString('base64'),
    ct: Buffer.alloc(16).toString('base64')
  }), '1234'),
  /outside the supported range/
);
const pinBlob = await c.encryptStringWithPin('local credentials', '123456');
assert.equal(JSON.parse(pinBlob).iter, 1_000_000);
assert.equal(JSON.parse(pinBlob).v, 3);
assert.equal(await c.decryptStringWithPin(pinBlob, '123456'), 'local credentials');
await assert.rejects(c.decryptStringWithPin(pinBlob, '654321'));
const legacyBlob = JSON.stringify({ ...JSON.parse(pinBlob), v: 2 });
assert.equal(await c.decryptStringWithPin(legacyBlob, '123456'), 'local credentials');

console.log('crypto security tests passed');
