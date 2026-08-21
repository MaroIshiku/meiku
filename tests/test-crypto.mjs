import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/crypto.js', import.meta.url), 'utf8');
const cryptoModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const password = 'test-master-password';
const payload = { name: 'Meiku', private: true };
const token = await cryptoModule.encryptJson(payload, password);
assert.deepEqual(await cryptoModule.decryptJson(token, password), payload);

function tokenWithIterations(iterations) {
  const bytes = Buffer.alloc(50);
  bytes[0] = 2;
  bytes.writeUInt32BE(iterations, 1);
  return bytes.toString('base64');
}

await assert.rejects(
  cryptoModule.decryptJson(tokenWithIterations(1), password),
  /outside the supported range/
);
await assert.rejects(
  cryptoModule.decryptJson(tokenWithIterations(1_000_001), password),
  /outside the supported range/
);

await assert.rejects(
  cryptoModule.decryptStringWithPin(JSON.stringify({
    v: 2,
    kdf: 'PBKDF2-SHA256',
    iter: 1,
    salt: Buffer.alloc(16).toString('base64'),
    iv: Buffer.alloc(12).toString('base64'),
    ct: Buffer.alloc(16).toString('base64')
  }), '1234'),
  /outside the supported range/
);

const pinBlob = await cryptoModule.encryptStringWithPin('local credentials', '123456');
assert.equal(JSON.parse(pinBlob).iter, 1_000_000);
assert.equal(await cryptoModule.decryptStringWithPin(pinBlob, '123456'), 'local credentials');

console.log('crypto security tests passed');
