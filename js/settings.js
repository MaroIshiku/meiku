import { Auth } from './auth.js?v=0.4.3';
import { createVault, tokenVersion, VAULT_VERSION } from './crypto.js?v=0.4.3';
import { $, $$, esc, menuRow, Sheet, toast } from './dom.js?v=0.4.3';
import { icon } from './icons.js?v=0.4.3';
import { fieldDefs, FIELD_KEYS, initials, LEGACY_AVATAR_KEY, MAX_AVATAR_CHARS, normalizeData, passwordStrength, PROFILE_STEPS, stepCount } from './profile.js?v=0.4.3';
import { Store } from './store.js?v=0.4.3';
import { PSU_MODES, PSU_THEMES, setPixelSoftUtilityMode, setPixelSoftUtilityTheme } from '../design-system/theme-controller.js?v=0.4.3';

export const MIN_NEW_PASSWORD_LENGTH = 12;
const THEME_LABELS = { lavender: 'Lavender', mint: 'Mint', sky: 'Sky', amber: 'Amber', rose: 'Rose', graphite: 'Graphite' };
const MODE_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };

export function checkNewPassword(password, confirmation) {
  if (password.length < MIN_NEW_PASSWORD_LENGTH) return `Use at least ${MIN_NEW_PASSWORD_LENGTH} characters.`;
  if (password !== confirmation) return 'The passwords do not match.';
  return '';
}

/** Renders input fields for profile keys. */
export function renderFields(root, data, defs) {
  const frag = document.createDocumentFragment();
  for (const [key, label, type, required, autocomplete, inputmode] of defs) {
    const field = document.createElement('label');
    field.className = 'psu-field';
    field.innerHTML = `<span class="psu-label">${esc(label)}${required ? ' (required)' : ''}</span><input class="psu-input" name="${key}" type="${type}" value="${esc(data[key] || '')}" autocomplete="${autocomplete || 'off'}"${inputmode ? ` inputmode="${inputmode}"` : ''}${required ? ' required' : ''}${key === 'ib' || key === 'bic' ? ' autocapitalize="characters" spellcheck="false"' : ''}>`;
    frag.append(field);
  }
  root.replaceChildren(frag);
}

export function collectForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => { if (FIELD_KEYS.has(key)) data[key] = String(value).trim(); });
  return data;
}

/** Wires a password field to the strength meter next to it. */
export function bindStrength(input, meter) {
  const update = () => {
    const { level, label } = passwordStrength(input.value);
    meter.dataset.level = String(level);
    meter.hidden = !input.value;
    $('[data-strength-label]', meter).textContent = label;
  };
  input.addEventListener('input', update);
  update();
}

export function strengthMeter() {
  return `<div class="meiku-strength" data-level="0" hidden aria-live="polite"><span class="meiku-strength__bar"><span></span></span><small data-strength-label></small></div>`;
}

/** Inline server-secret field, shown only when this session has no secret yet. */
function secretFieldMarkup() {
  if (Store.getSecret()) return '';
  return `<label class="psu-field meiku-secret-field"><span class="psu-label">Server secret</span><input class="psu-input" name="serverSecret" type="password" autocomplete="off" spellcheck="false">
    <small class="meiku-help">Needed once per session to save. The value of <code>ISHIKU_SETUP_SECRET</code>.</small></label>`;
}

/** Stores the inline secret if the form has one; throws a readable error when invalid. */
function applySecretField(form) {
  const input = form.querySelector('[name="serverSecret"]');
  if (input) Store.setSecret(input.value);
}

export function createSettings(ctx) {
  const { state } = ctx;

  // ---- Main settings sheet ---------------------------------------------
  function openSettings() {
    const d = state.data;
    const secretSet = Boolean(Store.getSecret());
    const theme = document.documentElement.dataset.theme;
    const mode = document.documentElement.dataset.mode;
    Sheet.open({ title: 'Settings', body: `
      <section class="psu-account-card meiku-account">
        <button class="psu-account-avatar meiku-account__avatar" type="button" data-action="avatar" aria-label="Change profile picture">
          ${d.av ? `<img src="${esc(d.av)}" alt="">` : esc(initials(d.n))}
          <span class="meiku-account__camera" aria-hidden="true">${icon('camera')}</span>
        </button>
        <div>
          <p class="psu-account-name">${esc(d.n)}</p>
          <p class="psu-account-id">${esc(d.e1 || d.ce || 'Encrypted profile vault')}</p>
        </div>
      </section>
      <div class="meiku-group">
        ${menuRow({ action: 'edit', iconName: 'edit', title: 'Edit details', support: 'Contact, business, PayPal and bank' })}
        ${menuRow({ action: 'avatar', iconName: 'image', title: 'Profile picture', support: d.av ? 'Change or remove' : 'Add a picture' })}
      </div>

      <h3 class="meiku-section-title">Appearance</h3>
      <div class="psu-tonal-card meiku-appearance">
        <div class="meiku-swatches" role="group" aria-label="Theme">
          ${PSU_THEMES.map(t => `<button type="button" class="meiku-swatch" data-theme-choice="${t}" data-swatch="${t}" aria-pressed="${t === theme}"><span aria-hidden="true">${icon('check')}</span>${THEME_LABELS[t]}</button>`).join('')}
        </div>
        <div class="psu-segmented-control meiku-mode" role="tablist" aria-label="Color mode">
          ${PSU_MODES.map(m => `<button type="button" role="tab" data-mode-choice="${m}" aria-selected="${m === mode}">${MODE_LABELS[m]}</button>`).join('')}
        </div>
      </div>

      <h3 class="meiku-section-title">Vault</h3>
      <div class="meiku-group">
        ${menuRow({ action: 'password', iconName: 'lock', title: 'Master password', support: 'Change and re-encrypt the vault' })}
        ${menuRow({ action: 'pin', iconName: 'pin', title: 'PIN unlock', support: 'Quick unlock on this device', value: Auth.hasPin() ? 'On' : 'Off' })}
        ${menuRow({ action: 'secret', iconName: 'key', title: 'Server secret', support: 'Needed to save changes', value: secretSet ? 'Saved' : 'Missing' })}
        ${menuRow({ action: 'export', iconName: 'download', title: 'Export backup', support: 'Download the encrypted vault' })}
        ${menuRow({ action: 'import', iconName: 'upload', title: 'Import backup', support: 'Replace the vault with a backup' })}
        ${menuRow({ action: 'lock', iconName: 'lock', title: 'Lock now', support: 'Return to the unlock screen' })}
      </div>
      <input id="importFile" type="file" accept="application/json,.json,.txt" hidden>

      <h3 class="meiku-section-title">About</h3>
      <div class="meiku-group">
        ${menuRow({ action: 'about', iconName: 'info', title: 'About Meiku', support: 'Version and build information' })}
      </div>

      <div class="meiku-group">
        ${menuRow({ action: 'signout', iconName: 'logout', title: 'Sign out on this device', support: 'Removes PIN, server secret and remembered name here', danger: true })}
      </div>` });
    const body = $('#sheetBody');
    body.onclick = settingsClick;
    body.onchange = event => { if (event.target.id === 'importFile' && event.target.files[0]) importBackup(event.target); };
  }

  async function settingsClick(event) {
    const theme = event.target.closest('[data-theme-choice]')?.dataset.themeChoice;
    if (theme) {
      setPixelSoftUtilityTheme(theme);
      $$('[data-theme-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === theme)));
      return;
    }
    const mode = event.target.closest('[data-mode-choice]')?.dataset.modeChoice;
    if (mode) {
      setPixelSoftUtilityMode(mode);
      $$('[data-mode-choice]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.modeChoice === mode)));
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit') openEditor(0, false, openSettings);
    if (action === 'avatar') openAvatar();
    if (action === 'password') openPassword();
    if (action === 'pin') openPin();
    if (action === 'secret') openSecret(openSettings);
    if (action === 'export') { Store.exportToken({ token: state.token, updated: state.updated }); toast('Backup downloaded.'); }
    if (action === 'import') $('#importFile').click();
    if (action === 'lock') ctx.lockVault();
    if (action === 'about') openAbout();
    if (action === 'signout') confirm('Sign out on this device?', 'This removes the PIN, the server secret and the remembered name from this browser. The vault on the server is not changed.', 'Sign out', true, () => ctx.signOut());
  }

  // ---- Confirm -------------------------------------------------------------
  function confirm(title, message, label, danger, onConfirm, back = openSettings) {
    Sheet.open({ title, back, body: `
      <p class="meiku-sheet-text">${esc(message)}</p>
      <div class="meiku-sheet-actions">
        <button class="psu-button psu-button--${danger ? 'danger' : 'filled'} psu-button--full" type="button" data-confirm>${esc(label)}</button>
        <button class="psu-button psu-button--text psu-button--full" type="button" data-cancel>Cancel</button>
      </div>` });
    const body = $('#sheetBody');
    body.onchange = null;
    body.onclick = async event => {
      if (event.target.closest('[data-cancel]')) { back ? back() : Sheet.close(); return; }
      const button = event.target.closest('[data-confirm]');
      if (!button) return;
      button.disabled = true;
      try { await onConfirm(); } catch (error) { button.disabled = false; toast(error.message); }
    };
  }

  // ---- Import --------------------------------------------------------------
  async function importBackup(input) {
    const file = input.files[0];
    input.value = '';
    try {
      const imported = await Store.importToken(file);
      if (![2, VAULT_VERSION].includes(tokenVersion(imported.token))) throw new Error('This file is not a supported Meiku backup.');
      confirm('Replace vault?', 'The vault on the server is replaced by this backup. Export the current vault first if you may need it. You need the password of the backup to unlock it.', 'Replace and import', true, async () => {
        const saved = await Store.saveToken(imported.token, state.revision);
        Object.assign(state, { token: saved.token, updated: saved.updated, revision: saved.revision, data: null, session: null, needsUpgrade: false });
        Sheet.close();
        ctx.showUnlock('password');
        toast('Backup imported. Unlock it with its password.');
      });
    } catch (error) { toast(error.message); }
  }

  // ---- Profile editor --------------------------------------------------------
  function openEditor(stepIndex = 0, firstRun = false, back = null) {
    let index = Math.max(0, Math.min(PROFILE_STEPS.length - 1, stepIndex));
    let draft = normalizeData(state.data || {});

    const render = () => {
      const step = PROFILE_STEPS[index];
      const last = index === PROFILE_STEPS.length - 1;
      const body = document.createElement('div');
      body.className = 'meiku-editor';
      body.innerHTML = `
        ${firstRun ? '<p class="meiku-sheet-text">Every step is optional except your name, and everything is stored encrypted. You can change it any time in Settings.</p>' : ''}
        <ol class="meiku-stepper" aria-label="Sections">
          ${PROFILE_STEPS.map((item, i) => {
            const count = stepCount(item, draft);
            return `<li><button type="button" data-step="${i}" ${i === index ? 'aria-current="step"' : ''}><b>${esc(item.title)}</b><small>${count}/${item.fields.length}</small></button></li>`;
          }).join('')}
        </ol>
        <form id="editorForm" class="psu-form-stack" novalidate>
          <p class="meiku-sheet-text">${esc(step.hint)}</p>
          <div class="psu-form-stack" id="editorFields"></div>
          ${secretFieldMarkup()}
          <p class="psu-field-error" id="editorError" role="alert" hidden></p>
          <div class="meiku-sheet-actions">
            <button class="psu-button psu-button--filled psu-button--full" type="submit">${last ? 'Save and finish' : 'Save and continue'}</button>
            <button class="psu-button psu-button--text psu-button--full" type="button" data-editor-close>${firstRun ? 'Finish later' : 'Close without saving'}</button>
          </div>
        </form>`;
      Sheet.open({ title: firstRun ? 'Complete your profile' : 'Edit details', body, back });
      renderFields($('#editorFields'), draft, fieldDefs(step.fields));
      const keepDraft = () => { draft = normalizeData({ ...draft, ...collectForm($('#editorForm')) }); };
      $$('[data-step]', body).forEach(button => button.addEventListener('click', () => { keepDraft(); index = Number(button.dataset.step); render(); }));
      $('[data-editor-close]', body).addEventListener('click', () => (back ? back() : Sheet.close()));
      $('#editorForm').addEventListener('submit', async event => {
        event.preventDefault();
        keepDraft();
        const error = $('#editorError');
        if (!draft.n) { error.textContent = 'Your name is required.'; error.hidden = false; return; }
        if (draft.ib && !ctx.isValidIban(draft.ib) && step.id === 'bank') { error.textContent = 'This IBAN is not valid. Check it or leave the field empty.'; error.hidden = false; return; }
        const submit = event.submitter || $('button[type="submit"]', body);
        submit.disabled = true;
        try {
          applySecretField(event.currentTarget);
          await ctx.saveCurrentData(draft);
          if (last) { back ? back() : Sheet.close(); toast('Profile saved.'); }
          else { index += 1; render(); toast('Saved.'); }
        } catch (err) {
          submit.disabled = false;
          error.textContent = err.message;
          error.hidden = false;
        }
      });
    };
    render();
  }

  // ---- Profile picture ------------------------------------------------------
  function openAvatar() {
    const d = state.data;
    Sheet.open({ title: 'Profile picture', back: openSettings, body: `
      <div class="meiku-avatar-preview">${d.av ? `<img src="${esc(d.av)}" alt="Current profile picture">` : `<span aria-hidden="true">${esc(initials(d.n))}</span>`}</div>
      <p class="meiku-sheet-text">The picture is cropped to a square and stored encrypted inside your vault.</p>
      <div class="meiku-sheet-actions">
        <label class="psu-button psu-button--filled psu-button--full meiku-file-button">${icon('image')}Choose picture<input id="avatarFile" type="file" accept="image/*" class="psu-visually-hidden"></label>
        ${d.av ? '<button class="psu-button psu-button--text psu-button--full" type="button" data-remove-avatar>Remove picture</button>' : ''}
      </div>` });
    const body = $('#sheetBody');
    body.onclick = async event => {
      if (!event.target.closest('[data-remove-avatar]')) return;
      try {
        await ctx.saveCurrentData({ ...state.data, av: '' });
        localStorage.removeItem(LEGACY_AVATAR_KEY);
        toast('Profile picture removed.');
        openAvatar();
      } catch (error) { toast(error.message); }
    };
    body.onchange = async event => {
      if (event.target.id !== 'avatarFile' || !event.target.files[0]) return;
      try { await openAvatarCrop(event.target.files[0]); } catch (error) { toast(error.message); }
    };
  }

  async function openAvatarCrop(file) {
    if (!file.type.startsWith('image/')) throw new Error('Please choose an image.');
    const image = await loadImage(file);
    const crop = { zoom: 1, x: 0, y: 0 };
    Sheet.open({ title: 'Crop picture', back: openAvatar, body: `
      <form id="cropForm" class="psu-form-stack">
        <canvas id="cropPreview" class="meiku-crop" width="280" height="280" role="img" aria-label="Preview of the cropped picture"></canvas>
        <label class="psu-field"><span class="psu-label">Zoom</span><input id="cropZoom" type="range" min="1" max="3" step="0.01" value="1"></label>
        <label class="psu-field"><span class="psu-label">Horizontal position</span><input id="cropX" type="range" min="-100" max="100" step="1" value="0"></label>
        <label class="psu-field"><span class="psu-label">Vertical position</span><input id="cropY" type="range" min="-100" max="100" step="1" value="0"></label>
        ${secretFieldMarkup()}
        <div class="meiku-sheet-actions">
          <button class="psu-button psu-button--filled psu-button--full" type="submit">Save picture</button>
        </div>
      </form>` });
    const preview = $('#cropPreview');
    const draw = () => drawCrop(preview, image, crop, 280);
    $('#cropZoom').addEventListener('input', e => { crop.zoom = Number(e.target.value); draw(); });
    $('#cropX').addEventListener('input', e => { crop.x = Number(e.target.value); draw(); });
    $('#cropY').addEventListener('input', e => { crop.y = Number(e.target.value); draw(); });
    $('#cropForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        applySecretField(e.currentTarget);
        await ctx.saveCurrentData({ ...state.data, av: avatarDataUrl(image, crop) });
        localStorage.removeItem(LEGACY_AVATAR_KEY);
        toast('Profile picture saved.');
        openSettings();
      } catch (error) { toast(error.message); }
    });
    draw();
  }

  // ---- Master password --------------------------------------------------------
  function openPassword() {
    Sheet.open({ title: 'Master password', back: openSettings, body: `
      <form id="passwordForm" class="psu-form-stack" novalidate>
        <p class="meiku-sheet-text">The vault is re-encrypted with a new key. Other devices and every PIN need the new password afterwards.</p>
        <input type="text" name="username" autocomplete="username" value="Meiku vault" class="psu-visually-hidden" tabindex="-1" aria-hidden="true">
        <label class="psu-field"><span class="psu-label">New master password</span><input class="psu-input" id="newPassword" type="password" autocomplete="new-password" required></label>
        ${strengthMeter()}
        <label class="psu-field"><span class="psu-label">Repeat new master password</span><input class="psu-input" id="newPasswordConfirm" type="password" autocomplete="new-password" required></label>
        <p class="psu-password-requirements">At least ${MIN_NEW_PASSWORD_LENGTH} characters. A few random words make a strong, memorable password.</p>
        ${secretFieldMarkup()}
        <p class="psu-field-error" id="passwordError" role="alert" hidden></p>
        <div class="meiku-sheet-actions"><button class="psu-button psu-button--filled psu-button--full" type="submit">Change password</button></div>
      </form>` });
    bindStrength($('#newPassword'), $('.meiku-strength'));
    $('#passwordForm').addEventListener('submit', async event => {
      event.preventDefault();
      const error = $('#passwordError');
      const password = $('#newPassword').value;
      const problem = checkNewPassword(password, $('#newPasswordConfirm').value);
      if (problem) { error.textContent = problem; error.hidden = false; return; }
      const submit = $('#passwordForm button[type="submit"]');
      submit.disabled = true;
      try {
        applySecretField(event.currentTarget);
        const session = await createVault(password);
        await ctx.saveCurrentData(state.data, session);
        Auth.clearPin(); Auth.clearDeprecatedPasskey();
        Sheet.close();
        toast('Password changed. Set up your PIN again if you use one.');
      } catch (err) { submit.disabled = false; error.textContent = err.message; error.hidden = false; }
    });
  }

  // ---- PIN --------------------------------------------------------------------
  function openPin() {
    const enabled = Auth.hasPin();
    Sheet.open({ title: 'PIN unlock', back: openSettings, body: `
      <form id="pinForm" class="psu-form-stack" novalidate>
        <p class="meiku-sheet-text">${enabled ? 'PIN unlock is on for this device. Enter a new PIN to replace it.' : 'Unlock this device with a 6-digit PIN instead of the master password.'} The PIN encrypts the vault key and the server secret locally; the master password is never stored.</p>
        <label class="psu-field"><span class="psu-label">New 6-digit PIN</span><input class="psu-input meiku-pin-input" id="newPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" required></label>
        <label class="psu-field"><span class="psu-label">Repeat PIN</span><input class="psu-input meiku-pin-input" id="newPinConfirm" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" required></label>
        <p class="psu-field-error" id="pinError" role="alert" hidden></p>
        <div class="meiku-sheet-actions">
          <button class="psu-button psu-button--filled psu-button--full" type="submit">${enabled ? 'Change PIN' : 'Turn on PIN unlock'}</button>
          ${enabled ? '<button class="psu-button psu-button--text psu-button--full" type="button" data-remove-pin>Turn off PIN unlock</button>' : ''}
        </div>
      </form>` });
    $('[data-remove-pin]')?.addEventListener('click', () => { Auth.clearPin(); toast('PIN unlock turned off.'); openSettings(); });
    $('#pinForm').addEventListener('submit', async event => {
      event.preventDefault();
      const error = $('#pinError');
      const pin = $('#newPin').value;
      const show = message => { error.textContent = message; error.hidden = false; };
      if (!/^\d{6}$/.test(pin)) return show('The PIN must have exactly 6 digits.');
      if (pin !== $('#newPinConfirm').value) return show('The PINs do not match.');
      if (/^(\d)\1{5}$/.test(pin) || ['123456', '654321', '012345', '123123'].includes(pin)) return show('This PIN is too easy to guess. Choose another one.');
      try {
        if (state.needsUpgrade || tokenVersion(state.token) !== VAULT_VERSION) {
          if (!Store.getSecret()) throw new Error('Save the server secret first so the vault can be upgraded before setting up a PIN.');
          await ctx.saveCurrentData(state.data);
        }
        await Auth.savePin(pin, state.session, Store.getSecret());
        toast('PIN unlock is on.');
        openSettings();
      } catch (err) { show(err.message); }
    });
  }

  // ---- Server secret ------------------------------------------------------------
  function openSecret(back = openSettings, onSaved = null) {
    Sheet.open({ title: 'Server secret', back, body: `
      <form id="secretForm" class="psu-form-stack" novalidate>
        <p class="meiku-sheet-text">The server only accepts changes with this secret. It is the value of <code>ISHIKU_SETUP_SECRET</code> in your server configuration. It is kept for this browser session and, with PIN unlock, inside the encrypted PIN data.</p>
        <label class="psu-field"><span class="psu-label">Server secret</span><input class="psu-input" id="secretInput" type="password" autocomplete="off" spellcheck="false" value="${esc(Store.getSecret())}" required></label>
        <p class="psu-field-error" id="secretError" role="alert" hidden></p>
        <div class="meiku-sheet-actions"><button class="psu-button psu-button--filled psu-button--full" type="submit">Save for this session</button></div>
      </form>` });
    $('#secretForm').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        Store.setSecret($('#secretInput').value);
        toast('Server secret saved for this session.');
        await ctx.upgradeStoredVault();
        if (onSaved) onSaved(); else if (back) back(); else Sheet.close();
      } catch (error) { const e = $('#secretError'); e.textContent = error.message; e.hidden = false; }
    });
  }

  // ---- About ----------------------------------------------------------------------
  function openAbout() {
    const info = state.buildInfo || {};
    const released = info.buildSha && info.buildSha !== 'local';
    const date = value => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    const version = info.version ? `v${info.version}` : (info.sourceRef && info.sourceRef !== 'local' ? info.sourceRef : '');
    const rows = released ? [
      ['Version', version || 'Unreleased build'],
      ['Commit', info.buildSha.slice(0, 12)],
      ['Commit date', info.builtAt ? date(info.builtAt) : 'Not recorded'],
      ['Source', info.sourceRepo || 'MaroIshiku/meiku'],
      ...(info.workflowRun ? [['Workflow run', String(info.workflowRun)]] : [])
    ] : [
      ['Version', 'Local development build'],
      ['Source', info.sourceRepo || 'MaroIshiku/meiku']
    ];
    rows.push(['Vault format', `v${tokenVersion(state.token) || VAULT_VERSION}`]);
    rows.push(['Last saved', state.updated ? date(state.updated) : 'Not saved yet']);
    Sheet.open({ title: 'About Meiku', back: openSettings, body: `
      <p class="meiku-sheet-text">Meiku encrypts your profile on this device. The server only stores the encrypted vault.</p>
      <dl class="psu-technical-card meiku-about">
        ${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd class="psu-technical-value">${esc(value)}</dd></div>`).join('')}
      </dl>` });
  }

  return { openSettings, openEditor, openSecret, confirm };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The picture could not be read.')); };
    img.src = url;
  });
}

function drawCrop(canvas, image, crop, size, final = false) {
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = final ? 'high' : 'medium';
  const cropSize = Math.min(image.naturalWidth, image.naturalHeight) / Math.max(1, crop.zoom || 1);
  const maxX = Math.max(0, image.naturalWidth - cropSize);
  const maxY = Math.max(0, image.naturalHeight - cropSize);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const sx = clamp((image.naturalWidth - cropSize) / 2 + (crop.x || 0) / 100 * maxX / 2, 0, maxX);
  const sy = clamp((image.naturalHeight - cropSize) / 2 + (crop.y || 0) / 100 * maxY / 2, 0, maxY);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, size, size);
  c.drawImage(image, sx, sy, cropSize, cropSize, 0, 0, size, size);
}

function avatarDataUrl(image, crop) {
  for (const [size, quality] of [[384, 0.84], [320, 0.8], [256, 0.78], [192, 0.72]]) {
    const canvas = document.createElement('canvas');
    drawCrop(canvas, image, crop, size, true);
    const webp = canvas.toDataURL('image/webp', quality);
    const dataUrl = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= MAX_AVATAR_CHARS) return dataUrl;
  }
  throw new Error('The picture is too large. Try a smaller one.');
}
