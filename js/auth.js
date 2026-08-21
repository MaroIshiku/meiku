import { decryptStringWithPin, encryptStringWithPin } from './crypto.js';

const PIN_KEY = 'dv2.pinWrappedPassword';
const PASSKEY_META_KEY = 'dv2.passkeyMeta';
const PASSKEY_BLOB_KEY = 'dv2.passkeyWrappedPassword';

export const Auth = {
  hasPin() { return Boolean(localStorage.getItem(PIN_KEY)); },
  async savePin(pin, masterPassword, writeSecret = '') {
    assertNewPin(pin);
    const credentials = JSON.stringify({ v: 1, masterPassword, writeSecret });
    localStorage.setItem(PIN_KEY, await encryptStringWithPin(credentials, pin));
  },
  async credentialsFromPin(pin) {
    assertExistingPin(pin);
    const blob = localStorage.getItem(PIN_KEY);
    if (!blob) throw new Error('No PIN is set up.');
    const plaintext = await decryptStringWithPin(blob, pin);
    try {
      const credentials = JSON.parse(plaintext);
      if (credentials?.v !== 1 || typeof credentials.masterPassword !== 'string') throw new Error();
      return {
        masterPassword: credentials.masterPassword,
        writeSecret: typeof credentials.writeSecret === 'string' ? credentials.writeSecret : '',
        legacy: false
      };
    } catch {
      return { masterPassword: plaintext, writeSecret: '', legacy: true };
    }
  },
  clearPin() { localStorage.removeItem(PIN_KEY); },
  clearDeprecatedPasskey() {
    const removed = Boolean(localStorage.getItem(PASSKEY_META_KEY) || localStorage.getItem(PASSKEY_BLOB_KEY));
    localStorage.removeItem(PASSKEY_META_KEY);
    localStorage.removeItem(PASSKEY_BLOB_KEY);
    return removed;
  },

  startAutoLock(onLock) {
    let timer = 0;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(onLock, 5 * 60 * 1000);
    };
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(event => addEventListener(event, reset, { passive: true }));
    reset();
    return () => clearTimeout(timer);
  }
};

function assertExistingPin(pin) {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must have 4-6 digits.');
}

function assertNewPin(pin) {
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN must have exactly 6 digits.');
}
