import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/qr.js', import.meta.url), 'utf8');
const q = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// Public example IBANs with valid checksums.
assert.equal(q.isValidIban('DE89 3704 0044 0532 0130 00'), true);
assert.equal(q.isValidIban('GB82WEST12345698765432'), true);
assert.equal(q.isValidIban('DE89370400440532013001'), false);
assert.equal(q.isValidIban(''), false);
assert.equal(q.isValidBic('COBADEFFXXX'), true);
assert.equal(q.isValidBic('COBADEFF'), true);
assert.equal(q.isValidBic('123'), false);

// Amount parsing.
assert.equal(q.normalizeAmount('12,5'), '12.50');
assert.equal(q.normalizeAmount('1.234,56'), '1234.56');
assert.equal(q.normalizeAmount('1,234.56'), '1234.56');
assert.equal(q.normalizeAmount('1.000'), '1000.00');
assert.equal(q.normalizeAmount('0'), '');
assert.equal(q.normalizeAmount('1000000000'), '');
assert.equal(q.normalizeAmount('abc'), '');

// EPC069-12 GiroCode: remittance text is field 11, fields 9/10 stay empty.
const data = { n: 'Erika Mustermann', ib: 'DE89370400440532013000', bic: 'cobadeffxxx' };
const giro = q.QrPayload.girocode(data, '12,50', 'Invoice 42');
assert.deepEqual(giro.split('\n'), ['BCD', '002', '1', 'SCT', 'COBADEFFXXX', 'Erika Mustermann', 'DE89370400440532013000', 'EUR12.50', '', '', 'Invoice 42']);
assert.deepEqual(q.QrPayload.girocode(data, '', '').split('\n'), ['BCD', '002', '1', 'SCT', 'COBADEFFXXX', 'Erika Mustermann', 'DE89370400440532013000']);
assert.equal(q.QrPayload.girocode({ ...data, ib: 'DE00123' }, '5', ''), '');
assert.equal(q.QrPayload.girocode({ ...data, n: '' }, '5', ''), '');
const long = q.QrPayload.girocode({ ...data, n: 'N'.repeat(100) }, '5', 'P'.repeat(300)).split('\n');
assert.equal(long[5].length, 70);
assert.equal(long[10].length, 140);
assert.ok(!q.QrPayload.girocode(data, '5', 'line\nbreak').includes('line\nbreak'));
assert.ok(new TextEncoder().encode(q.QrPayload.girocode({ ...data, n: 'N'.repeat(100) }, '999999999.99', 'P'.repeat(300))).length <= 331);

// PayPal.
assert.equal(q.QrPayload.paypal({ pp: '@meiku' }, '5'), 'https://paypal.me/meiku/5.00');
assert.equal(q.QrPayload.paypal({ pp: '' }, '5'), '');

// vCard 3.0: N is present, ADR has seven components, CRLF line endings, escaping.
const vcard = q.QrPayload.vcard({ n: 'Erika Maria Mustermann', m: '+49 (151) 123', e1: 'erika;x@example.com', s: 'Heidestr. 17', z: '51147 Köln' });
const lines = vcard.split('\r\n');
assert.equal(lines[0], 'BEGIN:VCARD');
assert.equal(lines.at(-1), 'END:VCARD');
assert.ok(lines.includes('N:Mustermann;Erika Maria;;;'));
assert.ok(lines.includes('FN:Erika Maria Mustermann'));
assert.ok(lines.includes('TEL;TYPE=CELL:+49151123'));
assert.ok(lines.includes('EMAIL;TYPE=HOME:erika\;x@example.com'));
const adr = lines.find(line => line.startsWith('ADR;TYPE=HOME:'));
assert.equal(adr, 'ADR;TYPE=HOME:;;Heidestr. 17;Köln;;51147;');
assert.equal(adr.slice('ADR;TYPE=HOME:'.length).split(';').length, 7);
assert.ok(!vcard.replace(/\r\n/g, '').includes('\n'));

const company = q.QrPayload.vcardCompany({ n: 'Erika', c: 'ACME, Inc.', w: 'example.com', cs: 'Main St 1', cz: 'Springfield' }).split('\r\n');
assert.ok(company.includes('N:Erika;;;;'));
assert.ok(company.includes('ORG:ACME\\, Inc.'));
assert.ok(company.includes('URL:https://example.com'));
assert.ok(company.includes('ADR;TYPE=WORK:;;Main St 1;Springfield;;;'));

// QR matrix generation stays valid for the longest supported payloads.
const matrix = q.makeQrMatrix(giro);
assert.ok(matrix.length >= 21 && matrix.length % 4 === 1);

// Error correction levels: higher levels need larger symbols for the same data.
const sizes = Object.fromEntries(Object.entries(q.EC_LEVEL).map(([name, ec]) => [name, q.makeQrMatrix(giro, ec).length]));
assert.ok(sizes.L <= sizes.M && sizes.M <= sizes.Q && sizes.Q <= sizes.H, JSON.stringify(sizes));
assert.deepEqual(q.makeQrMatrix(giro), q.makeQrMatrix(giro, q.EC_LEVEL.M));

// Fluid style colours stay scannable for every theme: data modules >= 7:1, eyes and logo >= 4.5:1 on white.
for (const theme of Object.keys(q.QR_THEME_COLORS)) {
  const palette = q.qrPalette(theme);
  for (const key of ['start', 'end', 'ring']) assert.ok(q.contrastOnWhite(palette[key]) >= 7, `${theme}.${key}`);
  for (const key of ['eye', 'logo']) assert.ok(q.contrastOnWhite(palette[key]) >= 4.5, `${theme}.${key}`);
}
assert.ok(q.contrastOnWhite(q.ensureContrast('#ffff00', 7)) >= 7);
assert.equal(q.qrPalette('unknown').eye, q.qrPalette('lavender').eye);

console.log('QR payload tests passed');
