/**
 * Browser test.
 *
 * Boots the real server against a throwaway database and drives the actual UI
 * in Chromium: sign-up, logging, every page, the palette, themes, i18n and
 * sign-out. It also fails on any console error or failed request, which is
 * what catches the mistakes unit tests never see.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   npm run test:ui
 *
 * Skips cleanly (exit 0) when Playwright is not installed.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('\n  Playwright is not installed — skipping the browser test.');
  console.log('  npm install --no-save playwright && npx playwright install chromium\n');
  process.exit(0);
}

const PORT = Number(process.env.UI_TEST_PORT || 4400);
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(PORT),
    // An empty value, not a missing one: config.js fills in anything
    // *undefined* from .env, so deleting this would hand the test server the
    // developer's real database. Empty means PGlite, in memory, thrown away
    // when the process exits.
    DATABASE_URL: '',
    JWT_SECRET: 'ui-test-secret-not-used-in-production',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const cleanup = () => {
  server.kill();   // the in-memory database goes with it
};
process.on('exit', cleanup);

// Wait for the server rather than guessing at a sleep duration.
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (res.ok) break;
  } catch { /* not up yet */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const errors = [];
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await ctx.newPage();

page.on('console', (m) => {
  const text = m.text();
  // A 401 from the boot-time session probe is expected while signed out.
  if (m.type() === 'error' && !text.includes('401')) errors.push(`console: ${text}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  if (!r.url().includes('favicon')) errors.push(`reqfail: ${r.url()} ${r.failure()?.errorText}`);
});

let passed = 0;
let failed = 0;

const step = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) {
    failed += 1;
    const first = e.message.split('\n')[0];
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${first}`);
    errors.push(`step ${name}: ${first}`);
  }
};

const email = `ui${Date.now()}@example.com`;

console.log('\nUI smoke test\n');


await step('landing redirects to sign-in', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.auth__form', { timeout: 5000 });
  if (!page.url().endsWith('/login')) throw new Error(`expected /login got ${page.url()}`);
});

await step('switch to register', async () => {
  await page.click('.auth__alt a');
  await page.waitForSelector('input[name=name]');
});

await step('register a new account', async () => {
  await page.fill('input[name=name]', 'Bakhrom Test');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'strongpass123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.hero-card', { timeout: 8000 });
});

await step('today view shows starter routines', async () => {
  await page.waitForSelector('.routine', { timeout: 5000 });
  const n = await page.locator('.routine').count();
  if (n < 3) throw new Error(`expected starter routines, got ${n}`);
});

await step('checking a routine updates the ring', async () => {
  const before = await page.locator('.ring-wrap__inner div').first().textContent();
  await page.locator('.routine .check').first().click();
  await page.waitForTimeout(600);
  const after = await page.locator('.ring-wrap__inner div').first().textContent();
  if (before === after) throw new Error(`ring did not change (${before})`);
  if (await page.locator('.routine.is-done').count() === 0) throw new Error('row not marked done');
});

await step('the quantity stepper changes progress', async () => {
  const qty = page.locator('.qty').first();
  if (await qty.count() === 0) return;
  const before = await qty.locator('.qty__value').textContent();
  await qty.locator('.qty__btn').nth(0).click();
  await page.waitForTimeout(500);
  const after = await qty.locator('.qty__value').textContent();
  if (before === after) throw new Error(`quantity unchanged: ${before}`);
});

await step('create a routine through the modal', async () => {
  await page.click('.header .btn--primary');
  await page.waitForSelector('.modal');
  await page.fill('#f-title', 'Playwright routine');
  await page.fill('#f-time', '05:30');
  await page.selectOption('#f-repeat', 'weekly');
  await page.waitForSelector('.daypick');
  await page.locator('.daypick__day').first().click();
  await page.locator('.modal__foot .btn--primary').click();
  await page.waitForSelector('.modal', { state: 'detached', timeout: 6000 });
});

await step('routines page lists the new routine', async () => {
  await page.click('.sidebar a[href="/routines"]');
  await page.waitForSelector('.routine-card', { timeout: 5000 });
  const found = await page.locator('.routine-card__title', { hasText: 'Playwright routine' }).count();
  if (!found) throw new Error('new routine not listed');
});

await step('template packs render', async () => {
  const n = await page.locator('.template-card').count();
  if (n < 3) throw new Error(`expected template packs, got ${n}`);
});

await step('applying a template adds routines', async () => {
  const before = await page.locator('.routine-card').count();
  await page.locator('.template-card .btn--block').first().click();
  await page.waitForTimeout(1200);
  const after = await page.locator('.routine-card').count();
  if (after <= before) throw new Error(`count did not grow: ${before} -> ${after}`);
});

await step('search filters the list', async () => {
  await page.fill('.toolbar__search input', 'Playwright');
  await page.waitForTimeout(400);
  const n = await page.locator('.routine-card').count();
  if (n !== 1) throw new Error(`expected 1 result, got ${n}`);
  await page.fill('.toolbar__search input', '');
  await page.waitForTimeout(300);
});

await step('routine detail opens', async () => {
  await page.locator('.routine-card .btn--ghost').first().click();
  await page.waitForSelector('.hero-card', { timeout: 5000 });
  if (!/\/routine\/\d+/.test(page.url())) throw new Error(`bad url ${page.url()}`);
});

await step('calendar renders a month grid', async () => {
  await page.click('.sidebar a[href="/calendar"]');
  await page.waitForSelector('.calendar__dow', { timeout: 8000 });
  const n = await page.locator('.calendar__day:not(.is-empty)').count();
  if (n < 28) throw new Error(`expected month days, got ${n}`);
});

await step('calendar navigates months', async () => {
  const title = await page.locator('.section__title').first().textContent();
  await page.locator('.section__head .btn--icon').first().click();
  await page.waitForTimeout(700);
  const next = await page.locator('.section__title').first().textContent();
  if (title === next) throw new Error('month did not change');
});

await step('stats page renders charts', async () => {
  await page.click('.sidebar a[href="/stats"]');
  await page.waitForSelector('.kpi', { timeout: 5000 });
  await page.waitForTimeout(800);
  if (await page.locator('.heatmap__cell').count() < 20) throw new Error('heatmap missing');
});

await step('stats range switch works', async () => {
  await page.locator('.page-head .segmented__item').nth(2).click();
  await page.waitForTimeout(900);
  await page.waitForSelector('.kpi');
});

await step('journal saves an entry', async () => {
  await page.click('.sidebar a[href="/journal"]');
  await page.waitForSelector('#journal-body', { timeout: 5000 });
  await page.locator('.mood').nth(3).click();
  await page.fill('#journal-body', 'A solid day of testing.');
  await page.click('.card .btn--primary');
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#journal-body');
  const value = await page.locator('#journal-body').inputValue();
  if (!value.includes('solid day')) throw new Error(`entry not persisted: "${value}"`);
});

await step('achievements show unlocked badges', async () => {
  await page.click('.sidebar a[href="/achievements"]');
  await page.waitForSelector('.badge-card', { timeout: 5000 });
  if (await page.locator('.badge-card.is-unlocked').count() === 0) throw new Error('no unlocked badge');
});

await step('command palette opens and navigates', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.palette__input', { timeout: 3000 });
  await page.keyboard.type('Playwright');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  if (!/\/routine\/\d+/.test(page.url())) throw new Error(`palette did not navigate: ${page.url()}`);
});

await step('theme toggle switches to light', async () => {
  await page.locator('.header__actions .btn--icon').click();
  await page.waitForTimeout(900);
  const theme = await page.getAttribute('html', 'data-theme');
  if (theme !== 'light') throw new Error(`theme is ${theme}`);
});

await step('theme persists across reload', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const theme = await page.getAttribute('html', 'data-theme');
  if (theme !== 'light') throw new Error(`theme reverted to ${theme}`);
  await page.locator('.header__actions .btn--icon').click();
  await page.waitForTimeout(700);
});

await step('settings page loads with sessions', async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.danger-zone', { timeout: 5000 });
  await page.waitForTimeout(700);
  if (await page.locator('.session-row').count() === 0) throw new Error('no sessions listed');
});

await step('saving a preference redraws with the new value', async () => {
  // Avatar colour: a silent save that only the settings view re-renders.
  const swatches = page.locator('.card .swatch');
  await swatches.nth(4).click();
  await page.waitForTimeout(900);
  const selected = await page.locator('.card .swatch.is-on').first().getAttribute('style');
  const avatar = await page.locator('.avatar--lg').getAttribute('style');
  const hex = /background:\s*([^;]+)/.exec(selected)?.[1]?.trim();
  if (!hex || !avatar.includes(hex)) throw new Error(`avatar (${avatar}) did not follow swatch (${hex})`);
});

await step('week start toggle persists across a reload', async () => {
  await page.locator('.segmented__item:has-text("Sunday")').click();
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.danger-zone');
  await page.waitForTimeout(700);
  const active = await page.locator('.segmented__item.is-active').filter({ hasText: 'Sunday' }).count();
  if (!active) throw new Error('week start did not persist');
});

await step('language switch translates the UI', async () => {
  await page.selectOption('.card select', 'uz');
  await page.waitForTimeout(1000);
  const title = await page.locator('.header__title').textContent();
  if (title !== 'Sozlamalar') throw new Error(`header not translated: ${title}`);
  await page.selectOption('.card select', 'en');
  await page.waitForTimeout(900);
});

await step('unknown route shows the not-found state', async () => {
  await page.goto(`${BASE}/nope`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.empty__title', { timeout: 5000 });
});

await step('session survives a reload', async () => {
  await page.goto(`${BASE}/today`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero-card', { timeout: 6000 });
});

await step('mobile layout shows the tab bar', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  if (!await page.locator('.tabbar').isVisible()) throw new Error('tab bar hidden');
  if (await page.locator('.sidebar').isVisible()) throw new Error('sidebar should be hidden');
});

await step('sign out returns to the auth screen', async () => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Sign out")').first().click();
  await page.waitForSelector('.auth__form', { timeout: 6000 });
});

await step('signing back in restores the data', async () => {
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'strongpass123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.hero-card', { timeout: 8000 });
  await page.waitForSelector('.routine', { timeout: 5000 });
});

await browser.close();

console.log(`\n  ${passed} passed, ${failed} failed`);
if (errors.length) {
  console.log('  Problems:');
  for (const e of [...new Set(errors)]) console.log(`   - ${e}`);
}
console.log('');

process.exit(errors.length || failed ? 1 : 0);
