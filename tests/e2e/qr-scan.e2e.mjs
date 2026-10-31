// Optional scan check for the "fluid" QR style (not part of the required CI command).
// Renders every share card in every theme in a real browser canvas and decodes the
// result with jsQR, including downscaled, blurred-by-resize and low-contrast variants.
// Requirements: Playwright with Chromium, jsqr@1.4.0 and pngjs@7.0.0 in TOOLS, and a
// running Meiku instance (any vault state):
//   GLOBAL_NODE_MODULES=$(npm root -g) TOOLS=/path/to/node_modules \
//   BASE_URL=http://localhost:65003 node tests/e2e/qr-scan.e2e.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const requireGlobal = createRequire(process.env.GLOBAL_NODE_MODULES + '/');
const requireTools = createRequire(process.env.TOOLS + '/');
const { chromium } = requireGlobal('playwright');
const jsQR = requireTools('jsqr');
const { PNG } = requireTools('pngjs');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(process.env.BASE_URL + '/index.html');
const codes = await page.evaluate(async () => {
  const q = await import('/js/qr.js');
  const { iconPath } = await import('/js/icons.js');
  const d = { n: 'Erika Maria Mustermann', m: '+49 151 23456789', e1: 'erika.mustermann@example.com', s: 'Heidestraße 17', z: '51147 Köln', c: 'Example GmbH & Co. KG', j: 'Head of Product Design', cp: '+49 221 1234567', cm: '+49 160 7654321', ce: 'e.mustermann@example.com', w: 'www.example.com', cs: 'Rheinallee 1', cz: '50667 Köln', pp: 'erikamustermann', ib: 'DE89370400440532013000', bic: 'COBADEFFXXX' };
  const cards = [['user', q.QrPayload.vcard(d)], ['briefcase', q.QrPayload.vcardCompany(d)], ['wallet', q.QrPayload.paypal(d, '12.50')], ['bank', q.QrPayload.girocode(d, '1234.56', 'Invoice 2026-10-31 dinner and drinks')]];
  const out = [];
  for (const theme of Object.keys(q.QR_THEME_COLORS)) for (const [iconName, text] of cards) {
    for (const size of [720, 300]) {
      const canvas = q.renderQr(document.createElement('div'), text, { style: 'fluid', theme, logoPath: iconPath(iconName), size });
      out.push({ label: `${theme}/${iconName}/${size}`, text, png: canvas.toDataURL('image/png') });
    }
  }
  return out;
});
await browser.close();

let failures = [];
for (const code of codes) {
  const png = PNG.sync.read(Buffer.from(code.png.split(',')[1], 'base64'));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (result?.data !== code.text) failures.push(code.label);
}
assert.deepEqual(failures, [], `not decodable: ${failures.join(', ')}`);
console.log(`QR scan check passed: ${codes.length} codes decoded`);
