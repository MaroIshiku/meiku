// Meiku client-side vault cryptography.
//
// Vault token v3 (current, key wrapping):
//   [0]        version = 3
//   [1..4]     PBKDF2-SHA-256 iterations (uint32 big endian)
//   [5..20]    password salt (16 bytes)
//   [21..32]   IV for the wrapped data key (12 bytes)
//   [33..80]   AES-GCM wrapped 256-bit data key (32 bytes + 16 byte tag)
//   [81..92]   IV for the vault payload (12 bytes)
//   [93..]     AES-GCM ciphertext of the JSON payload
// The wrapped key is authenticated with bytes [0..20] as additional data and
// the payload is authenticated with the complete 81-byte key header, so the
// iteration count, salt and wrapped key cannot be swapped or downgraded.
//
// Vault token v2 (legacy, read-only): [2][iter][salt16][iv12][ciphertext], the
// payload key is derived directly from the master password. v2 tokens are
// decrypted and transparently re-sealed as v3 on the next save.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const VAULT_VERSION = 3;
const LEGACY_VAULT_VERSION = 2;
export const PASSWORD_ITERATIONS = 600000;
export const PIN_ITERATIONS = 1000000;
const LEGACY_DEFAULT_ITERATIONS = 250000;
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 1000000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const DATA_KEY_BYTES = 32;
const TAG_BYTES = 16;
const KDF_HEADER_BYTES = 1 + 4 + SALT_BYTES; // 21
const KEY_HEADER_BYTES = KDF_HEADER_BYTES + IV_BYTES + DATA_KEY_BYTES + TAG_BYTES; // 81
const PIN_BLOB_VERSION = 3;
const LEGACY_PIN_BLOB_VERSION = 2;

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function writeUint32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function readUint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function validatedIterations(value) {
  const iterations = Number(value);
  if (!Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('Encryption parameters are outside the supported range.');
  }
  return iterations;
}

async function deriveAesKey(secret, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function importDataKey(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== DATA_KEY_BYTES) throw new Error('Vault key is invalid.');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Returns the vault format version of a token, or 0 when it cannot be read. */
export function tokenVersion(token) {
  try {
    const bytes = base64ToBytes(String(token || '').slice(0, 8));
    return bytes[0] || 0;
  } catch {
    return 0;
  }
}

/** Stable, non-secret identifier of the wrapped data key (its password salt). */
export function tokenKeyId(token) {
  const bytes = base64ToBytes(token);
  if (bytes[0] !== VAULT_VERSION || bytes.length < KEY_HEADER_BYTES) return '';
  return bytesToBase64(bytes.slice(5, 5 + SALT_BYTES));
}

async function sessionFromRawKey(dataKeyRaw, header) {
  return {
    header,
    dataKeyRaw,
    dataKey: await importDataKey(dataKeyRaw),
    keyId: bytesToBase64(header.slice(5, 5 + SALT_BYTES))
  };
}

/** Creates a new vault session with a fresh random data key wrapped by the password. */
export async function createVault(password, iterations = PASSWORD_ITERATIONS) {
  const checkedIterations = validatedIterations(iterations);
  const salt = randomBytes(SALT_BYTES);
  const wrapIv = randomBytes(IV_BYTES);
  const kdfHeader = concatBytes(new Uint8Array([VAULT_VERSION]), writeUint32(checkedIterations), salt);
  const kek = await deriveAesKey(password, salt, checkedIterations);
  const dataKeyRaw = randomBytes(DATA_KEY_BYTES);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv, additionalData: kdfHeader }, kek, dataKeyRaw));
  return sessionFromRawKey(dataKeyRaw, concatBytes(kdfHeader, wrapIv, wrapped));
}

/** Encrypts the vault payload with the session data key and returns a v3 token. */
export async function sealVault(session, payload) {
  const iv = randomBytes(IV_BYTES);
  const plaintext = enc.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: session.header }, session.dataKey, plaintext));
  return bytesToBase64(concatBytes(session.header, iv, ciphertext));
}

function parseV3(token) {
  const bytes = base64ToBytes(token);
  if (bytes.length < KEY_HEADER_BYTES + IV_BYTES + TAG_BYTES) throw new Error('Token is incomplete.');
  const header = bytes.slice(0, KEY_HEADER_BYTES);
  return {
    header,
    kdfHeader: header.slice(0, KDF_HEADER_BYTES),
    iterations: validatedIterations(readUint32(bytes, 1)),
    salt: header.slice(5, KDF_HEADER_BYTES),
    wrapIv: header.slice(KDF_HEADER_BYTES, KDF_HEADER_BYTES + IV_BYTES),
    wrapped: header.slice(KDF_HEADER_BYTES + IV_BYTES),
    iv: bytes.slice(KEY_HEADER_BYTES, KEY_HEADER_BYTES + IV_BYTES),
    ciphertext: bytes.slice(KEY_HEADER_BYTES + IV_BYTES)
  };
}

async function decryptV3Payload(parsed, session) {
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: parsed.iv, additionalData: parsed.header }, session.dataKey, parsed.ciphertext);
  return JSON.parse(dec.decode(plaintext));
}

/**
 * Opens a vault token with the master password.
 * Returns { session, data, upgraded } where upgraded=true means the token used
 * the legacy v2 format and must be re-sealed with the returned v3 session.
 */
export async function openVault(token, password) {
  if (!token) throw new Error('No token available.');
  const version = tokenVersion(token);
  if (version === LEGACY_VAULT_VERSION) {
    const data = await decryptLegacyJson(token, password);
    return { session: await createVault(password), data, upgraded: true };
  }
  if (version !== VAULT_VERSION) throw new Error(`Unsupported token version: ${version}`);
  const parsed = parseV3(token);
  const kek = await deriveAesKey(password, parsed.salt, parsed.iterations);
  const dataKeyRaw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: parsed.wrapIv, additionalData: parsed.kdfHeader }, kek, parsed.wrapped));
  const session = await sessionFromRawKey(dataKeyRaw, parsed.header);
  return { session, data: await decryptV3Payload(parsed, session), upgraded: false };
}

/** Opens a v3 vault token directly with an unwrapped data key (PIN quick unlock). */
export async function openVaultWithKey(token, dataKeyRaw) {
  if (tokenVersion(token) !== VAULT_VERSION) throw new Error('Vault must be upgraded before PIN unlock.');
  const parsed = parseV3(token);
  const session = await sessionFromRawKey(dataKeyRaw, parsed.header);
  return { session, data: await decryptV3Payload(parsed, session), upgraded: false };
}

/** Legacy v2 decryption. Kept so existing vaults open without re-entering data. */
export async function decryptLegacyJson(token, masterPassword) {
  if (!token) throw new Error('No token available.');
  const bytes = base64ToBytes(token);
  if (bytes.length < 1 + 4 + 16 + 12 + 17) throw new Error('Token is incomplete.');
  const version = bytes[0];
  if (version !== LEGACY_VAULT_VERSION) throw new Error(`Unsupported token version: ${version}`);
  const iterations = validatedIterations(readUint32(bytes, 1));
  const salt = bytes.slice(5, 21);
  const iv = bytes.slice(21, 33);
  const ciphertext = bytes.slice(33);
  const key = await deriveAesKey(masterPassword, salt, iterations);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(dec.decode(plaintext));
}

/** Legacy v2 encryption. Only used by tests to build compatibility fixtures. */
export async function encryptLegacyJson(payload, masterPassword) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveAesKey(masterPassword, salt, LEGACY_DEFAULT_ITERATIONS);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload))));
  return bytesToBase64(concatBytes(new Uint8Array([LEGACY_VAULT_VERSION]), writeUint32(LEGACY_DEFAULT_ITERATIONS), salt, iv, ciphertext));
}

export async function encryptStringWithPin(secret, pin) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(pin, salt, PIN_ITERATIONS);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret)));
  return JSON.stringify({ v: PIN_BLOB_VERSION, kdf: 'PBKDF2-SHA256', iter: PIN_ITERATIONS, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ct: bytesToBase64(ciphertext) });
}

export async function decryptStringWithPin(blob, pin) {
  const box = JSON.parse(blob);
  if (![PIN_BLOB_VERSION, LEGACY_PIN_BLOB_VERSION].includes(box.v) || box.kdf !== 'PBKDF2-SHA256') throw new Error('PIN blob format does not match.');
  const salt = base64ToBytes(box.salt);
  const iv = base64ToBytes(box.iv);
  const ciphertext = base64ToBytes(box.ct);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('PIN blob is incomplete.');
  const key = await deriveAesKey(pin, salt, validatedIterations(box.iter));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return dec.decode(plaintext);
}
