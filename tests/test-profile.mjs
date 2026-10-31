import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const toUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const qrUrl = toUrl(await readFile(new URL('../js/qr.js', import.meta.url), 'utf8'));
const profileSource = (await readFile(new URL('../js/profile.js', import.meta.url), 'utf8')).replace("from './qr.js'", `from '${qrUrl}'`);
const p = await import(toUrl(profileSource));

// normalizeData keeps only known fields and cleans payment fields.
const normalized = p.normalizeData({ n: '  Erika  ', ib: 'de89 3704 0044 0532 0130 00', bic: 'cobade ffxxx', pp: 'https://www.paypal.me/erika/20', extra: 'x', av: 'javascript:alert(1)' });
assert.equal(normalized.n, 'Erika');
assert.equal(normalized.ib, 'DE89370400440532013000');
assert.equal(normalized.bic, 'COBADEFFXXX');
assert.equal(normalized.pp, 'erika');
assert.equal(normalized.av, '');
assert.equal('extra' in normalized, false);
assert.equal(p.normalizeData({ pp: '@erika' }).pp, 'erika');
assert.equal(p.normalizeData({ pp: 'paypal.me/erika' }).pp, 'erika');
const avatar = 'data:image/webp;base64,AAAA';
assert.equal(p.normalizeData({ av: avatar }).av, avatar);
assert.equal(p.normalizeData({ av: 'data:image/svg+xml;base64,AAAA' }).av, '');
assert.equal(p.normalizeData({ av: `data:image/png;base64,${'A'.repeat(p.MAX_AVATAR_CHARS)}` }).av, '');

// Card availability.
assert.equal(p.hasBusiness({}), false);
assert.equal(p.hasBusiness({ w: 'example.com' }), true);
assert.equal(p.hasBank({ n: 'Erika', ib: 'DE89370400440532013000' }), true);
assert.equal(p.hasBank({ n: 'Erika', ib: 'DE00370400440532013000' }), false);
assert.equal(p.hasBank({ n: '', ib: 'DE89370400440532013000' }), false);

// Display helpers.
assert.equal(p.initials('Erika Maria Mustermann'), 'EM');
assert.equal(p.initials(''), 'MK');
assert.equal(p.firstName('  Erika Mustermann '), 'Erika');
assert.equal(p.slug('Jürgen Müller-Lüdenscheidt'), 'jurgen-muller-ludenscheidt');
assert.equal(p.slug('***'), 'contact');

// Every step field exists and the website accepts entries without a scheme.
for (const step of p.PROFILE_STEPS) assert.equal(p.fieldDefs(step.fields).length, step.fields.length);
assert.equal(p.FIELDS.find(([key]) => key === 'w')[2], 'text');
assert.equal(p.stepCount(p.PROFILE_STEPS[0], { n: 'A', m: '1' }), 2);

// Password strength guidance.
assert.equal(p.passwordStrength('short').level, 0);
assert.equal(p.passwordStrength('').label, '');
assert.equal(p.passwordStrength('aaaaaaaaaaaaaaaa').level, 1);
assert.equal(p.passwordStrength('abcdefghijkl').level, 1);
assert.ok(p.passwordStrength('Correct-Horse-Battery-9').level >= 3);

console.log('profile model tests passed');
