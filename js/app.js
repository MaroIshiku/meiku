import { Auth } from './auth.js';
import { decryptJson, encryptJson } from './crypto.js';
import { formatIban, formatIbanRaw, normalizeAmount, QrPayload, renderQr } from './qr.js';
import { Store } from './store.js';

const FIELDS = [
  ['n', 'Vollständiger Name', 'text', true], ['m', 'Privat-Handy', 'tel'], ['e1', 'Privat-E-Mail', 'email'],
  ['s', 'Privat-Straße / Hausnummer', 'text'], ['z', 'Privat-PLZ / Stadt', 'text'],
  ['c', 'Firma', 'text'], ['j', 'Position / Jobtitel', 'text'], ['cp', 'Büro-Telefon', 'tel'], ['cm', 'Dienst-Handy', 'tel'], ['ce', 'Firmen-E-Mail', 'email'],
  ['w', 'Webseite', 'text'], ['cs', 'Geschäftsstraße / Hausnummer', 'text'], ['cz', 'Geschäfts-PLZ / Stadt', 'text'], ['pp', 'PayPal-Nutzername', 'text'],
  ['ib', 'IBAN', 'text'], ['bic', 'BIC', 'text']
];
const SETUP_FIELDS = [['n', 'Vollständiger Name', 'text', true]];
const FIELD_LABELS = Object.fromEntries(FIELDS.map(([key, label]) => [key, label]));
const PROFILE_STEPS = [
  { id: 'privat', title: 'Privat', hint: 'Private Kontaktdaten und private Adresse.', fields: ['m', 'e1', 's', 'z'] },
  { id: 'firma', title: 'Geschäftlich', hint: 'Firma, berufliche Kontakte und separate Geschäftsadresse.', fields: ['c', 'j', 'cp', 'cm', 'ce', 'w', 'cs', 'cz'] },
  { id: 'paypal', title: 'PayPal', hint: 'paypal.me Nutzername für Zahlungslinks.', fields: ['pp'] },
  { id: 'bank', title: 'Bank', hint: 'SEPA-Daten für GiroCode / EPC-QR.', fields: ['ib', 'bic'] }
];
const AMOUNTS = ['5', '10', '20', '50', '100'];
const THEMES = ['teal', 'wald', 'ozean', 'rose', 'lavendel', 'graphit'];
const MODES = ['auto', 'light', 'dark'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const state = { token: '', updated: null, data: null, masterPassword: '', activeTab: 'privat', amount: sessionStorage.getItem('dv2.amount') || '', purpose: sessionStorage.getItem('dv2.purpose') || '', wakeLock: null };

init();

async function init() {
  applyTheme();
  renderSetupFields($('#setupFields'), {}, SETUP_FIELDS);
  buildPinPad();
  bindAuth();
  bindGlobal();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);
  const loaded = await Store.loadData();
  state.token = loaded.token;
  state.updated = loaded.updated;
  if (!loaded.token) showSetup(loaded.offlineError);
  else showLogin();
}

function bindAuth() {
  $('#passwordLogin').addEventListener('submit', async event => {
    event.preventDefault();
    await unlockWithPassword($('#masterPassword').value);
  });
  $('#setupForm').addEventListener('submit', async event => {
    event.preventDefault();
    const data = collectForm(event.currentTarget);
    if (!data.n) return toast('Name ist Pflicht.');
    const password = $('#setupPassword').value;
    const secret = $('#setupSecret').value;
    if (password.length < 8) return toast('Passwort muss mindestens 8 Zeichen haben.');
    Store.setSecret(secret);
    try {
      const token = await encryptJson(normalizeData(data), password);
      const saved = await Store.saveToken(token);
      Object.assign(state, { token: saved.token, updated: saved.updated, data: normalizeData(data), masterPassword: password });
      showVault();
      openProfileProgress(0, true);
      toast('Tresor gespeichert.');
    } catch (error) { toast(error.message); }
  });
  $('#pinOpen').addEventListener('click', () => openPinPad(async pin => {
    try { await unlockWithPassword(await Auth.passwordFromPin(pin)); }
    catch (error) { toast(error.message); }
  }));
  $('#passkeyLogin').addEventListener('click', async () => {
    try { await unlockWithPassword(await Auth.passwordFromPasskey()); }
    catch (error) { toast(error.message); }
  });
}

function bindGlobal() {
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#shareBtn').addEventListener('click', shareCurrentTab);
  $$('.bottom-nav button').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  $('#qrClose').addEventListener('click', closeQrOverlay);
  $('#qrOverlay').addEventListener('click', e => { if (e.target.id === 'qrOverlay') closeQrOverlay(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeQrOverlay(); closeSheet(); } });
  $('[data-close-sheet]')?.addEventListener('click', closeSheet);
}

function showSetup(offlineError) {
  $('#authScreen').classList.remove('hidden');
  $('#vaultScreen').classList.add('hidden');
  $('#authTitle').textContent = 'Ersteinrichtung';
  $('#authHint').textContent = offlineError ? 'Token konnte nicht geladen werden. Du kannst trotzdem lokal starten und später speichern.' : 'Lege nur den Tresor an. Dein Profil füllst du danach Schritt für Schritt aus.';
  $('#setupForm').classList.remove('hidden');
  $('#passwordLogin').classList.add('hidden');
  $('#quickUnlock').classList.add('hidden');
}

function showLogin() {
  $('#authScreen').classList.remove('hidden');
  $('#vaultScreen').classList.add('hidden');
  $('#authTitle').textContent = 'Willkommen zurück';
  $('#authHint').textContent = 'Entsperre deinen Kontakt- & Zahlungs-Tresor.';
  $('#setupForm').classList.add('hidden');
  $('#passwordLogin').classList.remove('hidden');
  $('#quickUnlock').classList.toggle('hidden', !(Auth.hasPin() || Auth.hasPasskey()));
  $('#pinOpen').classList.toggle('hidden', !Auth.hasPin());
  $('#passkeyLogin').classList.toggle('hidden', !Auth.hasPasskey());
}

async function unlockWithPassword(password) {
  try {
    const data = await decryptJson(state.token, password);
    state.data = normalizeData(data);
    state.masterPassword = password;
    showVault();
  } catch (error) {
    console.error(error);
    toast('Passwort/PIN falsch oder Token beschädigt.');
  }
}

function showVault() {
  $('#authScreen').classList.add('hidden');
  $('#vaultScreen').classList.remove('hidden');
  updateVaultHeader();
  setTab(state.activeTab);
  Auth.startAutoLock(() => location.reload());
}

function updateVaultHeader() {
  $('#heroName').textContent = state.data.n || 'Ohne Name';
  $('#heroInitials').textContent = initials(state.data.n);
  $('#updatedAt').textContent = state.updated ? `Aktualisiert ${formatDate(state.updated)}` : 'Noch nicht gespeichert';
  updateAvatar();
}

function setTab(tab) {
  state.activeTab = tab;
  $$('.bottom-nav button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  renderTab();
}

function renderTab() {
  const root = $('#tabContent');
  if (!state.data) return;
  if (state.activeTab === 'privat') renderContactTab(root, 'Privat', 'Telefon, Mail und Adresse.', privateRows(), QrPayload.vcard(state.data), 'vCard privat');
  if (state.activeTab === 'firma') renderContactTab(root, 'Firma', 'Geschäftliche Kontaktdaten.', companyRows(), null, null);
  if (state.activeTab === 'paypal') renderPaymentTab(root, 'paypal');
  if (state.activeTab === 'bank') renderPaymentTab(root, 'bank');
}

function renderContactTab(root, title, subtitle, rows, qrPayload, qrLabel) {
  root.className = `content-card tab-${state.activeTab}${qrPayload ? ' has-qr' : ''}`;
  root.innerHTML = `<div class="panel-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div></div>`;
  const list = document.createElement('div');
  list.className = 'contact-list';
  const usableRows = rows.filter(row => row.value);
  if (!usableRows.length) list.innerHTML = '<div class="empty">Noch keine Daten hinterlegt.</div>';
  for (const row of usableRows) list.append(contactRow(row));
  root.append(list);
  if (qrPayload) root.append(qrCard(qrPayload, qrLabel));
}

function renderPaymentTab(root, kind) {
  root.className = `content-card tab-${kind} has-qr`;
  const isPayPal = kind === 'paypal';
  const title = isPayPal ? 'PayPal' : 'Bank';
  const payload = isPayPal ? QrPayload.paypal(state.data, state.amount) : QrPayload.girocode(state.data, state.amount, state.purpose);
  const link = QrPayload.paypal(state.data, state.amount);
  root.innerHTML = `<div class="panel-head"><div><h2>${title}</h2><p>${isPayPal ? 'paypal.me Zahlungslink.' : 'SEPA GiroCode / EPC-QR.'}</p></div></div>`;
  const box = document.createElement('div');
  box.className = 'amount-card';
  box.innerHTML = `
    <label class="field"><span>Betrag</span><input id="amountInput" inputmode="decimal" autocomplete="off" value="${esc(state.amount)}" placeholder="z. B. 12,50"></label>
    <div class="chips">${AMOUNTS.map(v => `<button class="chip ${normalizeAmount(state.amount) === Number(v).toFixed(2) ? 'active' : ''}" data-amount="${v}" type="button">${v} €</button>`).join('')}</div>
    ${isPayPal ? '' : `<label class="field"><span>Verwendungszweck</span><input id="purposeInput" autocomplete="off" value="${esc(state.purpose)}" placeholder="Optional"></label>`}`;
  root.append(box);
  $('#amountInput', box).addEventListener('input', e => { state.amount = e.target.value; sessionStorage.setItem('dv2.amount', state.amount); renderTab(); });
  $$('.chip', box).forEach(chip => chip.addEventListener('click', () => { state.amount = Number(chip.dataset.amount).toFixed(2); sessionStorage.setItem('dv2.amount', state.amount); renderTab(); }));
  $('#purposeInput', box)?.addEventListener('input', e => { state.purpose = e.target.value; sessionStorage.setItem('dv2.purpose', state.purpose); renderTab(); });
  const info = document.createElement('div');
  info.className = 'qr-caption';
  info.innerHTML = isPayPal
    ? `<b>Empfänger:</b> ${esc(state.data.n || '—')}<br><span class="link-line">${esc(link)}</span>`
    : `<b>Empfänger:</b> ${esc(state.data.n || '—')}<br><b>IBAN:</b> ${esc(formatIban(state.data.ib))}<br><b>BIC:</b> ${esc((state.data.bic || '').toUpperCase())}`;
  root.append(qrCard(payload, `${title} QR`, info));
}

function contactRow({ icon, label, value, href }) {
  const node = document.createElement(href ? 'a' : 'div');
  node.className = 'contact-row';
  if (href) node.href = href;
  node.innerHTML = `<span class="ico">${icon}</span><span><b>${esc(label)}</b><span>${esc(value)}</span></span>`;
  bindLongPress(node, () => copyText(value));
  return node;
}

function qrCard(payload, label, extraNode) {
  const wrap = document.createElement('div');
  wrap.className = 'qr-card';
  const qr = document.createElement('div');
  renderQr(qr, payload, { size: 512 });
  qr.addEventListener('click', () => openQrOverlay(payload));
  wrap.append(qr);
  if (extraNode) wrap.append(extraNode); else wrap.insertAdjacentHTML('beforeend', `<div class="qr-caption">${esc(label)}</div>`);
  return wrap;
}

async function openQrOverlay(payload) {
  const overlay = $('#qrOverlay');
  renderQr($('#qrBig'), payload, { size: 900, className: '' });
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
    { icon: '📱', label: 'Handy', value: state.data.m, href: state.data.m ? `tel:${state.data.m}` : '' },
    { icon: '✉️', label: 'E-Mail', value: state.data.e1, href: state.data.e1 ? `mailto:${state.data.e1}` : '' },
    { icon: '📍', label: 'Privatadresse', value: address, href: address ? `https://maps.google.com/?q=${encodeURIComponent([state.data.s, state.data.z].filter(Boolean).join(' '))}` : '' }
  ];
}
function companyRows() {
  const companyAddress = [state.data.cs, state.data.cz].filter(Boolean).join(', ');
  return [
    { icon: '🏢', label: 'Firma', value: state.data.c }, { icon: '💼', label: 'Position', value: state.data.j },
    { icon: '☎️', label: 'Büro', value: state.data.cp, href: state.data.cp ? `tel:${state.data.cp}` : '' },
    { icon: '📲', label: 'Dienst-Handy', value: state.data.cm, href: state.data.cm ? `tel:${state.data.cm}` : '' },
    { icon: '✉️', label: 'Firmen-E-Mail', value: state.data.ce, href: state.data.ce ? `mailto:${state.data.ce}` : '' },
    { icon: '🌐', label: 'Webseite', value: state.data.w, href: state.data.w ? normalizeUrl(state.data.w) : '' },
    { icon: '📍', label: 'Geschäftsadresse', value: companyAddress, href: companyAddress ? `https://maps.google.com/?q=${encodeURIComponent([state.data.cs, state.data.cz].filter(Boolean).join(' '))}` : '' }
  ];
}

async function shareCurrentTab() {
  const text = buildShareText();
  try {
    if (navigator.share) await navigator.share({ title: 'Digitale Visitenkarte', text });
    else await copyText(text);
  } catch (error) { if (error.name !== 'AbortError') toast(error.message); }
}
function buildShareText() {
  const d = state.data;
  if (state.activeTab === 'privat') return [d.n, d.m, d.e1, [d.s, d.z].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  if (state.activeTab === 'firma') return [d.n, d.c, d.j, d.cp, d.cm, d.ce, d.w, [d.cs, d.cz].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  if (state.activeTab === 'paypal') return [`Empfänger: ${d.n}`, `PayPal: ${QrPayload.paypal(d, state.amount)}`, normalizeAmount(state.amount) ? `Betrag: ${normalizeAmount(state.amount)} €` : ''].filter(Boolean).join('\n');
  return [`Empfänger: ${d.n}`, `IBAN: ${formatIban(d.ib)}`, `BIC: ${(d.bic || '').toUpperCase()}`, normalizeAmount(state.amount) ? `Betrag: ${normalizeAmount(state.amount)} €` : '', state.purpose ? `Zweck: ${state.purpose}` : ''].filter(Boolean).join('\n');
}

function openSettings() {
  openSheet('Einstellungen', `
    <div class="settings-list">
      <div class="settings-section"><h3>Konto</h3>
        <button class="btn tonal" data-action="edit">Daten bearbeiten</button>
        <button class="btn tonal" data-action="password">Passwort ändern</button>
      </div>
      <div class="settings-section"><h3>Profilbild</h3>
        <label class="btn tonal">Bild auswählen<input id="avatarFile" type="file" accept="image/*" hidden></label>
        <button class="btn tonal" data-action="avatar-remove">Profilbild entfernen</button>
        <p class="muted">Optional und aktuell lokal auf diesem Gerät gespeichert.</p>
      </div>
      <div class="settings-section"><h3>Sicherheit</h3>
        <button class="btn tonal" data-action="pin">PIN einrichten/ändern</button>
        <button class="btn tonal" data-action="passkey">Passkey / Biometrie einrichten</button>
      </div>
      <div class="settings-section"><h3>Darstellung</h3>
        <div class="option-grid">${THEMES.map(t => `<button class="btn small tonal" data-theme-pick="${t}">${labelTheme(t)}</button>`).join('')}</div>
        <hr class="soft"><div class="option-grid">${MODES.map(m => `<button class="btn small tonal" data-mode-pick="${m}">${labelMode(m)}</button>`).join('')}</div>
      </div>
      <div class="settings-section"><h3>Backup</h3>
        <button class="btn tonal" data-action="export">Token exportieren</button>
        <label class="btn tonal">Token importieren<input id="importFile" type="file" accept="application/json,.json,.txt" hidden></label>
      </div>
      <div class="settings-section"><h3>Session</h3>
        <button class="btn warn" data-action="lock">Tresor sperren</button>
        <button class="btn warn" data-action="logout">Abmelden / Schnell-Logins löschen</button>
        <p class="muted">Zuletzt aktualisiert: ${state.updated ? esc(formatDate(state.updated)) : '—'}</p>
      </div>
      <div class="settings-section"><h3>Server</h3><label class="field"><span>Shared Secret</span><input id="secretInput" type="password" value="${esc(Store.getSecret())}"></label><button class="btn tonal" data-action="secret">Secret speichern</button></div>
    </div>`);
  $('#sheetBody').onclick = settingsClick;
  $('#sheetBody').onchange = settingsChange;
}

async function settingsClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  const theme = e.target.closest('[data-theme-pick]')?.dataset.themePick;
  const mode = e.target.closest('[data-mode-pick]')?.dataset.modePick;
  if (theme) { localStorage.setItem('dv2.theme', theme); applyTheme(); return; }
  if (mode) { localStorage.setItem('dv2.mode', mode); applyTheme(); return; }
  if (!action) return;
  if (action === 'edit') openProfileProgress(0, false);
  if (action === 'password') openPasswordSheet();
  if (action === 'pin') openPinSetup(false);
  if (action === 'passkey') setupPasskey();
  if (action === 'export') { Store.exportToken({ token: state.token, updated: state.updated }); toast('Export gestartet.'); }
  if (action === 'lock') location.reload();
  if (action === 'logout') { Auth.clearPin(); Auth.clearPasskey(); localStorage.removeItem('dv2.sharedSecret'); location.reload(); }
  if (action === 'avatar-remove') { localStorage.removeItem('dv2.avatar'); updateAvatar(); toast('Profilbild entfernt.'); }
  if (action === 'secret') { Store.setSecret($('#secretInput').value); toast('Secret gespeichert.'); }
}
async function settingsChange(e) {
  if (e.target.id === 'avatarFile' && e.target.files[0]) {
    try {
      const avatar = await fileToDataUrl(e.target.files[0]);
      localStorage.setItem('dv2.avatar', avatar);
      updateAvatar();
      toast('Profilbild gespeichert.');
    } catch (error) { toast(error.message); }
    return;
  }
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  try {
    const imported = await Store.importToken(e.target.files[0]);
    const saved = await Store.saveToken(imported.token);
    state.token = saved.token; state.updated = saved.updated;
    closeSheet(); showLogin(); toast('Token importiert. Bitte entsperren.');
  } catch (error) { toast(error.message); }
}

function openEditSheet() {
  openProfileProgress(0, false);
}

function openProfileProgress(stepIndex = 0, firstRun = false) {
  let index = Math.max(0, Math.min(PROFILE_STEPS.length - 1, stepIndex));
  let draft = normalizeData(state.data || {});

  const render = () => {
    const step = PROFILE_STEPS[index];
    const completed = PROFILE_STEPS.filter(item => stepCompletion(item, draft).done).length;
    const body = document.createElement('div');
    body.className = 'profile-progress';
    body.innerHTML = `
      <div class="progress-summary">
        <div>
          <p class="eyebrow">Fortschritt</p>
          <h3>${esc(completed)} von ${PROFILE_STEPS.length} Bereichen</h3>
          <p class="muted">${firstRun ? 'Fülle dein Profil in getrennten Schritten aus. Alles bleibt optional und verschlüsselt.' : 'Bearbeite jeden Bereich getrennt. Änderungen werden verschlüsselt gespeichert.'}</p>
        </div>
        <div class="progress-ring" aria-label="${esc(completed)} von ${PROFILE_STEPS.length} Bereichen vollständig">${esc(completed)}/${PROFILE_STEPS.length}</div>
      </div>
      <div class="progress-track" aria-hidden="true"><span style="width:${Math.round((index + 1) / PROFILE_STEPS.length * 100)}%"></span></div>
      <ol class="stepper" aria-label="Profilfortschritt">
        ${PROFILE_STEPS.map((item, i) => {
          const status = stepCompletion(item, draft);
          const stateClass = i === index ? 'active' : i < index ? 'done' : '';
          return `<li class="${stateClass}"><span>${status.done ? '✓' : i + 1}</span><div><b>${esc(item.title)}</b><small>${status.count}/${item.fields.length} Felder</small></div></li>`;
        }).join('')}
      </ol>
      <form id="profileStepForm" class="stack">
        <div class="step-panel">
          <p class="eyebrow">Schritt ${index + 1}</p>
          <h3>${esc(step.title)}</h3>
          <p class="muted">${esc(step.hint)}</p>
          <div class="setup-grid" id="profileStepFields"></div>
        </div>
        <div class="progress-actions">
          <button class="btn tonal" type="button" data-progress-back ${index === 0 ? 'disabled' : ''}>Zurück</button>
          <button class="btn ghost" type="button" data-progress-close>${firstRun ? 'Später' : 'Schließen'}</button>
          <button class="btn primary" type="submit">${index === PROFILE_STEPS.length - 1 ? 'Fertig' : 'Speichern & weiter'}</button>
        </div>
      </form>`;

    openSheet(firstRun ? 'Profil vervollständigen' : 'Daten bearbeiten', body);
    renderSetupFields($('#profileStepFields'), draft, fieldDefs(step.fields));

    $('#profileStepForm').addEventListener('submit', async event => {
      event.preventDefault();
      draft = normalizeData({ ...draft, ...collectForm(event.currentTarget) });
      try {
        await saveCurrentData(draft, false);
        if (index === PROFILE_STEPS.length - 1) {
          closeSheet();
          toast('Profil gespeichert.');
        } else {
          index += 1;
          toast('Gespeichert.');
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
  openSheet('Passwort ändern', `<form id="passwordChange" class="stack"><label class="field"><span>Neues Master-Passwort</span><input id="newPassword" type="password" minlength="8" required></label><button class="btn primary" type="submit">Neu verschlüsseln</button></form>`);
  $('#passwordChange').addEventListener('submit', async e => {
    e.preventDefault();
    const newPassword = $('#newPassword').value;
    if (newPassword.length < 8) return toast('Passwort muss mindestens 8 Zeichen haben.');
    try {
      state.masterPassword = newPassword;
      await saveCurrentData(state.data);
      Auth.clearPin(); Auth.clearPasskey();
      closeSheet(); toast('Passwort geändert. PIN/Passkey bitte neu einrichten.');
    } catch (error) { toast(error.message); }
  });
}

function openPinSetup(firstRun) {
  openSheet('PIN einrichten', `<p class="muted">Die PIN verschlüsselt dein Master-Passwort lokal. Im Speicher liegt nur ein AES-GCM-Blob, kein Klartext-Passwort.</p><form id="pinSetupForm" class="stack"><label class="field"><span>Neue PIN (4–6 Ziffern)</span><input id="newPin" inputmode="numeric" pattern="\\d{4,6}" autocomplete="off" required></label><button class="btn primary" type="submit">PIN speichern</button>${firstRun ? '<button class="btn ghost" type="button" data-close-sheet>Später</button>' : ''}</form>`);
  $('#pinSetupForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await Auth.savePin($('#newPin').value, state.masterPassword); closeSheet(); toast('PIN gespeichert.'); }
    catch (error) { toast(error.message); }
  });
  $$('[data-close-sheet]', $('#sheet')).forEach(n => n.addEventListener('click', closeSheet));
}

async function setupPasskey() {
  try { await Auth.setupPasskey(state.masterPassword); toast('Passkey eingerichtet.'); }
  catch (error) { toast(error.message); }
}

async function saveCurrentData(data, refresh = true) {
  const token = await encryptJson(data, state.masterPassword);
  const saved = await Store.saveToken(token);
  state.data = data; state.token = saved.token; state.updated = saved.updated;
  if (refresh) showVault();
  else {
    updateVaultHeader();
    renderTab();
  }
}

function openSheet(title, body) {
  $('#sheetTitle').textContent = title;
  const sheetBody = $('#sheetBody');
  if (typeof body === 'string') sheetBody.innerHTML = body;
  else sheetBody.replaceChildren(body);
  $('#sheet').classList.remove('hidden');
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetBody').replaceChildren(); }

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
  return out;
}

function updateAvatar() {
  const wrap = $('#heroAvatarWrap');
  const img = $('#heroAvatar');
  const initialsNode = $('#heroInitials');
  const avatar = localStorage.getItem('dv2.avatar') || '';
  initialsNode.textContent = initials(state.data?.n);
  if (!avatar) {
    wrap.classList.remove('has-image');
    img.removeAttribute('src');
    img.hidden = true;
    return;
  }
  img.src = avatar;
  img.hidden = false;
  img.onerror = () => {
    wrap.classList.remove('has-image');
    img.hidden = true;
    img.removeAttribute('src');
  };
  img.onload = () => {
    wrap.classList.add('has-image');
    img.hidden = false;
  };
  if (img.complete && img.naturalWidth > 0) {
    wrap.classList.add('has-image');
    img.hidden = false;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Bitte ein Bild auswählen.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function buildPinPad() {
  const grid = $('.pin-grid');
  const chars = ['1','2','3','4','5','6','7','8','9','←','0','OK'];
  let value = '';
  let handler = null;
  const paint = () => $('#pinDots').innerHTML = Array.from({ length: 6 }, (_, i) => `<span class="${i < value.length ? 'filled' : ''}"></span>`).join('');
  for (const ch of chars) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = ch;
    btn.addEventListener('click', async () => {
      vibrate();
      if (/\d/.test(ch) && value.length < 6) value += ch;
      if (ch === '←') value = value.slice(0, -1);
      if (ch === 'OK' && handler) { const pin = value; value = ''; paint(); $('#pinPad').classList.add('hidden'); await handler(pin); }
      paint();
    });
    grid.append(btn);
  }
  $('#pinCancel').addEventListener('click', () => { value = ''; $('#pinPad').classList.add('hidden'); paint(); });
  window.openPinPad = cb => { handler = cb; value = ''; paint(); $('#pinPad').classList.remove('hidden'); };
}
function openPinPad(callback) { window.openPinPad(callback); }

function bindLongPress(node, callback) {
  let timer;
  node.addEventListener('pointerdown', () => timer = setTimeout(() => { callback(); vibrate(); }, 520));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(e => node.addEventListener(e, () => clearTimeout(timer)));
}
async function copyText(text) { await navigator.clipboard.writeText(text); toast('Kopiert.'); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2600); }
function vibrate() { if (navigator.vibrate) navigator.vibrate(8); }
function applyTheme() { document.body.dataset.theme = localStorage.getItem('dv2.theme') || 'teal'; document.body.dataset.mode = localStorage.getItem('dv2.mode') || 'auto'; }
function initials(name = '') { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || 'DV'; }
function formatDate(value) { try { return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return value; } }
function normalizeUrl(url) { return /^https?:\/\//i.test(url) ? url : `https://${url}`; }
function labelTheme(t) { return ({ teal: 'Teal', wald: 'Wald', ozean: 'Ozean', rose: 'Rose', lavendel: 'Lavendel', graphit: 'Graphit' })[t] || t; }
function labelMode(m) { return ({ auto: 'Auto', light: 'Hell', dark: 'Dunkel' })[m] || m; }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]); }
