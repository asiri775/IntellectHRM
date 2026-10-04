// Capture UI screenshots against a running web preview (+ API) for review.
// Usage: WEB_URL=http://localhost:4173 OUT=/tmp/shots node tests/screenshots/capture.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const WEB = process.env.WEB_URL ?? 'http://localhost:4173';
const API = (process.env.API_URL ?? 'http://localhost:3000') + '/api';
const OUT = process.env.OUT ?? '/tmp/shots';
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const DEMO_PW = process.env.SEED_DEMO_PASSWORD;
mkdirSync(OUT, { recursive: true });

// Placeholder wordmark (company name only) so screenshots show where the real logo goes.
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="80" viewBox="0 0 360 80"><rect width="360" height="80" fill="none"/><text x="0" y="52" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#14213D">Intellect</text><text x="178" y="52" font-family="Arial, sans-serif" font-size="40" font-weight="400" fill="#0EA5A4">Choice</text></svg>`;

async function apiLogin(email, password) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`API login failed for ${email}: ${r.status}`);
  return (await r.json()).accessToken;
}

// Setup through the API (not the browser) so browser sessions are left untouched.
{
  const token = await apiLogin(ADMIN.email, ADMIN.password);
  const fd = new FormData();
  fd.append('file', new Blob([LOGO], { type: 'image/svg+xml' }), 'logo.svg');
  const up = await fetch(`${API}/company/logo`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  console.log(`  logo upload: ${up.status}`);
  await fetch(`${API}/company`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ primaryColor: '#1F4FD8', accentColor: '#0EA5A4', legalName: 'Intellect Choice', address: 'Colombo, Sri Lanka' }) });
}
const hrToken = await apiLogin('nadeesha.perera@example.com', DEMO_PW);
const kasunId = (await (await fetch(`${API}/employees?search=Kasun`, { headers: { Authorization: `Bearer ${hrToken}` } })).json()).items[0]?.id;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });

async function session(email, password, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.error(`[console] ${m.text()}`));
  page.on('response', (r) => r.status() >= 400 && r.status() !== 401 && console.error(`[http ${r.status()}] ${r.request().method()} ${r.url()}`));
  for (let attempt = 1; ; attempt++) {
    await page.goto(`${WEB}/login`);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', password);
    await page.click('button[type=submit]');
    try {
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
      break;
    } catch (e) {
      // The API allows 10 sign-ins per minute per IP; wait for the window to reset.
      if (attempt >= 3) throw e;
      console.log(`  (sign-in throttled for ${email}, waiting 61s)`);
      await page.waitForTimeout(61000);
    }
  }
  await page.waitForLoadState('networkidle');
  return { ctx, page };
}

async function shot(page, name, path, opts = {}) {
  if (path) await page.goto(`${WEB}${path}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(opts.wait ?? 600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.full ?? true });
  console.log(`  📸 ${name}`);
}

let failed = 0;
async function safe(name, fn) {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

// Login page (before logo upload is fine either way)
await safe('login', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await shot(page, '01-login', '/login', { full: false });
  await ctx.close();
});

// Admin: upload placeholder logo, then settings + payroll screens
await safe('admin', async () => {
  const { ctx, page } = await session(ADMIN.email, ADMIN.password);
  await shot(page, '10-settings-branding', '/settings/branding');
  await shot(page, '11-settings-email-template', '/settings/email-templates', { wait: 1500 });
  await page.goto(`${WEB}/settings/document-templates`);
  await page.waitForFunction(() => (document.querySelector('iframe[title="Document preview"]')?.getAttribute('srcdoc')?.length ?? 0) > 500, null, { timeout: 15000 }).catch(() => console.error('  invoice preview did not render'));
  await shot(page, '12-settings-invoice-format', null, { wait: 800 });
  await shot(page, '13-settings-roles', '/settings/roles');
  await shot(page, '20-employees', '/employees');
  await shot(page, '32-payroll-runs', '/payroll');
  await page.getByRole('tab', { name: 'Statutory rules' }).click();
  await shot(page, '31-payroll-statutory-rules', null);
  await page.goto(`${WEB}/payroll`);
  const firstRun = page.locator('table tbody tr').first();
  await firstRun.waitFor({ timeout: 10000 }).catch(() => undefined);
  if (await firstRun.count()) {
    await firstRun.click();
    await page.waitForURL(/payroll\/runs\//);
    await shot(page, '33-payroll-run', null);
  }
  await ctx.close();
});

// HR manager
await safe('hr', async () => {
  const { ctx, page } = await session('nadeesha.perera@example.com', DEMO_PW);
  await shot(page, '21-home-hr', '/');
  await shot(page, '22-attendance-board', '/attendance');
  await page.click('text=Daily board').catch(() => undefined);
  await shot(page, '23-attendance-daily', null);
  if (kasunId) await shot(page, '24-employee-detail', `/employees/${kasunId}`);
  await shot(page, '25-employee-form', '/employees/new');
  await ctx.close();
});

// Contract employee self-service (desktop + mobile, English + Sinhala)
await safe('employee', async () => {
  const { ctx, page } = await session('kasun.silva@example.com', DEMO_PW);
  await shot(page, '40-home-employee', '/');
  await shot(page, '41-leave', '/leave');
  await shot(page, '42-my-payslips', '/payroll/my-payslips');
  await page.selectOption('header select', 'si');
  await shot(page, '43-home-sinhala', '/');
  await page.selectOption('header select', 'ta');
  await shot(page, '45-leave-tamil', '/leave');
  await page.selectOption('header select', 'en');
  await ctx.close();
  const m = await session('kasun.silva@example.com', DEMO_PW, { width: 390, height: 844 });
  await shot(m.page, '44-mobile-home', '/');
  await m.ctx.close();
});

// Sales
await safe('sales', async () => {
  const { ctx, page } = await session('sanjaya.ranasinghe@example.com', DEMO_PW);
  await shot(page, '50-leads', '/crm/leads');
  await shot(page, '51-pipeline', '/crm/pipeline');
  await page.locator('a[href^="/crm/opportunities/"]').first().click();
  await shot(page, '52-opportunity', null);
  await shot(page, '53-customers', '/crm/customers');
  await ctx.close();
});

await browser.close();
console.log(failed ? `${failed} screenshot group(s) failed` : 'Screenshots captured');
process.exit(failed ? 1 : 0);
