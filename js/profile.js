import { formatIbanRaw, isValidIban } from './qr.js';

// [key, label, input type, required, autocomplete, inputmode]
// The website uses type=text with inputmode=url so entries without https:// stay valid.
export const FIELDS = [
  ['n', 'Full name', 'text', true, 'name'],
  ['m', 'Mobile', 'tel', false, 'tel'],
  ['e1', 'Email', 'email', false, 'email'],
  ['s', 'Street and number', 'text', false, 'address-line1'],
  ['z', 'ZIP code and city', 'text', false, 'address-level2'],
  ['c', 'Company', 'text', false, 'organization'],
  ['j', 'Job title', 'text', false, 'organization-title'],
  ['cp', 'Office phone', 'tel', false, 'tel'],
  ['cm', 'Work mobile', 'tel', false, 'tel'],
  ['ce', 'Work email', 'email', false, 'email'],
  ['w', 'Website', 'text', false, 'url', 'url'],
  ['cs', 'Street and number', 'text', false, 'off'],
  ['cz', 'ZIP code and city', 'text', false, 'off'],
  ['pp', 'PayPal.me username', 'text', false, 'off'],
  ['ib', 'IBAN', 'text', false, 'off'],
  ['bic', 'BIC (optional)', 'text', false, 'off']
];
export const FIELD_KEYS = new Set(FIELDS.map(([key]) => key));

export const PROFILE_STEPS = [
  { id: 'private', title: 'Private', hint: 'Your name and private contact details.', fields: ['n', 'm', 'e1', 's', 'z'] },
  { id: 'business', title: 'Business', hint: 'Company, work contact details and business address.', fields: ['c', 'j', 'cp', 'cm', 'ce', 'w', 'cs', 'cz'] },
  { id: 'paypal', title: 'PayPal', hint: 'Your paypal.me username for payment links.', fields: ['pp'] },
  { id: 'bank', title: 'Bank', hint: 'SEPA details for the GiroCode (EPC QR).', fields: ['ib', 'bic'] }
];

export const LEGACY_AVATAR_KEY = 'dv2.avatar';
export const MAX_AVATAR_CHARS = 200000;
const AVATAR_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

export function normalizeData(data = {}) {
  const out = {};
  for (const [key] of FIELDS) out[key] = String(data[key] || '').trim();
  out.ib = formatIbanRaw(out.ib);
  out.bic = out.bic.replace(/\s+/g, '').toUpperCase();
  out.pp = out.pp.replace(/^@/, '').replace(/^(?:https?:\/\/)?(?:www\.)?paypal\.me\//i, '').replace(/\/.*$/, '');
  const avatar = String(data.av || '');
  out.av = isValidAvatar(avatar) ? avatar : '';
  return out;
}

export function isValidAvatar(value) {
  return typeof value === 'string' && value.length <= MAX_AVATAR_CHARS && AVATAR_RE.test(value);
}

export function readLegacyAvatar() {
  const avatar = localStorage.getItem(LEGACY_AVATAR_KEY) || '';
  return isValidAvatar(avatar) ? avatar : '';
}

export function fieldDefs(keys) {
  return keys.map(key => FIELDS.find(([field]) => field === key)).filter(Boolean);
}

export function stepCount(step, data) {
  return step.fields.filter(field => String(data[field] || '').trim()).length;
}

export function hasBusiness(data) {
  return ['c', 'j', 'cp', 'cm', 'ce', 'w', 'cs', 'cz'].some(key => data[key]);
}
export function hasPayPal(data) { return Boolean(data.pp); }
export function hasBank(data) { return Boolean(data.n) && isValidIban(data.ib); }

export function initials(name = '') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'MK';
}

export function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || '';
}

export function slug(name = '') {
  return String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contact';
}

/** Rough password strength for user guidance only (the 12-character rule is enforced separately). */
export function passwordStrength(password) {
  const value = String(password || '');
  if (value.length < 12) return { level: 0, label: value ? 'Too short' : '' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(value)).length;
  let level = 1;
  if (value.length >= 16 || classes >= 3) level = 2;
  if (value.length >= 20 || (value.length >= 14 && classes >= 3)) level = 3;
  if (/^(.)\1+$/.test(value) || /^(?:0123|1234|abcd|qwer|pass)/i.test(value)) level = 1;
  return { level, label: ['Too short', 'Fair', 'Good', 'Strong'][level] };
}
