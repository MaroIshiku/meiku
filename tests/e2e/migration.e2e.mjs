// Optional browser regression test (not part of the required CI command).
// Requires Playwright with Chromium and a running Meiku instance:
//   GLOBAL_NODE_MODULES=$(npm root -g) REPO=$PWD BASE_URL=http://localhost:65003 \
//   SECRET=<setup secret> node tests/e2e/migration.e2e.mjs
// WARNING: it replaces the vault on the target server. Use a throwaway instance.
// End-to-end check: a v0.2.8 vault (v2 token, legacy PIN blob, plaintext avatar)
// opens in the new app without re-entering data and is migrated in place.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(process.env.GLOBAL_NODE_MODULES + '/');
const { chromium } = require('playwright');
const repo = process.env.REPO;
const base = process.env.BASE_URL;
const secret = process.env.SECRET;
const src = await readFile(`${repo}/js/crypto.js`, 'utf8');
const c = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);

const profile = { n: 'Erika Mustermann', m: '+49 151 000', e1: 'erika@example.com', s: 'Heidestr. 17', z: '51147 Köln', pp: 'erika', ib: 'DE89370400440532013000', bic: 'COBADEFFXXX' };
const legacyPassword = 'legacy-pass';
const legacyToken = await c.encryptLegacyJson(profile, legacyPassword);
const post = (token, extra = {}) => fetch(`${base}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': secret }, body: JSON.stringify({ token, ...extra }) });
assert.equal((await post(legacyToken)).status, 200); // old client: no expectedRevision
const legacyPinBlob = JSON.stringify({ ...JSON.parse(await c.encryptStringWithPin(JSON.stringify({ v: 1, masterPassword: legacyPassword, writeSecret: secret }), '123456')), v: 2 });
const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
page.on('console', msg => { if (msg.type() === 'error' && !/Password is wrong|OperationError|status of 409/.test(msg.text())) problems.push(msg.text()); });
page.on('pageerror', err => problems.push(err.message));

await page.goto(base);
await page.evaluate(([blob, av]) => { localStorage.clear(); localStorage.setItem('dv2.pinWrappedPassword', blob); localStorage.setItem('dv2.avatar', av); localStorage.setItem('dv2.theme', 'mint'); localStorage.setItem('meiku-login-name', 'Erika Mustermann'); }, [legacyPinBlob, avatar]);
await page.reload();
await page.waitForSelector('#pinDots');

// Legacy PIN unlock via physical keyboard.
await page.keyboard.type('123456');
await page.waitForSelector('#vaultScreen:not([hidden])');
await page.waitForFunction(() => document.querySelector('#toastHost').textContent.includes('upgraded'));
const server1 = await (await fetch(`${base}/api/data`)).json();
assert.equal(c.tokenVersion(server1.token), 3, 'vault re-sealed as v3');
assert.deepEqual({ ...(await c.openVault(server1.token, legacyPassword)).data, av: undefined }, { ...profile, cp: '', cm: '', ce: '', c: '', j: '', w: '', cs: '', cz: '', av: undefined });
assert.equal((await c.openVault(server1.token, legacyPassword)).data.av, avatar, 'avatar moved into encrypted vault');
const storage = await page.evaluate(() => ({ ...localStorage }));
assert.ok(storage['meiku.pin'], 'PIN re-wrapped in current format');
assert.equal(storage['dv2.pinWrappedPassword'], undefined);
assert.equal(storage['dv2.avatar'], undefined);
assert.equal(storage['dv2.theme'], undefined);
assert.equal(storage['meiku-theme'], 'mint');
assert.ok(!storage['meiku.pin'].includes(legacyPassword));
assert.equal(await page.locator('#card-private .meiku-avatar img').getAttribute('src'), avatar);

// Payments: GiroCode renders for the valid IBAN.
await page.click('#cardNav [data-card="bank"]');
await page.fill('#card-bank [data-amount-input]', '12,50');
await page.waitForFunction(() => document.querySelector('#card-bank [data-caption]')?.textContent.includes('12.50'));
await page.waitForSelector('#card-bank [data-qr] canvas');

// New-format PIN unlock after reload.
await page.reload();
await page.waitForSelector('#pinDots');
for (const d of '123456') await page.click(`.meiku-pin__grid [data-key="${d}"]`);
await page.waitForSelector('#vaultScreen:not([hidden])');

// Conflict: another device saves meanwhile; this device must not overwrite.
const other = await c.openVault(server1.token, legacyPassword);
assert.equal((await post(await c.sealVault(other.session, { ...other.data, n: 'Other Device' }))).status, 200);
await page.click('#settingsButton');
await page.click('#sheetBody [data-action="edit"]');
await page.click('#editorForm button[type="submit"]');
await page.waitForFunction(() => document.querySelector('#editorError')?.textContent.includes('another device'));
await page.keyboard.press('Escape');
const server2 = await (await fetch(`${base}/api/data`)).json();
assert.equal((await c.openVault(server2.token, legacyPassword)).data.n, 'Other Device', 'conflicting save did not overwrite');

// Password change: mismatch rejected, then success; old password stops working.
await page.reload();
await page.click('#usePassword');
await page.fill('#unlockPassword', legacyPassword);
await page.click('#unlockForm button[type="submit"]');
await page.waitForSelector('#vaultScreen:not([hidden])');
await page.click('#settingsButton');
await page.click('#sheetBody [data-action="password"]');
await page.fill('#newPassword', 'new-password-123');
await page.fill('#newPasswordConfirm', 'new-password-124');
await page.click('#passwordForm button[type="submit"]');
assert.match(await page.locator('#passwordError').textContent(), /do not match/);
await page.fill('#newPasswordConfirm', 'new-password-123');
await page.click('#passwordForm button[type="submit"]');
await page.waitForFunction(() => document.querySelector('#toastHost').textContent.includes('Password changed'));
const server3 = await (await fetch(`${base}/api/data`)).json();
await assert.rejects(c.openVault(server3.token, legacyPassword));
assert.equal((await c.openVault(server3.token, 'new-password-123')).data.n, 'Other Device');
assert.equal(await page.evaluate(() => localStorage.getItem('meiku.pin')), null);

// Import asks for confirmation before replacing the vault.
await page.click('#settingsButton');
await page.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ token: legacyToken })) });
await page.waitForSelector('[data-confirm]');
assert.equal((await (await fetch(`${base}/api/data`)).json()).token, server3.token, 'nothing replaced before confirmation');
await page.click('[data-confirm]');
await page.waitForSelector('#unlockPassword');
assert.equal((await (await fetch(`${base}/api/data`)).json()).token, legacyToken);

assert.deepEqual(problems, [], 'no console errors or CSP violations');
await browser.close();
console.log('browser migration e2e passed');
