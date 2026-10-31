import { base64ToBytes, bytesToBase64, decryptStringWithPin, encryptStringWithPin } from './crypto.js?v=0.4.2';

// PIN quick unlock stores one AES-GCM blob (PBKDF2-SHA-256, 1,000,000 iterations).
// Current blobs wrap the vault data key and the server write secret, never the
// master password. Legacy blobs (master password inside) remain readable so an
// existing PIN keeps working; they are replaced after the next successful unlock.
const PIN_KEY = 'meiku.pin';
const LEGACY_PIN_KEY = 'dv2.pinWrappedPassword';
const LEGACY_PASSKEY_KEYS = ['dv2.passkeyMeta', 'dv2.passkeyWrappedPassword'];
const AUTO_LOCK_MS = 5 * 60 * 1000;

let autoLockTimer = 0;
let autoLockHandler = null;

export const Auth = {
  hasPin() { return Boolean(readBlob()); },

  async savePin(pin, session, writeSecret = '') {
    assertNewPin(pin);
    if (!session?.dataKeyRaw || !session.keyId) throw new Error('Vault is not unlocked.');
    const credentials = JSON.stringify({ v: 2, dataKey: bytesToBase64(session.dataKeyRaw), keyId: session.keyId, writeSecret: String(writeSecret || '') });
    localStorage.setItem(PIN_KEY, await encryptStringWithPin(credentials, pin));
    localStorage.removeItem(LEGACY_PIN_KEY);
  },

  /**
   * Returns one of:
   *   { kind: 'key', dataKeyRaw, keyId, writeSecret }
   *   { kind: 'password', masterPassword, writeSecret }  (legacy blob)
   */
  async credentialsFromPin(pin) {
    assertExistingPin(pin);
    const blob = readBlob();
    if (!blob) throw new Error('No PIN is set up.');
    const plaintext = await decryptStringWithPin(blob, pin);
    let credentials;
    try { credentials = JSON.parse(plaintext); } catch { credentials = null; }
    if (credentials?.v === 2 && typeof credentials.dataKey === 'string') {
      return {
        kind: 'key',
        dataKeyRaw: base64ToBytes(credentials.dataKey),
        keyId: String(credentials.keyId || ''),
        writeSecret: typeof credentials.writeSecret === 'string' ? credentials.writeSecret : ''
      };
    }
    if (credentials?.v === 1 && typeof credentials.masterPassword === 'string') {
      return { kind: 'password', masterPassword: credentials.masterPassword, writeSecret: typeof credentials.writeSecret === 'string' ? credentials.writeSecret : '' };
    }
    return { kind: 'password', masterPassword: plaintext, writeSecret: '' };
  },

  isLegacyPinFormat() { return !localStorage.getItem(PIN_KEY) && Boolean(localStorage.getItem(LEGACY_PIN_KEY)); },

  clearPin() {
    localStorage.removeItem(PIN_KEY);
    localStorage.removeItem(LEGACY_PIN_KEY);
  },

  clearDeprecatedPasskey() {
    const removed = LEGACY_PASSKEY_KEYS.some(key => localStorage.getItem(key));
    LEGACY_PASSKEY_KEYS.forEach(key => localStorage.removeItem(key));
    return removed;
  },

  startAutoLock(onLock) {
    autoLockHandler = onLock;
    if (!Auth.autoLockBound) {
      Auth.autoLockBound = true;
      ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(event => addEventListener(event, resetAutoLock, { passive: true }));
    }
    resetAutoLock();
    return () => { clearTimeout(autoLockTimer); autoLockHandler = null; };
  },
  autoLockBound: false
};

function resetAutoLock() {
  clearTimeout(autoLockTimer);
  if (autoLockHandler) autoLockTimer = setTimeout(autoLockHandler, AUTO_LOCK_MS);
}

function readBlob() {
  return localStorage.getItem(PIN_KEY) || localStorage.getItem(LEGACY_PIN_KEY) || '';
}

function assertExistingPin(pin) {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must have 4-6 digits.');
}

function assertNewPin(pin) {
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN must have exactly 6 digits.');
}
