// Optional browser test: switching cards jumps instantly (no smooth scrolling)
// and every card starts at the top; a card never resumes an old scroll position.
// Requires Playwright with Chromium and a fresh Meiku instance (empty vault):
//   GLOBAL_NODE_MODULES=$(npm root -g) BASE=http://localhost:65003 node tests/e2e/cards.e2e.mjs
// The setup uses the server secret dev-secret-with-more-than-32-characters-x.
import { createRequire } from 'node:module';
const require = createRequire(process.env.GLOBAL_NODE_MODULES + '/');
const { chromium, devices } = require('playwright');
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const p = await ctx.newPage();
await p.goto(process.env.BASE + '/'); await p.waitForSelector('#setupForm');
await p.fill('input[name="n"]', 'Erika Mustermann'); await p.fill('#setupPassword', 'correct horse battery'); await p.fill('#setupPasswordConfirm', 'correct horse battery'); await p.fill('#setupSecret', 'dev-secret-with-more-than-32-characters-x');
await p.click('#setupForm button[type=submit]'); await p.waitForSelector('#editorForm');
const steps = [{ m: '+49 151 23456789', e1: 'erika@example.com', s: 'Heidestraße 17', z: '51147 Köln' }, { c: 'Example GmbH', j: 'Designer', cp: '+49 221 1', cm: '+49 160 2', ce: 'e@example.com', w: 'example.com', cs: 'Rheinallee 1', cz: '50667 Köln' }, { pp: 'erika' }, { ib: 'DE89370400440532013000' }];
for (const st of steps) { for (const [k, v] of Object.entries(st)) await p.fill(`#editorForm input[name="${k}"]`, v); await p.click('#editorForm button[type=submit]'); await p.waitForTimeout(700); }
await p.waitForSelector('#sheet', { state: 'hidden' });
const top = id => p.evaluate(id => document.querySelector('#card-' + id).scrollTop, id);
const scrollDown = id => p.evaluate(id => { const el = document.querySelector('#card-' + id); el.scrollTop = el.scrollHeight; return el.scrollTop; }, id);
const results = [];
// Tap: jump must be immediate (no smooth scrolling in between).
console.log('private scrolled to', await scrollDown('private'));
const jump = await p.evaluate(() => new Promise(resolve => {
  const deck = document.querySelector('#deck');
  document.querySelector('#cardNav [data-card="bank"]').click();
  const target = document.querySelector('#card-bank').offsetLeft;
  resolve({ immediately: deck.scrollLeft, target });
}));
results.push(['tap jumps immediately', jump.immediately === jump.target, JSON.stringify(jump)]);
results.push(['bank starts at top', (await top('bank')) === 0, await top('bank')]);
await p.waitForTimeout(300);
results.push(['left card (private) reset to top', (await top('private')) === 0, await top('private')]);
await scrollDown('bank');
await p.click('#cardNav [data-card="private"]'); await p.waitForTimeout(300);
await p.click('#cardNav [data-card="bank"]'); await p.waitForTimeout(300);
results.push(['returning to bank starts at top', (await top('bank')) === 0, await top('bank')]);
// Swipe: emulate a horizontal swipe from bank back to paypal.
await scrollDown('bank');
await p.evaluate(() => { const d = document.querySelector('#deck'); d.scrollLeft = document.querySelector('#card-paypal').offsetLeft; });
await p.waitForTimeout(400);
results.push(['swipe marks paypal current', await p.evaluate(() => document.querySelector('#cardNav [aria-current]')?.dataset.card) === 'paypal', '']);
results.push(['swiped-away bank reset to top', (await top('bank')) === 0, await top('bank')]);
for (const [name, ok, detail] of results) console.log(ok ? 'PASS' : 'FAIL', name, detail);
await b.close();
process.exit(results.every(r => r[1]) ? 0 : 1);
