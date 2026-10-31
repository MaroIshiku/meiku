// Meiku controller: start-up, unlock, migration, saving and locking.
// Rendering lives in cards.js (share cards), settings.js (sheets) and here
// (unlock and setup screens). Crypto, storage and QR logic are unchanged.
import { Auth } from './auth.js?v=0.4.2';
import { createCards } from './cards.js?v=0.4.2';
import { createVault, openVault, openVaultWithKey, sealVault, tokenKeyId, tokenVersion, VAULT_VERSION } from './crypto.js?v=0.4.2';
import { $, $$, Sheet, toast, vibrate } from './dom.js?v=0.4.2';
import { icon } from './icons.js?v=0.4.2';
import { FIELDS, firstName, LEGACY_AVATAR_KEY, normalizeData, readLegacyAvatar } from './profile.js?v=0.4.2';
import { isValidIban } from './qr.js?v=0.4.2';
import { bindStrength, checkNewPassword, collectForm, createSettings, MIN_NEW_PASSWORD_LENGTH, renderFields, strengthMeter } from './settings.js?v=0.4.2';
import { Store, timeoutSignal, VersionConflictError } from './store.js?v=0.4.2';
import { initPixelSoftUtilityTheme } from '../design-system/theme-controller.js?v=0.4.2';

const APP_ID = 'meiku';
const LOGIN_NAME_KEY = `${APP_ID}-login-name`;
const LEGACY_THEME_KEY = 'dv2.theme';
const LEGACY_MODE_KEY = 'dv2.mode';
const LEGACY_THEME_NAMES = { lavendel: 'lavender', teal: 'mint', wald: 'mint', ozean: 'sky', graphit: 'graphite' };
const LEGACY_MODE_NAMES = { auto: 'system' };

const state = {
  token: '', updated: null, revision: null, data: null, session: null, needsUpgrade: false,
  buildInfo: null
};

const ctx = {
  state,
  isValidIban,
  saveCurrentData,
  upgradeStoredVault,
  lockVault,
  signOut,
  showUnlock: mode => showUnlock(mode),
  openEditor: (step, firstRun, back) => settings.openEditor(step, firstRun, back)
};
const cards = createCards(ctx);
const settings = createSettings(ctx);
const pinPad = { value: '', busy: false };

init().catch(error => {
  console.error(error);
  window.__meikuFail?.(error);
});

async function init() {
  migrateLocalStorage();
  initPixelSoftUtilityTheme({ appId: APP_ID });
  Sheet.bind();
  cards.bind();
  bindGlobal();
  registerServiceWorker();
  state.buildInfo = (await Promise.all([loadBuildInfo(), loadVault()]))[0];
  window.__meikuReady?.();
}

/** Loads the encrypted vault. Setup is only offered when the server answered that no vault exists. */
async function loadVault() {
  const loaded = await Store.loadData();
  Object.assign(state, { token: loaded.token, updated: loaded.updated, revision: loaded.revision });
  if (loaded.offlineError) showOffline();
  else if (!loaded.token) showSetup();
  else showUnlock(Auth.hasPin() ? 'pin' : 'password');
}

function showOffline() {
  showAuthScreen('Server not reachable', 'Meiku could not load your vault.');
  $('#authBody').innerHTML = `
    <div class="psu-form-stack">
      <p class="meiku-banner" role="status">Check that this device is connected to the network that can reach your Meiku server, then try again.</p>
      <button class="psu-button psu-button--filled psu-button--full" type="button" id="retryLoad">Try again</button>
    </div>`;
  $('#retryLoad').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Connecting…';
    await loadVault();
  });
}

/** One-time clean-up of browser storage written by older releases. Never deletes vault data. */
function migrateLocalStorage() {
  try { Store.migrateLegacySecret(); } catch { Store.clearSecret(); }
  Auth.clearDeprecatedPasskey();
  const theme = localStorage.getItem(LEGACY_THEME_KEY);
  const mode = localStorage.getItem(LEGACY_MODE_KEY);
  if (theme && !localStorage.getItem(`${APP_ID}-theme`)) localStorage.setItem(`${APP_ID}-theme`, LEGACY_THEME_NAMES[theme] || theme);
  if (mode && !localStorage.getItem(`${APP_ID}-mode`)) localStorage.setItem(`${APP_ID}-mode`, LEGACY_MODE_NAMES[mode] || mode);
  localStorage.removeItem(LEGACY_THEME_KEY);
  localStorage.removeItem(LEGACY_MODE_KEY);
  for (const key of ['dv2.amount', 'dv2.purpose']) {
    const value = sessionStorage.getItem(key);
    const target = key.replace('dv2.', 'meiku.');
    if (value !== null && sessionStorage.getItem(target) === null) sessionStorage.setItem(target, value);
    sessionStorage.removeItem(key);
  }
  sessionStorage.removeItem('meiku.paymentMode');
}

/**
 * Service worker: network-first caching for offline use. The page is never
 * reloaded automatically; a new worker simply serves the next navigation.
 * (Reloading on controllerchange wiped the setup form on the first visit.)
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(console.warn);
}

function bindGlobal() {
  $('#settingsButton').addEventListener('click', () => settings.openSettings());
  $$('[data-logo]').forEach(img => img.addEventListener('error', () => img.closest('[data-logo-frame]')?.classList.add('psu-logo-missing')));
  document.addEventListener('keydown', event => {
    if (!$('#pinDots') || $('#authScreen').hidden) return;
    if (/^\d$/.test(event.key)) pinInput(event.key);
    else if (event.key === 'Backspace') pinInput('back');
    else if (event.key === 'Enter') pinInput('ok');
    else return;
    event.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
function showSetup() {
  showAuthScreen('Create your vault', 'Your profile is encrypted on this device before it is saved.');
  $('#authBody').innerHTML = `
    <form id="setupForm" class="psu-form-stack" novalidate>
      <div id="setupFields" class="psu-form-stack"></div>
      <input type="text" name="username" autocomplete="username" value="Meiku vault" class="psu-visually-hidden" tabindex="-1" aria-hidden="true">
      <label class="psu-field"><span class="psu-label">Master password</span><input class="psu-input" id="setupPassword" type="password" autocomplete="new-password" required></label>
      ${strengthMeter()}
      <label class="psu-field"><span class="psu-label">Repeat master password</span><input class="psu-input" id="setupPasswordConfirm" type="password" autocomplete="new-password" required></label>
      <p class="psu-password-requirements">At least ${MIN_NEW_PASSWORD_LENGTH} characters. It cannot be recovered, so keep it somewhere safe.</p>
      <label class="psu-field"><span class="psu-label">Server secret</span><input class="psu-input" id="setupSecret" type="password" autocomplete="off" spellcheck="false" required>
        <small class="meiku-help">The value of <code>ISHIKU_SETUP_SECRET</code> from your server configuration.</small></label>
      <p class="psu-field-error" id="setupError" role="alert" hidden></p>
      <button class="psu-button psu-button--filled psu-button--full" type="submit">Create vault</button>
    </form>`;
  renderFields($('#setupFields'), {}, [FIELDS[0]]);
  bindStrength($('#setupPassword'), $('.meiku-strength'));
  $('#setupForm').addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('#setupError');
    const show = message => { error.textContent = message; error.hidden = false; };
    const data = normalizeData(collectForm(event.currentTarget));
    if (!data.n) return show('Enter your name.');
    const password = $('#setupPassword').value;
    const problem = checkNewPassword(password, $('#setupPasswordConfirm').value);
    if (problem) return show(problem);
    const submit = $('#setupForm button[type="submit"]');
    submit.disabled = true;
    try {
      Store.setSecret($('#setupSecret').value);
      const session = await createVault(password);
      const token = await sealVault(session, data);
      const saved = await Store.saveToken(token, state.revision);
      Object.assign(state, { token: saved.token, updated: saved.updated, revision: saved.revision, data, session, needsUpgrade: false });
      rememberLoginName(data.n);
      showVault();
      settings.openEditor(0, true);
    } catch (err) {
      submit.disabled = false;
      show(err.message);
    }
  });
  $('[name="n"]')?.focus();
}

// ---------------------------------------------------------------------------
// Unlock (PIN pad or password)
// ---------------------------------------------------------------------------
function showUnlock(mode) {
  const name = firstName(localStorage.getItem(LOGIN_NAME_KEY) || '');
  showAuthScreen(name ? `Welcome back, ${name}` : 'Unlock Meiku', mode === 'pin' ? 'Enter your PIN' : 'Enter your master password');
  if (mode === 'pin') renderPinPad(); else renderPasswordForm();
}

function renderPasswordForm() {
  $('#authBody').innerHTML = `
    <form id="unlockForm" class="psu-form-stack" novalidate>
      <input type="text" name="username" autocomplete="username" value="Meiku vault" class="psu-visually-hidden" tabindex="-1" aria-hidden="true">
      <label class="psu-field"><span class="psu-label">Master password</span>
        <span class="meiku-password">
          <input class="psu-input" id="unlockPassword" type="password" autocomplete="current-password" required>
          <button class="psu-icon-button" type="button" id="togglePassword" aria-pressed="false" aria-label="Show password">${icon('sun')}</button>
        </span>
      </label>
      <p class="psu-field-error" id="unlockError" role="alert" hidden></p>
      <button class="psu-button psu-button--filled psu-button--full" type="submit">Unlock</button>
      ${Auth.hasPin() ? '<button class="psu-button psu-button--text psu-button--full" type="button" id="usePin">Use PIN instead</button>' : ''}
    </form>`;
  const input = $('#unlockPassword');
  $('#togglePassword').addEventListener('click', event => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-pressed', String(show));
    event.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  $('#usePin')?.addEventListener('click', () => showUnlock('pin'));
  $('#unlockForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('#unlockForm button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Unlocking…';
    const ok = await unlockWithPassword(input.value);
    if (!ok) {
      submit.disabled = false;
      submit.textContent = 'Unlock';
      const error = $('#unlockError');
      error.textContent = 'This password does not open the vault.';
      error.hidden = false;
      input.select();
    }
  });
  input.focus();
}

function renderPinPad() {
  pinPad.value = '';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
  $('#authBody').innerHTML = `
    <div class="meiku-pin" role="group" aria-label="PIN pad">
      <div class="meiku-pin__dots" id="pinDots" aria-hidden="true">${'<span></span>'.repeat(6)}</div>
      <p class="meiku-pin__status" id="pinStatus" role="status" aria-live="polite">0 of 6 digits</p>
      <div class="meiku-pin__grid">
        ${keys.map(key => key === 'back'
          ? `<button type="button" data-key="back" aria-label="Delete last digit">${icon('backspace')}</button>`
          : key === 'ok'
            ? `<button type="button" data-key="ok" aria-label="Unlock">${icon('check')}</button>`
            : `<button type="button" data-key="${key}">${key}</button>`).join('')}
      </div>
      <button class="psu-button psu-button--text psu-button--full" type="button" id="usePassword">Use password instead</button>
    </div>`;
  $('.meiku-pin__grid').addEventListener('click', event => {
    const key = event.target.closest('[data-key]')?.dataset.key;
    if (key) { vibrate(); pinInput(key); }
  });
  $('#usePassword').addEventListener('click', () => showUnlock('password'));
  $('.meiku-pin__grid button').focus();
  paintPin();
}

function paintPin(message = '') {
  $$('#pinDots span').forEach((dot, i) => dot.classList.toggle('is-filled', i < pinPad.value.length));
  $('#pinStatus').textContent = message || `${pinPad.value.length} of 6 digits`;
  $('#pinStatus').classList.toggle('is-error', Boolean(message));
}

async function pinInput(key) {
  if (pinPad.busy || !$('#pinDots')) return;
  if (/^\d$/.test(key) && pinPad.value.length < 6) pinPad.value += key;
  if (key === 'back') pinPad.value = pinPad.value.slice(0, -1);
  paintPin();
  // Six digits submit automatically; OK submits shorter legacy PINs.
  if (pinPad.value.length === 6 || (key === 'ok' && pinPad.value.length >= 4)) {
    const pin = pinPad.value;
    pinPad.busy = true;
    $('#pinStatus').textContent = 'Unlocking…';
    const result = await unlockWithPin(pin);
    pinPad.busy = false;
    if (result !== true && $('#pinDots')) {
      pinPad.value = '';
      paintPin(result || 'Wrong PIN. Try again.');
      const dots = $('#pinDots');
      dots.classList.remove('is-shaking');
      void dots.offsetWidth;
      dots.classList.add('is-shaking');
    }
  }
}

/** Returns true on success or an error message. */
async function unlockWithPin(pin) {
  let credentials;
  try { credentials = await Auth.credentialsFromPin(pin); }
  catch (error) { return error.name === 'OperationError' ? 'Wrong PIN. Try again.' : error.message; }
  if (credentials.writeSecret) {
    try { Store.setSecret(credentials.writeSecret); } catch {}
  }
  if (credentials.kind === 'password') {
    // Legacy PIN blob that still contains the master password.
    if (!await unlockWithPassword(credentials.masterPassword)) return 'The vault password changed. Use your password.';
    if (/^\d{6}$/.test(pin) && !state.needsUpgrade) {
      try { await Auth.savePin(pin, state.session, Store.getSecret()); } catch (error) { console.warn(error); }
    } else if (!/^\d{6}$/.test(pin)) {
      toast('Set a new 6-digit PIN in Settings to upgrade the local protection.');
    }
    return true;
  }
  if (credentials.keyId && tokenVersion(state.token) === VAULT_VERSION && credentials.keyId !== tokenKeyId(state.token)) {
    return 'The password was changed on another device. Use your password and set up the PIN again.';
  }
  try {
    await enterVault(await openVaultWithKey(state.token, credentials.dataKeyRaw));
    return true;
  } catch (error) {
    console.error(error);
    return 'PIN unlock failed. Use your password and set up the PIN again.';
  }
}

async function unlockWithPassword(password) {
  let opened;
  try { opened = await openVault(state.token, password); }
  catch (error) { console.warn(error); return false; }
  await enterVault(opened);
  return true;
}

async function enterVault({ session, data, upgraded }) {
  state.session = session;
  state.data = normalizeData(data);
  state.needsUpgrade = upgraded;
  const legacyAvatar = readLegacyAvatar();
  if (legacyAvatar && !state.data.av) state.data.av = legacyAvatar;
  rememberLoginName(state.data.n);
  showVault();
  await upgradeStoredVault();
}

/**
 * Re-seals a legacy v2 vault as v3 and moves a legacy plaintext profile picture
 * into the encrypted vault. Needs the server write secret; without it the
 * upgrade simply happens on the next regular save. No data is ever discarded.
 */
async function upgradeStoredVault() {
  if (!state.session || (!state.needsUpgrade && !readLegacyAvatar())) return;
  if (!Store.getSecret()) return;
  try {
    await saveCurrentData(state.data);
    toast('Vault upgraded to the current encryption format.');
  } catch (error) {
    console.warn(error);
    if (error instanceof VersionConflictError) toast(error.message);
  }
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------
function showAuthScreen(title, subtitle) {
  Sheet.close();
  cards.closeFullscreen();
  $('#vaultScreen').hidden = true;
  $('#authScreen').hidden = false;
  $('#authTitle').textContent = title;
  $('#authSubtitle').textContent = subtitle;
}

function showVault() {
  $('#authScreen').hidden = true;
  $('#authBody').replaceChildren();
  $('#vaultScreen').hidden = false;
  cards.renderDeck();
  Auth.startAutoLock(lockVault);
}

async function saveCurrentData(data, session = state.session) {
  if (!session) throw new Error('The vault is locked.');
  if (!Store.getSecret()) throw new Error('Enter the server secret to save changes.');
  const vaultData = normalizeData(data);
  const token = await sealVault(session, vaultData);
  const saved = await Store.saveToken(token, state.revision);
  Object.assign(state, { data: vaultData, session, token: saved.token, updated: saved.updated, revision: saved.revision, needsUpgrade: false });
  if (vaultData.av) localStorage.removeItem(LEGACY_AVATAR_KEY);
  rememberLoginName(vaultData.n);
  cards.renderDeck();
}

function lockVault() {
  state.session = null;
  state.data = null;
  location.reload();
}

function signOut() {
  Auth.clearPin();
  Auth.clearDeprecatedPasskey();
  Store.clearSecret();
  localStorage.removeItem(LOGIN_NAME_KEY);
  lockVault();
}

function rememberLoginName(name) {
  const value = String(name || '').trim();
  if (value) localStorage.setItem(LOGIN_NAME_KEY, value);
}

async function loadBuildInfo() {
  try {
    const response = await fetch(`build-info.json?v=${Date.now()}`, { cache: 'no-store', signal: timeoutSignal(6000) });
    if (!response.ok) throw new Error('Build info is not available.');
    return await response.json();
  } catch {
    return { buildSha: 'local', sourceRepo: 'MaroIshiku/meiku', sourceRef: 'local', builtAt: null };
  }
}
