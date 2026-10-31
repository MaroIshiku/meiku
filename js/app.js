import { Auth } from './auth.js';
import { createVault, openVault, openVaultWithKey, sealVault, tokenKeyId, tokenVersion, VAULT_VERSION } from './crypto.js';
import { formatIban, formatIbanRaw, isValidIban, normalizeAmount, QrPayload, renderQr } from './qr.js';
import { Store, VersionConflictError } from './store.js';

const FIELDS = [
  ['n', 'Full Name', 'text', true], ['m', 'Private Mobile', 'tel'], ['e1', 'Private Email', 'email'],
  ['s', 'Private Street / Number', 'text'], ['z', 'Private ZIP / City', 'text'],
  ['c', 'Company', 'text'], ['j', 'Position / Job Title', 'text'], ['cp', 'Office Phone', 'tel'], ['cm', 'Work Mobile', 'tel'], ['ce', 'Work Email', 'email'],
  ['w', 'Website', 'text'], ['cs', 'Business Street / Number', 'text'], ['cz', 'Business ZIP / City', 'text'], ['pp', 'PayPal Username', 'text'],
  ['ib', 'IBAN', 'text'], ['bic', 'BIC', 'text']
];
const SETUP_FIELDS = [['n', 'Full Name', 'text', true]];
const FIELD_LABELS = Object.fromEntries(FIELDS.map(([key, label]) => [key, label]));
const PROFILE_STEPS = [
  { id: 'privat', title: 'Private', hint: 'Name, private contact details and private address.', fields: ['n', 'm', 'e1', 's', 'z'] },
  { id: 'firma', title: 'Business', hint: 'Company, work contact details and separate business address.', fields: ['c', 'j', 'cp', 'cm', 'ce', 'w', 'cs', 'cz'] },
  { id: 'paypal', title: 'PayPal', hint: 'paypal.me username for payment links.', fields: ['pp'] },
  { id: 'bank', title: 'Bank', hint: 'SEPA details for GiroCode / EPC QR.', fields: ['ib', 'bic'] }
];
const AMOUNTS = ['5', '10', '20', '50', '100'];
const APP_NAME = 'Meiku';
const APP_TITLE = 'Meiku - Profile Share';
const APP_SUBTITLE = 'Profile Share';
const APP_ID = 'meiku';
const THEME_KEY = `${APP_ID}-theme`;
const MODE_KEY = `${APP_ID}-mode`;
const LOGIN_NAME_KEY = `${APP_ID}-login-name`;
const LEGACY_THEME_KEY = 'dv2.theme';
const LEGACY_MODE_KEY = 'dv2.mode';
const LEGACY_AVATAR_KEY = 'dv2.avatar';
const AMOUNT_KEY = 'meiku.amount';
const PURPOSE_KEY = 'meiku.purpose';
const PAYMENT_MODE_KEY = 'meiku.paymentMode';
const MIN_NEW_PASSWORD_LENGTH = 12;
const MAX_AVATAR_CHARS = 200000;
const AVATAR_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const THEMES = ['lavender', 'mint', 'sky', 'amber', 'rose', 'graphite'];
const MODES = ['system', 'light', 'dark'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const state = {
  token: '', updated: null, revision: null, data: null, session: null, needsUpgrade: false,
  activeTab: 'privat', paymentMode: sessionStorage.getItem(PAYMENT_MODE_KEY) || 'paypal',
  amount: sessionStorage.getItem(AMOUNT_KEY) || '', purpose: sessionStorage.getItem(PURPOSE_KEY) || '',
  wakeLock: null, buildInfo: null
};
const pinPad = { value: '', handler: null };

init();

async function init() {
  applyTheme();
  migrateLocalStorage();
  bindThemeMode();
  renderSetupFields($('#setupFields'), {}, SETUP_FIELDS);
  buildPinPad();
  bindAuth();
  bindGlobal();
  registerServiceWorker();
  state.buildInfo = await loadBuildInfo();
  const loaded = await Store.loadData();
  state.token = loaded.token;
  state.updated = loaded.updated;
  state.revision = loaded.revision;
  if (!loaded.token) showSetup(loaded.offlineError);
  else showLogin();
}

function bindThemeMode() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem(MODE_KEY) === 'system') applyTheme();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(registration => {
    activateWaitingWorker(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) activateWaitingWorker(worker);
      });
    });
  }).catch(console.warn);
}

function activateWaitingWorker(worker) {
  worker?.postMessage({ type: 'SKIP_WAITING' });
}

function bindAuth() {
  $('#passwordLogin').addEventListener('submit', async event => {
    event.preventDefault();
    await unlockWithPassword($('#masterPassword').value);
  });
  $('#setupForm').addEventListener('submit', async event => {
    event.preventDefault();
    const data = collectForm(event.currentTarget);
    if (!data.n) return toast('Name is required.');
    const password = $('#setupPassword').value;
    const passwordProblem = checkNewPassword(password, $('#setupPasswordConfirm').value);
    if (passwordProblem) return toast(passwordProblem);
    try {
      Store.setSecret($('#setupSecret').value);
      const session = await createVault(password);
      const vaultData = normalizeData(data);
      const token = await sealVault(session, vaultData);
      const saved = await Store.saveToken(token, state.revision);
      Object.assign(state, { token: saved.token, updated: saved.updated, revision: saved.revision, data: vaultData, session, needsUpgrade: false });
      rememberLoginName(state.data.n);
      showVault();
      openProfileProgress(0, true);
      toast('Vault saved.');
    } catch (error) { toast(error.message); }
  });
  $('#pinOpen').addEventListener('click', () => openPinPad(unlockWithPin));
}

async function unlockWithPin(pin) {
  let credentials;
  try { credentials = await Auth.credentialsFromPin(pin); }
  catch (error) {
    toast(error.name === 'OperationError' ? 'PIN is wrong.' : error.message);
    return;
  }
  if (credentials.writeSecret) {
    try { Store.setSecret(credentials.writeSecret); } catch {}
  }
  if (credentials.kind === 'password') {
    // Legacy PIN blob that still contains the master password.
    const unlocked = await unlockWithPassword(credentials.masterPassword);
    if (!unlocked) return;
    if (/^\d{6}$/.test(pin) && !state.needsUpgrade) {
      try { await Auth.savePin(pin, state.session, Store.getSecret()); } catch (error) { console.warn(error); }
    } else if (!/^\d{6}$/.test(pin)) {
      toast('PIN unlocked. Set a new 6-digit PIN in settings to upgrade local protection.');
    }
    return;
  }
  if (credentials.keyId && tokenVersion(state.token) === VAULT_VERSION && credentials.keyId !== tokenKeyId(state.token)) {
    toast('The vault password was changed on another device. Unlock with your password and set up the PIN again.');
    return;
  }
  try {
    const opened = await openVaultWithKey(state.token, credentials.dataKeyRaw);
    await enterVault(opened);
  } catch (error) {
    console.error(error);
    toast('PIN unlock failed. Unlock with your password and set up the PIN again.');
  }
}

function bindGlobal() {
  bindLogoFallback();
  $('#heroAvatarWrap')?.addEventListener('click', openSettings);
  $$('.psu-bottom-nav button').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  $('#qrClose').addEventListener('click', closeQrOverlay);
  $('#qrOverlay').addEventListener('click', e => { if (e.target.id === 'qrOverlay') closeQrOverlay(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeQrOverlay(); closeSheet(); } });
  $('#sheet')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });
}

function bindLogoFallback() {
  $$('.app-symbol img, .login-logo').forEach(img => {
    img.addEventListener('error', () => img.closest('.app-symbol')?.classList.add('logo-missing'));
  });
}

function showSetup(offlineError) {
  document.body.classList.remove('pin-active');
  document.body.dataset.authMode = 'setup';
  $('#authScreen').classList.remove('hidden');
  $('#vaultScreen').classList.add('hidden');
  $('#authTitle').textContent = 'Setup';
  $('#authHint').textContent = offlineError ? 'Token could not be loaded. You can still start locally and save later.' : 'Create the vault first. You can complete your profile step by step afterwards.';
  $('#setupForm').classList.remove('hidden');
  $('#passwordLogin').classList.add('hidden');
  $('#quickUnlock').classList.add('hidden');
}

function showLogin() {
  document.body.classList.remove('pin-active');
  document.body.dataset.authMode = 'login';
  $('#authScreen').classList.remove('hidden');
  $('#vaultScreen').classList.add('hidden');
  $('#authTitle').textContent = 'Meiku';
  $('#authHint').textContent = 'Profile Share';
  $('#loginUsername').value = loginDisplayName();
  $('#setupForm').classList.add('hidden');
  $('#passwordLogin').classList.remove('hidden');
  $('#quickUnlock').classList.toggle('hidden', !Auth.hasPin());
  $('#pinOpen').classList.toggle('hidden', !Auth.hasPin());
}

async function unlockWithPassword(password) {
  let opened;
  try {
    opened = await openVault(state.token, password);
  } catch (error) {
    console.error(error);
    toast('Password is wrong or the token is corrupted.');
    return false;
  }
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
  const legacyAvatar = readLegacyAvatar();
  if (!state.needsUpgrade && !legacyAvatar) return;
  if (!Store.getSecret()) return;
  try {
    await saveCurrentData(state.data, false);
    toast('Vault upgraded to the current encryption format.');
  } catch (error) {
    console.warn(error);
    if (error instanceof VersionConflictError) toast(error.message);
  }
}

function showVault() {
  delete document.body.dataset.authMode;
  $('#authScreen').classList.add('hidden');
  $('#vaultScreen').classList.remove('hidden');
  updateVaultHeader();
  setTab(state.activeTab);
  Auth.startAutoLock(lockVault);
}

function updateVaultHeader() {
  const heroName = $('#heroName');
  const updatedAt = $('#updatedAt');
  if (heroName) heroName.textContent = state.data.n || 'No Name';
  $('#heroInitials').textContent = initials(state.data.n);
  if (updatedAt) updatedAt.textContent = state.updated ? `Updated ${formatDate(state.updated)}` : 'Not saved yet';
  updateAvatar();
}

function setTab(tab) {
  if (tab === 'paypal' || tab === 'bank') {
    state.paymentMode = tab;
    tab = 'payment';
  }
  state.activeTab = tab;
  updateNavActive();
  renderTab();
  requestAnimationFrame(() => { $('#tabContent').scrollTop = 0; });
}

function updateNavActive() {
  $$('.psu-bottom-nav button').forEach(btn => {
    if (btn.dataset.tab === state.activeTab) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

function renderTab() {
  const root = $('#tabContent');
  if (!state.data) return;
  if (state.activeTab === 'firma') {
    renderContactTab(root, 'Company', 'Business contact details.', companyRows(), QrPayload.vcardCompany(state.data), 'Company vCard');
    return;
  }
  if (state.activeTab === 'privat') renderContactTab(root, 'Private', 'Phone, email and address.', privateRows(), QrPayload.vcard(state.data), 'Private vCard');
  if (state.activeTab === 'payment') renderPaymentTab(root);
}

function renderContactTab(root, title, subtitle, rows, qrPayload, qrLabel) {
  root.className = `content-card tab-${state.activeTab}${qrPayload ? ' has-qr' : ''}`;
  root.innerHTML = `<div class="panel-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div></div>`;
  const list = document.createElement('div');
  list.className = 'contact-list';
  const usableRows = rows.filter(row => row.value);
  if (!usableRows.length) list.innerHTML = '<div class="empty">No data yet.</div>';
  for (const row of usableRows) list.append(contactRow(row));
  root.append(list);
  if (qrPayload) root.append(qrCard(qrPayload, qrLabel));
}

function renderPaymentTab(root) {
  const kind = state.paymentMode === 'bank' ? 'bank' : 'paypal';
  state.paymentMode = kind;
  sessionStorage.setItem(PAYMENT_MODE_KEY, kind);
  root.className = `content-card tab-payment payment-${kind} has-qr`;
  const isPayPal = kind === 'paypal';
  const title = 'Payments';
  const payload = isPayPal ? QrPayload.paypal(state.data, state.amount) : QrPayload.girocode(state.data, state.amount, state.purpose);
  root.innerHTML = `
    <div class="panel-head">
      <div><h2>${title}</h2><p>${isPayPal ? 'paypal.me payment link.' : 'SEPA GiroCode / EPC QR.'}</p></div>
      <div class="payment-switch" role="group" aria-label="Payment method">
        <button class="${isPayPal ? 'active' : ''}" data-payment-mode="paypal" type="button">PayPal</button>
        <button class="${!isPayPal ? 'active' : ''}" data-payment-mode="bank" type="button">Bank transfer</button>
      </div>
    </div>`;
  const box = document.createElement('div');
  box.className = 'amount-card';
  box.innerHTML = `
    <label class="field"><span>Amount</span><input id="amountInput" inputmode="decimal" autocomplete="off" maxlength="15" value="${esc(state.amount)}" placeholder="e.g. 12.50"></label>
    <div class="chips">${AMOUNTS.map(v => `<button class="chip ${normalizeAmount(state.amount) === Number(v).toFixed(2) ? 'active' : ''}" data-amount="${v}" type="button">${v} €</button>`).join('')}</div>
    ${isPayPal ? '' : `<label class="field"><span>Payment reference</span><input id="purposeInput" autocomplete="off" maxlength="140" value="${esc(state.purpose)}" placeholder="Optional"></label>`}`;
  root.append(box);
  const info = document.createElement('div');
  info.className = 'qr-caption';
  const qrWrap = qrCard(payload, isPayPal ? 'PayPal.me Link' : 'SEPA / EPC QR Code', info, true);
  root.append(qrWrap);
  $$('.payment-switch button', root).forEach(button => button.addEventListener('click', () => {
    state.paymentMode = button.dataset.paymentMode;
    updateNavActive();
    renderPaymentTab(root);
  }));
  const refreshPreview = () => updatePaymentPreview(box, qrWrap, info);
  $('#amountInput', box).addEventListener('input', e => {
    state.amount = e.target.value;
    sessionStorage.setItem(AMOUNT_KEY, state.amount);
  });
  $('#amountInput', box).addEventListener('blur', refreshPreview);
  $$('.chip', box).forEach(chip => chip.addEventListener('click', () => {
    state.amount = Number(chip.dataset.amount).toFixed(2);
    sessionStorage.setItem(AMOUNT_KEY, state.amount);
    $('#amountInput', box).value = state.amount;
    refreshPreview();
  }));
  $('#purposeInput', box)?.addEventListener('input', e => {
    state.purpose = e.target.value;
    sessionStorage.setItem(PURPOSE_KEY, state.purpose);
  });
  $('#purposeInput', box)?.addEventListener('blur', refreshPreview);
  refreshPreview();
}

function updatePaymentPreview(box, qrWrap, info) {
  const isPayPal = state.paymentMode !== 'bank';
  const payload = isPayPal ? QrPayload.paypal(state.data, state.amount) : QrPayload.girocode(state.data, state.amount, state.purpose);
  const link = QrPayload.paypal(state.data, state.amount);
  $$('.chip', box).forEach(chip => chip.classList.toggle('active', normalizeAmount(state.amount) === Number(chip.dataset.amount).toFixed(2)));
  const target = $('.qr-target', qrWrap);
  setQrTarget(target, payload, isPayPal
    ? 'Add your PayPal username in Edit data to show a payment QR code.'
    : (state.data.ib && !isValidIban(state.data.ib) ? 'The IBAN is not valid. Check it in Edit data.' : 'Add your name and IBAN in Edit data to show a GiroCode.'));
  $$('.qr-icon-action', qrWrap).forEach(button => { button.disabled = !payload; });
  info.innerHTML = isPayPal
    ? `<b>Recipient:</b> ${esc(state.data.n || '—')}${link ? `<br><span class="link-line">${esc(link)}</span>` : ''}`
    : `<b>Recipient:</b> ${esc(state.data.n || '—')}<br><b>IBAN:</b> ${esc(formatIban(state.data.ib) || '—')}<br><b>BIC:</b> ${esc((state.data.bic || '').toUpperCase() || '—')}`;
}

function contactRow({ icon, label, value, href }) {
  const node = document.createElement(href ? 'a' : 'div');
  node.className = 'contact-row';
  if (href) node.href = href;
  node.innerHTML = `<span class="ico" aria-hidden="true">${menuIcon(icon)}</span><span><b>${esc(label)}</b><span>${esc(value)}</span></span>`;
  bindLongPress(node, () => copyText(value));
  return node;
}

function setQrTarget(target, payload, emptyMessage) {
  target.dataset.payload = payload || '';
  if (payload) {
    renderQr(target, payload, qrRenderOptions(false, 512));
    return;
  }
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = emptyMessage;
  target.replaceChildren(empty);
}

function qrCard(payload, label, extraNode, deferRender = false) {
  const wrap = document.createElement('div');
  wrap.className = 'qr-card qr-share-card';
  wrap.insertAdjacentHTML('beforeend', `<div class="qr-card-head"><h3>${esc(label)}</h3></div>`);
  const qrFrame = document.createElement('div');
  qrFrame.className = 'qr-frame';
  const qr = document.createElement('div');
  qr.className = 'qr-target';
  qr.dataset.payload = payload;
  if (!deferRender) renderQr(qr, payload, qrRenderOptions(false, 512));
  qr.addEventListener('click', () => { if (qr.dataset.payload) openQrOverlay(qr.dataset.payload); });
  qrFrame.append(qr);
  wrap.append(qrFrame);
  if (extraNode) wrap.append(extraNode); else wrap.insertAdjacentHTML('beforeend', '<div class="qr-caption" aria-hidden="true"></div>');
  const actions = document.createElement('div');
  actions.className = 'qr-card-actions';
  const open = document.createElement('button');
  open.className = 'qr-icon-action qr-open-action';
  open.type = 'button';
  open.setAttribute('aria-label', 'Open QR code');
  open.title = 'Open QR code';
  open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h6v2H8.4l3.7 3.7-1.4 1.4L7 7.4V10H5V4Zm8 0h6v6h-2V7.4l-3.7 3.7-1.4-1.4L15.6 6H13V4ZM5 14h2v2.6l3.7-3.7 1.4 1.4L8.4 18H11v2H5v-6Zm12 0h2v6h-6v-2h2.6l-3.7-3.7 1.4-1.4 3.7 3.7V14Z"/></svg>';
  open.addEventListener('click', () => { if (qr.dataset.payload) openQrOverlay(qr.dataset.payload); });
  const share = document.createElement('button');
  share.className = 'qr-icon-action qr-share-action';
  share.type = 'button';
  share.setAttribute('aria-label', 'Share data');
  share.title = 'Share data';
  share.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16.1c-1 0-1.9.5-2.4 1.2L8.9 13.7a3.2 3.2 0 0 0 0-3.4l6.7-3.6A3 3 0 1 0 15 5c0 .2 0 .4.1.6L8.3 9.2a3 3 0 1 0 0 5.6l6.8 3.6a3 3 0 1 0 2.9-2.3Z"/></svg>';
  share.addEventListener('click', shareCurrentTab);
  actions.append(open, share);
  wrap.append(actions);
  return wrap;
}

async function openQrOverlay(payload) {
  const overlay = $('#qrOverlay');
  renderQr($('#qrBig'), payload, qrRenderOptions(true, 900));
  overlay.classList.remove('hidden');
  try { state.wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
async function closeQrOverlay() {
  $('#qrOverlay').classList.add('hidden');
  try { await state.wakeLock?.release(); } catch {}
  state.wakeLock = null;
}

function privateRows() {
  const address = [state.data.s, state.data.z].filter(Boolean).join(', ');
  return [
    { icon: 'mobile', label: 'Mobile', value: state.data.m, href: state.data.m ? `tel:${state.data.m}` : '' },
    { icon: 'email', label: 'Email', value: state.data.e1, href: state.data.e1 ? `mailto:${state.data.e1}` : '' },
    { icon: 'location', label: 'Private address', value: address, href: address ? `https://maps.google.com/?q=${encodeURIComponent([state.data.s, state.data.z].filter(Boolean).join(' '))}` : '' }
  ];
}
function companyRows() {
  const companyAddress = [state.data.cs, state.data.cz].filter(Boolean).join(', ');
  return [
    { icon: 'company', label: 'Company', value: state.data.c }, { icon: 'work', label: 'Position', value: state.data.j },
    { icon: 'phone', label: 'Office', value: state.data.cp, href: state.data.cp ? `tel:${state.data.cp}` : '' },
    { icon: 'mobile', label: 'Work mobile', value: state.data.cm, href: state.data.cm ? `tel:${state.data.cm}` : '' },
    { icon: 'email', label: 'Work email', value: state.data.ce, href: state.data.ce ? `mailto:${state.data.ce}` : '' },
    { icon: 'website', label: 'Website', value: state.data.w, href: state.data.w ? normalizeUrl(state.data.w) : '' },
    { icon: 'location', label: 'Business address', value: companyAddress, href: companyAddress ? `https://maps.google.com/?q=${encodeURIComponent([state.data.cs, state.data.cz].filter(Boolean).join(' '))}` : '' }
  ];
}

async function shareCurrentTab() {
  const text = buildShareText();
  try {
    if (navigator.share) await navigator.share({ title: APP_NAME, text });
    else await copyText(text);
  } catch (error) { if (error.name !== 'AbortError') toast(error.message); }
}
function buildShareText() {
  const d = state.data;
  if (state.activeTab === 'payment' && state.paymentMode !== 'bank') {
    return [
      `Recipient: ${d.n}`,
      `PayPal: ${QrPayload.paypal(d, state.amount)}`,
      normalizeAmount(state.amount) ? `Amount: ${normalizeAmount(state.amount)} EUR` : '',
    ].filter(Boolean).join('\n');
  }
  if (state.activeTab === 'privat') return [d.n, d.m, d.e1, [d.s, d.z].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  if (state.activeTab === 'firma') return [d.n, d.c, d.j, d.cp, d.cm, d.ce, d.w, [d.cs, d.cz].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  return [`Recipient: ${d.n}`, `IBAN: ${formatIban(d.ib)}`, `BIC: ${(d.bic || '').toUpperCase()}`, normalizeAmount(state.amount) ? `Amount: ${normalizeAmount(state.amount)} EUR` : '', state.purpose ? `Payment reference: ${state.purpose}` : ''].filter(Boolean).join('\n');
}

function openSettings() {
  const avatar = state.data?.av || '';
  const avatarNode = avatar
    ? `<img src="${esc(avatar)}" alt="">`
    : `<span>${esc(initials(state.data?.n))}</span>`;
  openProfileMenu(avatar, avatarNode);
}

function openProfileMenu(avatar, avatarNode) {
  openSheet('Profile', `
    <button class="profile-close" type="button" data-close-sheet aria-label="Close menu">&times;</button>
    <div class="profile-menu-content">
      <section class="profile-card profile-card-button" data-action="edit" role="button" tabindex="0">
        <button class="avatar-wrap profile-avatar" type="button" data-action="avatar-pick" aria-label="Change profile picture">
          ${avatarNode}
          <span class="avatar-camera" aria-hidden="true">${menuIcon('camera')}</span>
        </button>
        <div class="profile-card-main">
          <h3>${esc(state.data?.n || `${APP_NAME} Profile`)}</h3>
          <p>${esc(state.data?.e1 || state.data?.ce || 'Local contact and payment vault')}</p>
        </div>
        <input id="avatarFile" type="file" accept="image/*" hidden>
      </section>
      <div class="profile-actions">
        ${profileMenuRowClean('edit', 'Edit data', 'Maintain contact and payment details', 'edit')}
        ${profileMenuRowClean('palette', 'Appearance', 'Theme and color mode', 'appearance')}
        ${profileMenuRowClean('image', 'Profile picture', 'Crop and store encrypted in the vault', 'avatar-pick')}
        ${avatar ? profileMenuRowClean('trash', 'Remove profile picture', 'Delete the profile picture from the vault', 'avatar-remove') : ''}
        ${profileMenuRowClean('info', 'About', 'Build and repository information', 'debug')}
      </div>
      <section class="settings-section compact-settings" data-appearance-panel hidden>
        <h3>Appearance</h3>
        <div class="option-grid" data-theme-picker>${THEMES.map(t => `<button class="btn small tonal" data-theme-choice="${t}">${labelTheme(t)}</button>`).join('')}</div>
        <div class="option-grid" data-mode-picker>${MODES.map(m => `<button class="btn small tonal" data-mode-choice="${m}">${labelMode(m)}</button>`).join('')}</div>
      </section>
      <section class="profile-actions">
        ${profileMenuRowClean('lock', 'Master Password', 'Re-encrypt vault', 'password')}
        ${profileMenuRowClean('pin', 'PIN', 'Set up 6-digit quick unlock on this device', 'pin')}
      </section>
      <section class="settings-section compact-settings">
        <h3>Backup & Server</h3>
        <button class="profile-row-button" data-action="export" type="button"><span>${menuIcon('download')}</span><b>Export Token</b></button>
        <label class="profile-row-button"><span>${menuIcon('upload')}</span><b>Import Token</b><input id="importFile" type="file" accept="application/json,.json,.txt" hidden></label>
        <label class="field"><span>Server Secret</span><input id="secretInput" type="password" autocomplete="off" value="${esc(Store.getSecret())}"></label>
        <button class="btn tonal" data-action="secret" type="button">Save Secret</button>
      </section>
      <section class="profile-actions session-actions">
        ${profileMenuRowClean('lock', 'Lock Vault', 'Return to unlock', 'lock')}
        ${profileMenuRowClean('logout', 'Sign Out', 'Remove secret, PIN and remembered name on this device', 'logout')}
      </section>
    </div>`);
  $('#sheet').classList.add('profile-menu');
  $('#sheetBody').onclick = settingsClick;
  $('#sheetBody').onchange = settingsChange;
}

function profileMenuRowClean(iconName, title, subtitle, action) {
  return `
    <button class="profile-menu-row" data-action="${action}" type="button">
      <span class="profile-row-icon" aria-hidden="true">${menuIcon(iconName)}</span>
      <span><b>${esc(title)}</b><small>${esc(subtitle)}</small></span>
    </button>`;
}

function menuIcon(name) {
  const paths = {
    edit: 'M5 19h1.4L16.7 8.7l-1.4-1.4L5 17.6V19Zm-2 2v-4.2L16.7 3.1a1 1 0 0 1 1.4 0l2.8 2.8a1 1 0 0 1 0 1.4L7.2 21H3Z',
    palette: 'M12 22a10 10 0 1 1 0-20 8 8 0 0 1 8 8c0 2.2-1.8 4-4 4h-1.8c-.8 0-1.2.9-.7 1.5.6.7.9 1.4.9 2.2A4.3 4.3 0 0 1 12 22ZM7.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm3-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm4 2a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
    image: 'M5 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5Zm1.5-3h11l-3.4-4.5-2.7 3.4-1.9-2.4L6.5 17ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    camera: 'M4 7h3l1.5-2h7L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    trash: 'M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12ZM8 4l1-1h6l1 1h4v2H4V4h4Z',
    info: 'M11 17h2v-6h-2v6Zm1-8a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 12 9Zm0 13a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z',
    lock: 'M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V8a3 3 0 0 0-6 0v2Z',
    pin: 'M12 2 7 7h3v6l-4 7 1.7 1 4.3-7.5L16.3 21l1.7-1-4-7V7h3l-5-5Z',
    key: 'M7 14a5 5 0 1 1 4.6-3H22v3h-3v3h-3v-3h-4.4A5 5 0 0 1 7 14Zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    download: 'M5 20h14v-2H5v2Zm7-16v9.2l3.6-3.6L17 11l-5 5-5-5 1.4-1.4 3.6 3.6V4h2Z',
    upload: 'M5 20h14v-2H5v2Zm7-16 5 5-1.4 1.4L13 7.8V16h-2V7.8l-2.6 2.6L7 9l5-5Z',
    logout: 'M5 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7v2H5v14h7v2H5Zm11-4-1.4-1.4 2.6-2.6H9v-2h8.2l-2.6-2.6L16 7l5 5-5 5Z',
    mobile: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v14h10V5H7Zm4 12h2v1h-2v-1Z',
    phone: 'M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02L6.6 10.8Z',
    email: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm8 7 8-5H4l8 5Zm0 2L4 8v10h16V8l-8 5Z',
    location: 'M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7Zm0 9.5A2.5 2.5 0 1 0 12 6a2.5 2.5 0 0 0 0 5.5Z',
    company: 'M3 21V3h12v6h6v12H3Zm4-4h2v-2H7v2Zm0-4h2v-2H7v2Zm0-4h2V7H7v2Zm4 8h2v-2h-2v2Zm0-4h2v-2h-2v2Zm4 4h2v-4h-2v4Z',
    work: 'M9 4V2h6v2h5a2 2 0 0 1 2 2v5H2V6a2 2 0 0 1 2-2h5Zm2 0h2V3h-2v1Zm11 9v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7h8v2h4v-2h8Z',
    website: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm6.9 9a7.9 7.9 0 0 0-1.6-4H15a16 16 0 0 1 .7 4h3.2Zm-5.2 0A14 14 0 0 0 12 5.2 14 14 0 0 0 10.3 11h3.4Zm-5.4 0A16 16 0 0 1 9 7H6.7a7.9 7.9 0 0 0-1.6 4h3.2Zm0 2H5.1a7.9 7.9 0 0 0 1.6 4H9a16 16 0 0 1-.7-4Zm2 0a14 14 0 0 0 1.7 5.8 14 14 0 0 0 1.7-5.8h-3.4Zm5.4 0a16 16 0 0 1-.7 4h2.3a7.9 7.9 0 0 0 1.6-4h-3.2Z'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`;
}

async function settingsClick(e) {
  if (e.target.closest('[data-close-sheet]')) { closeSheet(); return; }
  const action = e.target.closest('[data-action]')?.dataset.action;
  const theme = e.target.closest('[data-theme-choice]')?.dataset.themeChoice;
  const mode = e.target.closest('[data-mode-choice]')?.dataset.modeChoice;
  if (theme) { localStorage.setItem(THEME_KEY, theme); applyTheme(); return; }
  if (mode) { localStorage.setItem(MODE_KEY, mode); applyTheme(); return; }
  if (!action) return;
  if (action === 'edit') openProfileProgress(0, false);
  if (action === 'appearance') {
    const panel = $('[data-appearance-panel]');
    if (panel) panel.hidden = !panel.hidden;
    return;
  }
  if (action === 'avatar-pick') { $('#avatarFile')?.click(); return; }
  if (action === 'password') openPasswordSheet();
  if (action === 'pin') openPinSetup(false);
  if (action === 'debug') openDebugInfo();
  if (action === 'export') { Store.exportToken({ token: state.token, updated: state.updated }); toast('Export started.'); }
  if (action === 'lock') lockVault();
  if (action === 'logout') {
    Auth.clearPin(); Auth.clearDeprecatedPasskey(); Store.clearSecret();
    localStorage.removeItem(LOGIN_NAME_KEY);
    lockVault();
  }
  if (action === 'avatar-remove') {
    try {
      await saveCurrentData({ ...state.data, av: '' }, false);
      localStorage.removeItem(LEGACY_AVATAR_KEY);
      closeSheet();
      toast('Profile picture removed.');
    } catch (error) { toast(error.message); }
  }
  if (action === 'secret') {
    try {
      Store.setSecret($('#secretInput').value);
      toast('Secret saved.');
      upgradeStoredVault();
    }
    catch (error) { toast(error.message); }
  }
}
async function settingsChange(e) {
  if (e.target.id === 'avatarFile' && e.target.files[0]) {
    try {
      await openAvatarCrop(e.target.files[0]);
      e.target.value = '';
    } catch (error) { toast(error.message); }
    return;
  }
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  const file = e.target.files[0];
  e.target.value = '';
  try {
    const imported = await Store.importToken(file);
    if (![2, VAULT_VERSION].includes(tokenVersion(imported.token))) throw new Error('Import does not contain a supported Meiku vault.');
    openConfirmSheet(
      'Replace Vault?',
      'Importing replaces the vault stored on the server with the imported token. Export the current token first if you may need it again. You will need the password of the imported vault to unlock it.',
      'Replace and Import',
      async () => {
        const saved = await Store.saveToken(imported.token, state.revision);
        Object.assign(state, { token: saved.token, updated: saved.updated, revision: saved.revision, data: null, session: null, needsUpgrade: false });
        closeSheet(); showLogin(); toast('Token imported. Please unlock.');
      }
    );
  } catch (error) { toast(error.message); }
}

function openConfirmSheet(title, message, confirmLabel, onConfirm) {
  openSheet(title, `
    <div class="stack">
      <p class="muted">${esc(message)}</p>
      <div class="inline-actions">
        <button class="btn tonal" type="button" data-close-sheet>Cancel</button>
        <button class="btn primary" type="button" data-confirm>${esc(confirmLabel)}</button>
      </div>
    </div>`);
  $('#sheetBody').onclick = async e => {
    if (e.target.closest('[data-close-sheet]')) { closeSheet(); return; }
    const button = e.target.closest('[data-confirm]');
    if (!button) return;
    button.disabled = true;
    try { await onConfirm(); } catch (error) { button.disabled = false; toast(error.message); }
  };
  $('#sheetBody').onchange = null;
}

function openDebugInfo() {
  const info = state.buildInfo || {};
  const forkRepos = Array.isArray(info.forkRepos) ? info.forkRepos : [];
  const rows = [
    ['App', info.app || APP_TITLE],
    ['Build SHA', shortSha(info.buildSha)],
    ['Full SHA', info.buildSha || 'local'],
    ['Repo updated', formatDebugDate(info.repoUpdatedAt)],
    ['Image built', formatDebugDate(info.builtAt)],
    ['Source', info.sourceRepo || 'MaroIshiku/meiku'],
    ['Ref', info.sourceRef || 'local'],
    ['Workflow Run', info.workflowRun || 'local'],
    ['Fork repositories', forkRepos.length ? `${forkRepos.length} included` : 'None included']
  ];
  openSheet('Debug Information', `
    <div class="debug-panel">
      <p class="muted">Technical information about the currently delivered build.</p>
      <div class="debug-list">
        ${rows.map(([label, value]) => `<div><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join('')}
      </div>
      ${forkRepos.length ? `<div class="debug-list">${forkRepos.map(repo => `<div><b>${esc(repo.name || repo.repo || 'Repository')}</b><span>${esc(repo.version || repo.sha || 'unknown')}</span></div>`).join('')}</div>` : ''}
      <button class="btn tonal" type="button" data-close-sheet>Close</button>
    </div>`);
  $('#sheetBody').onclick = e => { if (e.target.closest('[data-close-sheet]')) closeSheet(); };
}

async function openAvatarCrop(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image.');
  const image = await loadImageFromFile(file);
  const crop = { zoom: 1, x: 0, y: 0 };
  openSheet('Crop Profile Picture', `
    <form id="avatarCropForm" class="avatar-crop stack">
      <canvas id="avatarPreview" width="280" height="280" aria-label="Profile picture preview"></canvas>
      <label class="field"><span>Zoom</span><input id="avatarZoom" type="range" min="1" max="3" step="0.01" value="1"></label>
      <label class="field"><span>Move horizontally</span><input id="avatarX" type="range" min="-100" max="100" step="1" value="0"></label>
      <label class="field"><span>Move vertically</span><input id="avatarY" type="range" min="-100" max="100" step="1" value="0"></label>
      <div class="inline-actions">
        <button class="btn tonal" type="button" data-close-sheet>Cancel</button>
        <button class="btn primary" type="submit">Save Profile Picture</button>
      </div>
    </form>`);

  const preview = $('#avatarPreview');
  const drawPreview = () => drawAvatarCanvas(preview, image, crop, 280, false);
  $('#avatarZoom').addEventListener('input', e => { crop.zoom = Number(e.target.value); drawPreview(); });
  $('#avatarX').addEventListener('input', e => { crop.x = Number(e.target.value); drawPreview(); });
  $('#avatarY').addEventListener('input', e => { crop.y = Number(e.target.value); drawPreview(); });
  $('[data-close-sheet]', $('#avatarCropForm')).addEventListener('click', closeSheet);
  $('#avatarCropForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const avatar = renderAvatarDataUrl(image, crop);
      await saveCurrentData({ ...state.data, av: avatar }, false);
      localStorage.removeItem(LEGACY_AVATAR_KEY);
      closeSheet();
      toast('Profile picture saved.');
    } catch (error) {
      toast(error.message);
    }
  });
  drawPreview();
}

function openProfileProgress(stepIndex = 0, firstRun = false) {
  let index = Math.max(0, Math.min(PROFILE_STEPS.length - 1, stepIndex));
  let draft = normalizeData(state.data || {});

  const render = () => {
    const step = PROFILE_STEPS[index];
    const allStepFields = [...new Set(PROFILE_STEPS.flatMap(item => item.fields))];
    const filledFields = allStepFields.filter(field => String(draft[field] || '').trim()).length;
    const body = document.createElement('div');
    body.className = 'profile-progress';
    body.innerHTML = `
      <div class="progress-summary">
        <div>
          <p class="eyebrow">Progress</p>
          <h3>${esc(filledFields)} of ${allStepFields.length} fields</h3>
          <p class="muted">${firstRun ? 'Complete your profile in separate steps. Everything stays optional and encrypted.' : 'Edit each section separately. Changes are saved encrypted.'}</p>
        </div>
        <div class="progress-ring" aria-label="${esc(filledFields)} of ${allStepFields.length} fields completed">${esc(filledFields)}/${allStepFields.length}</div>
      </div>
      <div class="progress-track" aria-hidden="true"><span class="progress-fill progress-fill-${index + 1}"></span></div>
      <ol class="stepper" aria-label="Profile progress">
        ${PROFILE_STEPS.map((item, i) => {
          const status = stepCompletion(item, draft);
          const stateClass = i === index ? 'active' : i < index ? 'done' : '';
          return `<li class="${stateClass}"><span>${status.done ? '✓' : i + 1}</span><div><b>${esc(item.title)}</b><small>${status.count}/${item.fields.length} fields</small></div></li>`;
        }).join('')}
      </ol>
      <form id="profileStepForm" class="stack">
        <div class="step-panel">
          <p class="eyebrow">Step ${index + 1}</p>
          <h3>${esc(step.title)}</h3>
          <p class="muted">${esc(step.hint)}</p>
          <div class="setup-grid" id="profileStepFields"></div>
        </div>
        <div class="progress-actions">
          <button class="btn tonal" type="button" data-progress-back ${index === 0 ? 'disabled' : ''}>Back</button>
          <button class="btn ghost" type="button" data-progress-close>${firstRun ? 'Later' : 'Close'}</button>
          <button class="btn primary" type="submit">${index === PROFILE_STEPS.length - 1 ? 'Done' : 'Save & Continue'}</button>
        </div>
      </form>`;

    openSheet(firstRun ? 'Complete Profile' : 'Edit data', body);
    renderSetupFields($('#profileStepFields'), draft, fieldDefs(step.fields));

    $('#profileStepForm').addEventListener('submit', async event => {
      event.preventDefault();
      draft = normalizeData({ ...draft, ...collectForm(event.currentTarget) });
      try {
        await saveCurrentData(draft, false);
        if (index === PROFILE_STEPS.length - 1) {
          closeSheet();
          toast('Profile saved.');
        } else {
          index += 1;
          toast('Saved.');
          render();
        }
      } catch (error) {
        toast(error.message);
      }
    });
    $('[data-progress-back]')?.addEventListener('click', () => {
      draft = normalizeData({ ...draft, ...collectForm($('#profileStepForm')) });
      index = Math.max(0, index - 1);
      render();
    });
    $('[data-progress-close]')?.addEventListener('click', closeSheet);
  };

  render();
}

function openPasswordSheet() {
  openSheet('Change Password', `<form id="passwordChange" class="stack">
    <p class="muted">The vault is re-encrypted with a new key. Other devices and the PIN on this device need the new password afterwards.</p>
    <label class="field"><span>New Master Password</span><input id="newPassword" type="password" autocomplete="new-password" minlength="${MIN_NEW_PASSWORD_LENGTH}" required></label>
    <label class="field"><span>Repeat New Master Password</span><input id="newPasswordConfirm" type="password" autocomplete="new-password" minlength="${MIN_NEW_PASSWORD_LENGTH}" required></label>
    <button class="btn primary" type="submit">Re-encrypt</button>
  </form>`);
  $('#passwordChange').addEventListener('submit', async e => {
    e.preventDefault();
    const newPassword = $('#newPassword').value;
    const problem = checkNewPassword(newPassword, $('#newPasswordConfirm').value);
    if (problem) return toast(problem);
    try {
      const session = await createVault(newPassword);
      await saveCurrentData(state.data, true, session);
      Auth.clearPin(); Auth.clearDeprecatedPasskey();
      closeSheet(); toast('Password changed. Please set up your PIN again.');
    } catch (error) { toast(error.message); }
  });
}

function checkNewPassword(password, confirmation) {
  if (password.length < MIN_NEW_PASSWORD_LENGTH) return `Password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters.`;
  if (password !== confirmation) return 'The passwords do not match.';
  return '';
}

function openPinSetup(firstRun) {
  openSheet('Set Up PIN', `<p class="muted">The 6-digit PIN encrypts your master password and current server write secret locally with one million PBKDF2 iterations. Plaintext credentials are never persisted.</p><form id="pinSetupForm" class="stack"><label class="field"><span>New PIN (6 digits)</span><input id="newPin" inputmode="numeric" pattern="\\d{6}" minlength="6" maxlength="6" autocomplete="off" required></label><button class="btn primary" type="submit">Save PIN</button>${firstRun ? '<button class="btn ghost" type="button" data-close-sheet>Later</button>' : ''}</form>`);
  $('#pinSetupForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      if (state.needsUpgrade || tokenVersion(state.token) !== VAULT_VERSION) {
        if (!Store.getSecret()) throw new Error('Save the server secret first so the vault can be upgraded before setting up a PIN.');
        await saveCurrentData(state.data, false);
      }
      await Auth.savePin($('#newPin').value, state.session, Store.getSecret());
      closeSheet(); toast('PIN saved.');
    }
    catch (error) { toast(error.message); }
  });
  $$('[data-close-sheet]', $('#sheet')).forEach(n => n.addEventListener('click', closeSheet));
}

async function saveCurrentData(data, refresh = true, session = state.session) {
  if (!session) throw new Error('Vault is locked.');
  const vaultData = normalizeData(data);
  const token = await sealVault(session, vaultData);
  const saved = await Store.saveToken(token, state.revision);
  Object.assign(state, { data: vaultData, session, token: saved.token, updated: saved.updated, revision: saved.revision, needsUpgrade: false });
  if (readLegacyAvatar() && vaultData.av) localStorage.removeItem(LEGACY_AVATAR_KEY);
  rememberLoginName(state.data.n);
  if (refresh) showVault();
  else {
    updateVaultHeader();
    renderTab();
  }
}

function openSheet(title, body) {
  $('#sheet').classList.remove('profile-menu');
  $('#sheetTitle').textContent = title;
  const sheetBody = $('#sheetBody');
  if (typeof body === 'string') sheetBody.innerHTML = body;
  else sheetBody.replaceChildren(body);
  $('#sheet').classList.remove('hidden');
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheet').classList.remove('profile-menu'); $('#sheetBody').replaceChildren(); }

function renderSetupFields(root, data = {}, fields = FIELDS) {
  const frag = document.createDocumentFragment();
  for (const [key, label, type, required] of fields) {
    const field = document.createElement('label');
    field.className = 'field';
    field.innerHTML = `<span>${esc(label)}${required ? ' *' : ''}</span><input name="${key}" type="${type || 'text'}" value="${esc(data[key] || '')}" ${required ? 'required' : ''}>`;
    frag.append(field);
  }
  root.replaceChildren(frag);
}
function fieldDefs(keys) { return keys.map(key => FIELDS.find(([field]) => field === key)).filter(Boolean); }
function stepCompletion(step, data) {
  const count = step.fields.filter(field => String(data[field] || '').trim()).length;
  return { count, done: count === step.fields.length };
}
function collectForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => { if (FIELD_LABELS[key]) data[key] = String(value).trim(); });
  return data;
}
function normalizeData(data) {
  const out = {};
  for (const [key] of FIELDS) out[key] = String(data[key] || '').trim();
  out.ib = formatIbanRaw(out.ib);
  out.bic = out.bic.toUpperCase();
  out.pp = out.pp.replace(/^@/, '');
  const avatar = String(data.av || '');
  out.av = avatar.length <= MAX_AVATAR_CHARS && AVATAR_RE.test(avatar) ? avatar : '';
  return out;
}

function readLegacyAvatar() {
  const avatar = localStorage.getItem(LEGACY_AVATAR_KEY) || '';
  return avatar.length <= MAX_AVATAR_CHARS && AVATAR_RE.test(avatar) ? avatar : '';
}

function lockVault() {
  state.session = null;
  state.data = null;
  location.reload();
}

/** One-time clean-up of browser storage written by older releases. Never deletes vault data. */
function migrateLocalStorage() {
  try { Store.migrateLegacySecret(); } catch { Store.clearSecret(); }
  Auth.clearDeprecatedPasskey();
  for (const key of ['dv2.amount', 'dv2.purpose']) {
    const value = sessionStorage.getItem(key);
    if (value !== null && sessionStorage.getItem(key.replace('dv2.', 'meiku.')) === null) sessionStorage.setItem(key.replace('dv2.', 'meiku.'), value);
    sessionStorage.removeItem(key);
  }
  localStorage.removeItem(LEGACY_THEME_KEY);
  localStorage.removeItem(LEGACY_MODE_KEY);
}

function updateAvatar() {
  const wrap = $('#heroAvatarWrap');
  const img = $('#heroAvatar');
  const initialsNode = $('#heroInitials');
  const avatar = state.data?.av || '';
  initialsNode.textContent = initials(state.data?.n);
  initialsNode.hidden = false;
  if (!avatar) {
    wrap.classList.remove('has-image');
    img.removeAttribute('src');
    img.hidden = true;
    return;
  }
  wrap.classList.remove('has-image');
  img.hidden = true;
  img.onerror = () => {
    wrap.classList.remove('has-image');
    img.hidden = true;
    img.removeAttribute('src');
    initialsNode.hidden = false;
  };
  img.onload = () => {
    wrap.classList.add('has-image');
    img.hidden = false;
  };
  img.src = avatar;
  if (img.complete && img.naturalWidth > 0) {
    wrap.classList.add('has-image');
    img.hidden = false;
  }
}

function qrRenderOptions(fullscreen, size) {
  if (fullscreen) {
    return {
      size,
      className: 'qr-canvas qr-canvas-fullscreen',
      light: '#fffaff',
      finderLight: '#fffaff',
      dark: '#24113f',
      accent: '#6f55c8',
      border: 6
    };
  }
  return {
    size,
    className: 'qr-canvas',
    light: '#ffffff',
    finderLight: '#ffffff',
    dark: '#111111',
    accent: '#111111',
    border: 6
  };
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image could not be read.')); };
    img.src = url;
  });
}

function renderAvatarDataUrl(image, crop) {
  for (const [size, quality] of [[384, 0.84], [320, 0.8], [256, 0.78], [192, 0.72]]) {
    const canvas = document.createElement('canvas');
    drawAvatarCanvas(canvas, image, crop, size, true);
    const webp = canvas.toDataURL('image/webp', quality);
    const dataUrl = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= MAX_AVATAR_CHARS) return dataUrl;
  }
  throw new Error('Profile picture is too large. Try a smaller image.');
}

function drawAvatarCanvas(canvas, image, crop, size, final = false) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = final ? 'high' : 'medium';
  ctx.clearRect(0, 0, size, size);
  const cropSize = Math.min(image.naturalWidth, image.naturalHeight) / Math.max(1, crop.zoom || 1);
  const maxX = Math.max(0, image.naturalWidth - cropSize);
  const maxY = Math.max(0, image.naturalHeight - cropSize);
  const sx = clamp((image.naturalWidth - cropSize) / 2 + (crop.x || 0) / 100 * maxX / 2, 0, maxX);
  const sy = clamp((image.naturalHeight - cropSize) / 2 + (crop.y || 0) / 100 * maxY / 2, 0, maxY);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(image, sx, sy, cropSize, cropSize, 0, 0, size, size);
}

function buildPinPad() {
  const grid = $('.pin-grid');
  const keys = [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['back', '←', 'Delete last digit'], ['0', '0'], ['ok', 'OK', 'Unlock']];
  for (const [key, text, label] of keys) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    if (label) btn.setAttribute('aria-label', label);
    btn.addEventListener('click', () => { vibrate(); pinPadInput(key); });
    grid.append(btn);
  }
  $('#pinCancel').addEventListener('click', closePinPad);
  document.addEventListener('keydown', event => {
    if ($('#pinPad').classList.contains('hidden')) return;
    if (/^\d$/.test(event.key)) pinPadInput(event.key);
    else if (event.key === 'Backspace') pinPadInput('back');
    else if (event.key === 'Enter') pinPadInput('ok');
    else if (event.key === 'Escape') closePinPad();
    else return;
    event.preventDefault();
  });
}
function paintPinPad() {
  $('#pinDots').innerHTML = Array.from({ length: 6 }, (_, i) => `<span class="${i < pinPad.value.length ? 'filled' : ''}"></span>`).join('');
  $('#pinPad').setAttribute('aria-label', `PIN pad, ${pinPad.value.length} of 6 digits entered`);
}
async function pinPadInput(key) {
  if (/^\d$/.test(key) && pinPad.value.length < 6) pinPad.value += key;
  if (key === 'back') pinPad.value = pinPad.value.slice(0, -1);
  if (key === 'ok' && pinPad.handler) {
    const pin = pinPad.value;
    const handler = pinPad.handler;
    closePinPad();
    await handler(pin);
    return;
  }
  paintPinPad();
}
function openPinPad(callback) {
  pinPad.handler = callback;
  pinPad.value = '';
  paintPinPad();
  document.body.classList.add('pin-active');
  $('#pinPad').classList.remove('hidden');
  $('#pinPad button')?.focus();
}
function closePinPad() {
  pinPad.value = '';
  pinPad.handler = null;
  paintPinPad();
  $('#pinPad').classList.add('hidden');
  document.body.classList.remove('pin-active');
}

function bindLongPress(node, callback) {
  let timer;
  node.addEventListener('pointerdown', () => timer = setTimeout(() => { callback(); vibrate(); }, 520));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(e => node.addEventListener(e, () => clearTimeout(timer)));
}
async function copyText(text) { await navigator.clipboard.writeText(text); toast('Copied.'); }
function toast(message) { const el = $('#psu-toast-host'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2600); }
function vibrate() { if (navigator.vibrate) navigator.vibrate(8); }
function applyTheme() {
  const storedTheme = normalizeTheme(localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY));
  const storedMode = normalizeMode(localStorage.getItem(MODE_KEY) || localStorage.getItem(LEGACY_MODE_KEY));
  const theme = THEMES.includes(storedTheme) ? storedTheme : 'lavender';
  const mode = MODES.includes(storedMode) ? storedMode : 'system';
  const resolvedMode = mode === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;

  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.mode = mode;
  document.documentElement.dataset.resolvedMode = resolvedMode;
  document.body.dataset.theme = theme;
  document.body.dataset.mode = mode;
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(MODE_KEY, mode);
}
function initials(name = '') { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || 'MK'; }
function loginDisplayName() { return state.data?.n || localStorage.getItem(LOGIN_NAME_KEY) || 'Meiku'; }
function rememberLoginName(name) {
  const value = String(name || '').trim();
  if (value) localStorage.setItem(LOGIN_NAME_KEY, value);
}
function formatDate(value) { try { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return value; } }
function formatDebugDate(value) { return value ? formatDate(value) : 'Not set in local build'; }
function shortSha(value) { return value && value !== 'local' ? `${value.slice(0, 12)}…` : 'local'; }
async function loadBuildInfo() {
  try {
    const response = await fetch(`build-info.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Build info is not available.');
    return await response.json();
  } catch {
    return { app: APP_TITLE, buildSha: 'local', repoUpdatedAt: null, builtAt: null, sourceRepo: 'MaroIshiku/meiku', sourceRef: 'local', workflowRun: null, forkRepos: [] };
  }
}
function normalizeUrl(url) { return /^https?:\/\//i.test(url) ? url : `https://${url}`; }
function normalizeTheme(theme) {
  return ({ lavendel: 'lavender', lavender: 'lavender', teal: 'mint', wald: 'mint', mint: 'mint', ozean: 'sky', sky: 'sky', amber: 'amber', rose: 'rose', graphit: 'graphite', graphite: 'graphite' })[theme] || theme;
}
function normalizeMode(mode) {
  return ({ auto: 'system', system: 'system', light: 'light', dark: 'dark' })[mode] || mode;
}
function labelTheme(t) { return ({ lavender: 'Lavender', mint: 'Mint', sky: 'Sky', amber: 'Amber', rose: 'Rose', graphite: 'Graphite' })[t] || t; }
function labelMode(m) { return ({ system: 'System', light: 'Light', dark: 'Dark' })[m] || m; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]); }
