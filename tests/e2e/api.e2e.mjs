// End-to-end API test against a running API + seeded Postgres.
// Usage: API_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/e2e/api.e2e.mjs
import assert from 'node:assert/strict';

const API = (process.env.API_URL ?? 'http://localhost:3000') + '/api';
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const EXPECT_PDF = process.env.EXPECT_PDF === 'true';
let passed = 0;

async function call(method, path, { token, body, form, expect = 200, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const text = raw ? null : await res.text();
  if (res.status !== expect) {
    throw new Error(`${method} ${path} → ${res.status} (expected ${expect})\n${text ?? ''}`);
  }
  if (raw) return res;
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${e.stack ?? e}`);
    process.exit(1);
  }
}

const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).accessToken;
const ymd = (d) => d.toISOString().slice(0, 10);
function nextWeekday(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const now = new Date();
const year = now.getUTCFullYear();
const month = now.getUTCMonth() + 1;
const uniq = Date.now().toString(36);
const NIC_NEW = String(Date.now()).slice(-12).padStart(12, '2'); // 12-digit format
const NIC_OLD = `${String(Date.now()).slice(-9)}V`; // 9 digits + V
let admin, empToken, hrToken, employee, hrEmployee, run, contractLine;

console.log(`E2E against ${API}`);

await step('health', async () => {
  const h = await call('GET', '/health');
  assert.equal(h.status, 'ok');
});

await step('login rejects wrong password; admin can sign in', async () => {
  await call('POST', '/auth/login', { body: { email: ADMIN.email, password: 'wrong-password-1' }, expect: 401 });
  admin = await login(ADMIN.email, ADMIN.password);
  const me = await call('GET', '/auth/me', { token: admin });
  assert.ok(me.roles.includes('SUPER_ADMIN'));
  assert.ok('PAYROLL_APPROVE' in me.permissions);
});

await step('unauthenticated requests are rejected', async () => {
  await call('GET', '/employees', { expect: 401 });
});

await step('upload company logo → public branding + public file', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'logo.png');
  const r = await call('POST', '/company/logo', { token: admin, form: fd, expect: 201 });
  assert.ok(r.logoUrl);
  const b = await call('GET', '/public/branding');
  assert.equal(b.logoUrl, r.logoUrl);
  const f = await call('GET', r.logoUrl.replace('/api', ''), { raw: true });
  assert.equal(f.headers.get('content-type'), 'image/png');
});

await step('rejects a non-image disguised as PNG', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'image/png' }), 'x.png');
  await call('POST', '/company/logo', { token: admin, form: fd, expect: 400 });
});

await step('update branding colours', async () => {
  const c = await call('PATCH', '/company', { token: admin, body: { primaryColor: '#123ABC', emailFooter: 'Intellect Choice — HR' } });
  assert.equal(c.primaryColor, '#123ABC');
});

const lookups = { v: null };
await step('organization lookups', async () => {
  lookups.v = await call('GET', '/org/lookups', { token: admin });
  assert.ok(lookups.v.departments.length >= 5);
  assert.ok(lookups.v.schedules.length >= 1);
});

await step('create HR manager employee with user account', async () => {
  hrEmployee = await call('POST', '/employees', {
    token: admin,
    expect: 201,
    body: {
      firstName: 'Hiru',
      lastName: 'HR',
      email: `hr.${uniq}@example.com`,
      joiningDate: `${year - 1}-01-15`,
      employmentType: 'PERMANENT',
      departmentId: lookups.v.departments.find((d) => d.code === 'HR').id,
      nic: NIC_NEW,
      createUser: { password: 'HrPassword123', roleCodes: ['HR_MANAGER', 'EMPLOYEE'], sendWelcomeEmail: true },
    },
  });
  assert.equal(hrEmployee.nic, NIC_NEW); // admin sees sensitive data
  hrToken = await login(`hr.${uniq}@example.com`, 'HrPassword123');
});

await step('duplicate NIC is rejected', async () => {
  await call('POST', '/employees', {
    token: admin,
    expect: 409,
    body: { firstName: 'Dup', lastName: 'Nic', email: `dup.${uniq}@example.com`, joiningDate: `${year}-01-01`, employmentType: 'PERMANENT', nic: NIC_NEW },
  });
});

await step('contract employee requires contract dates', async () => {
  await call('POST', '/employees', {
    token: admin,
    expect: 400,
    body: { firstName: 'No', lastName: 'Dates', email: `nodates.${uniq}@example.com`, joiningDate: `${year}-01-01`, employmentType: 'CONTRACT' },
  });
});

await step('create CONTRACT employee (gross LKR 200,000) with self-service account', async () => {
  employee = await call('POST', '/employees', {
    token: admin,
    expect: 201,
    body: {
      firstName: 'Kasun',
      lastName: `Test${uniq}`,
      email: `kasun.${uniq}@example.com`,
      joiningDate: `${year - 1}-06-01`,
      employmentType: 'CONTRACT',
      contractStartDate: `${year - 1}-06-01`,
      contractEndDate: `${year + 1}-05-31`,
      departmentId: lookups.v.departments.find((d) => d.code === 'DEV').id,
      nic: NIC_OLD,
      tin: '123456789',
      bankName: 'Commercial Bank',
      bankAccountNumber: '8001234567',
      createUser: { password: 'EmpPassword123', roleCodes: ['EMPLOYEE'] },
    },
  });
  assert.equal(employee.employmentType, 'CONTRACT');
  assert.ok(employee.employeeNo);
  empToken = await login(`kasun.${uniq}@example.com`, 'EmpPassword123');
  await call('POST', `/payroll/salaries/${employee.id}`, {
    token: admin,
    expect: 201,
    body: { effectiveFrom: `${year - 1}-06-01`, currency: 'LKR', components: [{ code: 'BASIC', amount: 180000 }, { code: 'TRAVEL', amount: 20000 }] },
  });
});

await step('RBAC: employee sees only own record and masked data; no payroll access', async () => {
  const list = await call('GET', '/employees', { token: empToken });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, employee.id);
  await call('GET', '/payroll/runs', { token: empToken, expect: 403 });
  await call('GET', `/employees/${hrEmployee.id}`, { token: empToken, expect: 404 });
  const hrView = await call('GET', `/employees/${employee.id}`, { token: hrToken });
  assert.equal(hrView.nic, NIC_OLD); // HR has EMPLOYEE_SENSITIVE_VIEW
});

await step('attendance: sign in, break, sign out; double sign-in rejected', async () => {
  let t = await call('GET', '/attendance/today', { token: empToken });
  assert.equal(t.state, 'NOT_SIGNED_IN');
  await call('POST', '/attendance/sign-in', { token: empToken, body: { source: 'WEB' }, expect: 201 });
  await call('POST', '/attendance/sign-in', { token: empToken, body: {}, expect: 409 });
  await call('POST', '/attendance/break/start', { token: empToken, expect: 201 });
  t = await call('GET', '/attendance/today', { token: empToken });
  assert.equal(t.state, 'ON_BREAK');
  await call('POST', '/attendance/break/end', { token: empToken, expect: 201 });
  const out = await call('POST', '/attendance/sign-out', { token: empToken, expect: 201 });
  assert.ok(out.signOutAt);
  t = await call('GET', '/attendance/today', { token: empToken });
  assert.equal(t.state, 'SIGNED_OUT');
});

await step('attendance: HR daily board and manual correction with reason', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const board = await call('GET', `/attendance/daily?date=${today}`, { token: hrToken });
  assert.ok(board.rows.some((r) => r.employee.id === employee.id));
  const rec = (await call('GET', `/attendance/records?from=${today}&to=${today}&employeeId=${employee.id}`, { token: hrToken }))[0];
  await call('PATCH', `/attendance/${rec.id}`, { token: hrToken, body: { signIn: '08:30', signOut: '17:45', reason: 'x' }, expect: 400 }); // reason too short
  const fixed = await call('PATCH', `/attendance/${rec.id}`, { token: hrToken, body: { signIn: '08:30', signOut: '17:45', breakMinutes: 60, reason: 'Forgot to sign in on time' } });
  assert.equal(fixed.workedMinutes, 495);
  const csv = await call('GET', `/attendance/export.csv?from=${today}&to=${today}`, { token: hrToken });
  assert.match(csv, /Employee No,Name,Date/);
});

let leaveReq;
await step('leave: request deducts from pending; HR approval moves it to used', async () => {
  const types = await call('GET', '/leave/types', { token: empToken });
  const annual = types.find((t) => t.code === 'ANNUAL');
  const d = nextWeekday(14);
  const before = (await call('GET', '/leave/balances/me', { token: empToken })).find((b) => b.leaveType.code === 'ANNUAL');
  leaveReq = await call('POST', '/leave/requests', { token: empToken, expect: 201, body: { leaveTypeId: annual.id, startDate: d, endDate: d, reason: 'Family event' } });
  assert.equal(leaveReq.status, 'PENDING');
  let bal = (await call('GET', '/leave/balances/me', { token: empToken })).find((b) => b.leaveType.code === 'ANNUAL');
  assert.equal(bal.pending, before.pending + 1);
  assert.equal(bal.used, before.used);
  await call('POST', '/leave/requests', { token: empToken, expect: 409, body: { leaveTypeId: annual.id, startDate: d, endDate: d } }); // overlap
  await call('POST', `/leave/requests/${leaveReq.id}/approve`, { token: empToken, body: {}, expect: 403 }); // no self-approval
  const inbox = await call('GET', '/leave/approvals', { token: hrToken });
  assert.ok(inbox.some((r) => r.id === leaveReq.id));
  const approved = await call('POST', `/leave/requests/${leaveReq.id}/approve`, { token: hrToken, body: { comment: 'Enjoy' }, expect: 201 });
  assert.equal(approved.status, 'APPROVED');
  bal = (await call('GET', '/leave/balances/me', { token: empToken })).find((b) => b.leaveType.code === 'ANNUAL');
  assert.equal(bal.used, before.used + 1);
  assert.equal(bal.pending, before.pending);
});

await step('leave: insufficient balance rejected; holiday import', async () => {
  const types = await call('GET', '/leave/types', { token: empToken });
  const paternity = types.find((t) => t.code === 'PATERNITY');
  await call('POST', '/leave/requests', { token: empToken, expect: 400, body: { leaveTypeId: paternity.id, startDate: nextWeekday(30), endDate: nextWeekday(40) } });
  const r = await call('POST', '/leave/holidays/import', { token: hrToken, expect: 201, body: { csv: `date,name,type\n${year}-12-25,Christmas Day,PUBLIC\nbad-line` } });
  assert.equal(r.errors.length, 1);
});

await step('statutory rules: 7 rules seeded; invalid version rejected; new version added', async () => {
  const rules = await call('GET', '/payroll/statutory-rules', { token: admin });
  assert.equal(rules.length, 7);
  const ct = rules.find((r) => r.code === 'CONTRACT_EMPLOYEE_TAX');
  assert.equal(ct.versions[0].config.rate, 0.05);
  assert.equal(ct.versions[0].config.thresholdAmount, 150000);
  await call('POST', '/payroll/statutory-rules/CONTRACT_EMPLOYEE_TAX/versions', { token: admin, expect: 400, body: { effectiveFrom: `${year + 1}-01-01`, config: { rate: 5 } } });
  await call('POST', '/payroll/statutory-rules/CONTRACT_EMPLOYEE_TAX/versions', {
    token: admin,
    expect: 201,
    body: { effectiveFrom: `${year + 1}-01-01`, config: { ...ct.versions[0].config, basis: 'EXCESS_OVER_THRESHOLD' }, note: 'E2E future version' },
  });
});

await step('payroll: create, calculate — contract employee has LKR 10,000.00 contract tax', async () => {
  const existing = (await call('GET', '/payroll/runs', { token: admin })).find((r) => r.year === year && r.month === month && r.status !== 'REVERSED');
  if (existing) {
    // Re-running the suite: reverse/abandon earlier run
    if (existing.status === 'POSTED') await call('POST', `/payroll/runs/${existing.id}/reverse`, { token: admin, body: { reason: 'E2E re-run' }, expect: 201 });
  }
  run = await call('POST', '/payroll/runs', { token: hrToken, body: { year, month }, expect: 403 }); // HR has no PAYROLL_RUN
  run = await call('POST', '/payroll/runs', { token: admin, body: { year, month }, expect: 201 });
  run = await call('POST', `/payroll/runs/${run.id}/calculate`, { token: admin, expect: 201 });
  assert.equal(run.status, 'CALCULATED');
  contractLine = run.lines.find((l) => l.employeeId === employee.id);
  assert.ok(contractLine, 'contract employee is in the run');
  assert.equal(Number(contractLine.grossEarnings), 200000);
  assert.equal(Number(contractLine.contractTax), 10000);
  assert.equal(Number(contractLine.epfEmployee), 14400); // 8% of BASIC 180,000 (TRAVEL not EPF-liable)
  assert.ok(contractLine.detail.deductions.some((d) => d.code === 'CONTRACT_EMPLOYEE_TAX' && d.amount === 10000));
  assert.equal(run.journal.totalDebit, run.journal.totalCredit);
});

await step('payroll: approve → post; payslip visible to employee; reports', async () => {
  run = await call('POST', `/payroll/runs/${run.id}/approve`, { token: admin, expect: 201 });
  assert.equal(run.status, 'APPROVED');
  run = await call('POST', `/payroll/runs/${run.id}/post`, { token: admin, expect: 201 });
  assert.equal(run.status, 'POSTED');
  await call('POST', `/payroll/runs/${run.id}/calculate`, { token: admin, expect: 400 }); // posted runs are immutable
  const mine = await call('GET', '/payroll/payslips/me', { token: empToken });
  assert.ok(mine.length >= 1);
  const slip = await call('GET', `/payroll/payslips/${mine[0].id}`, { token: empToken });
  assert.ok(slip.payslipNumber);
  const doc = await call('GET', `/payroll/payslips/${mine[0].id}/document?lang=si`, { token: empToken, raw: true });
  assert.equal(doc.status, 200);
  if (EXPECT_PDF) assert.equal(doc.headers.get('content-type'), 'application/pdf');
  else {
    const html = await doc.text();
    assert.match(html, /වැටුප් පත්‍රිකාව/); // Sinhala payslip title
    assert.match(html, /data:image\/png;base64/); // company logo embedded
  }
  const ct = await call('GET', `/payroll/runs/${run.id}/reports/contract-tax`, { token: admin });
  assert.ok(ct.includes(NIC_OLD));
  assert.match(ct, /10000\.00/);
  const epf = await call('GET', `/payroll/runs/${run.id}/reports/epf`, { token: admin });
  assert.match(epf, /14400\.00/);
  const bank = await call('GET', `/payroll/runs/${run.id}/reports/bank`, { token: admin });
  assert.match(bank, /8001234567/);
  const q = await call('POST', `/payroll/runs/${run.id}/email-payslips`, { token: admin, expect: 201 });
  assert.ok(q.queued >= 1);
});

let lead, conv;
await step('CRM: lead → convert → customer + opportunity', async () => {
  lead = await call('POST', '/crm/leads', {
    token: admin,
    expect: 201,
    body: { name: 'Dilani Fernando', companyName: `Ceylon Exports ${uniq}`, email: 'dilani@example.com', serviceInterest: 'Web development', estimatedValue: 750000, marketingConsent: true },
  });
  assert.match(lead.number, /^LD-\d{4}-\d{5}$/);
  conv = await call('POST', `/crm/leads/${lead.id}/convert`, { token: admin, body: { createOpportunity: true }, expect: 201 });
  assert.ok(conv.customerId && conv.opportunityId);
  await call('POST', `/crm/leads/${lead.id}/convert`, { token: admin, body: {}, expect: 400 });
  const c = await call('GET', `/crm/customers/${conv.customerId}`, { token: admin });
  assert.equal(c.contacts.length, 1);
  assert.equal(c.opportunities.length, 1);
});

await step('CRM: pipeline move, lost requires reason, line items, quotation document & email', async () => {
  const stages = await call('GET', '/crm/stages', { token: admin });
  const proposal = stages.find((s) => s.name === 'Proposal');
  const lost = stages.find((s) => s.isLost);
  await call('POST', `/crm/opportunities/${conv.opportunityId}/move`, { token: admin, body: { stageId: lost.id }, expect: 400 });
  const moved = await call('POST', `/crm/opportunities/${conv.opportunityId}/move`, { token: admin, body: { stageId: proposal.id }, expect: 201 });
  assert.equal(moved.probability, proposal.probability);
  await call('PATCH', `/crm/opportunities/${conv.opportunityId}`, {
    token: admin,
    body: { lineItems: [{ description: 'Website build', quantity: 1, unitPrice: 600000, taxCode: 'VAT' }, { description: 'Hosting (12 months)', quantity: 12, unitPrice: 12500, taxCode: 'VAT' }] },
  });
  const opp = await call('GET', `/crm/opportunities/${conv.opportunityId}`, { token: admin });
  assert.equal(opp.totals.subtotal, 750000);
  assert.equal(opp.totals.taxes[0].amount, 135000);
  assert.equal(opp.totals.total, 885000);
  const doc = await call('GET', `/crm/opportunities/${conv.opportunityId}/document?type=QUOTATION`, { token: admin, raw: true });
  assert.equal(doc.status, 200);
  if (!EXPECT_PDF) assert.match(await doc.text(), /885,000\.00/);
  const sent = await call('POST', `/crm/opportunities/${conv.opportunityId}/send-document`, { token: admin, expect: 201, body: { type: 'PROFORMA_INVOICE', to: 'customer@example.com', message: 'As discussed.' } });
  assert.match(sent.number, /^PI-\d{4}-\d{6}$/);
  const summary = await call('GET', '/crm/pipeline/summary', { token: admin });
  assert.ok(summary.pipelineValue >= 750000);
});

await step('templates: edit email subject, preview, invalid syntax rejected; invoice preview', async () => {
  const list = await call('GET', '/templates/email', { token: admin });
  const t = list.find((x) => x.key === 'LEAVE_APPROVED' && x.language === 'en');
  await call('PATCH', `/templates/email/${t.id}`, { token: admin, body: { subject: '{{#if}', bodyHtml: t.bodyHtml }, expect: 400 });
  await call('PATCH', `/templates/email/${t.id}`, { token: admin, body: { subject: 'Approved: {{leave.type}}', bodyHtml: t.bodyHtml } });
  const p = await call('POST', `/templates/email/${t.id}/preview`, { token: admin, body: {}, expect: 201 });
  assert.equal(p.subject, 'Approved: Annual leave');
  assert.match(p.html, /#123ABC/i); // branding colour in layout
  const docs = await call('GET', '/templates/documents?type=INVOICE', { token: admin });
  const inv = await call('POST', `/templates/documents/${docs[0].id}/preview`, { token: admin, body: { options: { title: 'TAX INVOICE TEST', bankDetails: 'BOC 1234' } }, expect: 201 });
  assert.match(inv, /TAX INVOICE TEST/);
  assert.match(inv, /BOC 1234/);
});

await step('emails were rendered and sent through the outbox', async () => {
  await new Promise((r) => setTimeout(r, 3000));
  const out = await call('GET', '/email-outbox?pageSize=100', { token: admin });
  const keys = new Set(out.items.map((i) => i.templateKey));
  for (const k of ['WELCOME_USER', 'LEAVE_REQUESTED', 'LEAVE_APPROVED', 'PROFORMA_INVOICE']) assert.ok(keys.has(k), `outbox has ${k}`);
  assert.ok(out.items.some((i) => i.status === 'SENT'));
  assert.ok(!out.items.some((i) => i.status === 'FAILED'), JSON.stringify(out.items.filter((i) => i.status === 'FAILED')));
});

await step('audit log records sensitive actions', async () => {
  const a = await call('GET', `/audit-logs?entity=PayrollRun&entityId=${run.id}`, { token: admin });
  const actions = a.items.map((i) => i.action);
  for (const x of ['CREATE', 'CALCULATE', 'APPROVED', 'POST']) assert.ok(actions.includes(x), `audit has ${x}`);
});

await step('dashboard: HR summary', async () => {
  const d = await call('GET', '/dashboard/hr', { token: hrToken });
  assert.ok(d.headcount >= 2);
});

await step('refresh token rotation and logout', async () => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const r1 = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { cookie } });
  assert.equal(r1.status, 200);
  const r2 = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { cookie } }); // reuse of rotated token
  assert.equal(r2.status, 401);
});

console.log(`\nAll ${passed} E2E steps passed.`);
