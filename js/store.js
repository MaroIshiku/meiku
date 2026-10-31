const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MIN_SETUP_SECRET_LENGTH = 32;
const MIN_TOKEN_LENGTH = 64;
const TOKEN_RE = /^[A-Za-z0-9+/=._:-]+$/;
const SESSION_SECRET_KEY = 'meiku.writeSecret';
const LEGACY_LOCAL_SECRET_KEY = 'dv2.sharedSecret';
const PLACEHOLDER_SECRETS = new Set([
  'change_me',
  'changeme',
  'replace-with-a-long-random-secret',
  'replace-with-at-least-32-random-characters'
]);

export class VersionConflictError extends Error {
  constructor(current) {
    super('The vault was changed on another device. Reload to get the latest version before saving again.');
    this.name = 'VersionConflictError';
    this.current = current || null;
  }
}

export const Store = {
  async loadData() {
    try {
      const response = await fetch('api/data', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Token load HTTP ${response.status}`);
      const data = await response.json();
      return { token: data.token || '', updated: data.updated || null, revision: normalizeRevision(data.revision) };
    } catch (error) {
      console.warn(error);
      return { token: '', updated: null, revision: null, offlineError: true };
    }
  },

  /** Moves a plaintext write secret from old releases out of persistent storage. */
  migrateLegacySecret() {
    const legacyValue = localStorage.getItem(LEGACY_LOCAL_SECRET_KEY) || '';
    localStorage.removeItem(LEGACY_LOCAL_SECRET_KEY);
    if (!legacyValue) return false;
    Store.setSecret(legacyValue);
    return true;
  },

  getSecret() { return sessionStorage.getItem(SESSION_SECRET_KEY) || ''; },
  setSecret(secret) {
    const value = String(secret || '').trim();
    if (value.length < MIN_SETUP_SECRET_LENGTH || PLACEHOLDER_SECRETS.has(value.toLowerCase())) {
      throw new Error(`Server secret must contain at least ${MIN_SETUP_SECRET_LENGTH} characters and must not be a placeholder.`);
    }
    sessionStorage.setItem(SESSION_SECRET_KEY, value);
  },
  clearSecret() {
    sessionStorage.removeItem(SESSION_SECRET_KEY);
    localStorage.removeItem(LEGACY_LOCAL_SECRET_KEY);
  },

  /**
   * Stores a token. expectedRevision is the revision the client last loaded;
   * the server rejects the write with 409 when another device saved meanwhile.
   */
  async saveToken(token, expectedRevision) {
    const secret = Store.getSecret();
    if (!secret) throw new Error('Server secret is missing. Open settings and save it.');
    if (!isValidToken(token)) throw new Error('Token is missing or invalid.');
    const body = { token };
    if (expectedRevision !== undefined) body.expectedRevision = normalizeRevision(expectedRevision);
    const response = await fetch('api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': secret },
      cache: 'no-store',
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (response.status === 409) throw new VersionConflictError({ updated: data.updated || null, revision: normalizeRevision(data.revision) });
    if (!response.ok || data.ok === false) throw new Error(data.error || `Save failed (${response.status}).`);
    return { token, updated: data.updated || new Date().toISOString(), revision: normalizeRevision(data.revision) };
  },

  exportToken(dataState) {
    const payload = JSON.stringify({ token: dataState.token, updated: dataState.updated }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meiku-token-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  importToken(file) {
    return new Promise((resolve, reject) => {
      if (!file || file.size > MAX_IMPORT_BYTES) {
        reject(new Error('Token file is too large or invalid.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('File could not be read.'));
      reader.onload = () => {
        try { resolve(parseImport(String(reader.result))); } catch (error) { reject(error); }
      };
      reader.readAsText(file);
    });
  }
};

export function parseImport(text) {
  const parsed = JSON.parse(text);
  const token = String(parsed?.token || '');
  if (!isValidToken(token)) throw new Error('Import does not contain a valid token.');
  return { token, updated: parsed.updated || null };
}

export function isValidToken(token) {
  return typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH && TOKEN_RE.test(token);
}

function normalizeRevision(value) {
  if (value === null || value === undefined || value === '') return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}
