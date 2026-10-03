/**
 * DEMO DATA ONLY — for evaluation and UI development. Enabled with SEED_DEMO=true.
 * Uses example.com addresses. Never enable in production.
 */
import type { PrismaClient, EmploymentType, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

export async function seedDemo(prisma: PrismaClient, companyId: string) {
  if (await prisma.employee.findFirst({ where: { companyId, email: 'kasun.silva@example.com' } })) {
    console.log('Demo data already present');
    return;
  }
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error('SEED_DEMO_PASSWORD is required when SEED_DEMO=true');
  const hash = await argon2.hash(password, { type: argon2.argon2id });

  const dept = async (code: string) => (await prisma.department.findUniqueOrThrow({ where: { companyId_code: { companyId, code } } })).id;
  const desig = async (name: string) => (await prisma.designation.findUniqueOrThrow({ where: { companyId_name: { companyId, name } } })).id;
  const role = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { companyId_code: { companyId, code } } })).id;
  const schedule = await prisma.workSchedule.findFirstOrThrow({ where: { companyId, isDefault: true } });

  await prisma.exchangeRate.upsert({
    where: { companyId_fromCurrency_toCurrency_effectiveDate: { companyId, fromCurrency: 'USD', toCurrency: 'LKR', effectiveDate: day(-60) } },
    create: { companyId, fromCurrency: 'USD', toCurrency: 'LKR', rate: 300, effectiveDate: day(-60), source: 'Demo rate' },
    update: {},
  });

  const people: {
    no: string;
    first: string;
    last: string;
    email: string;
    type: EmploymentType;
    dept: string;
    desig: string;
    basic: number;
    travel?: number;
    currency?: string;
    roles?: string[];
    managerNo?: string;
    contractEnd?: number;
  }[] = [
    { no: 'EMP0001', first: 'Nadeesha', last: 'Perera', email: 'nadeesha.perera@example.com', type: 'PERMANENT', dept: 'HR', desig: 'HR Executive', basic: 250000, roles: ['HR_MANAGER', 'EMPLOYEE'] },
    { no: 'EMP0002', first: 'Ruwan', last: 'Jayasinghe', email: 'ruwan.jayasinghe@example.com', type: 'PERMANENT', dept: 'DEV', desig: 'Tech Lead', basic: 380000, travel: 20000, roles: ['TEAM_LEAD', 'EMPLOYEE'] },
    { no: 'EMP0003', first: 'Kasun', last: 'Silva', email: 'kasun.silva@example.com', type: 'CONTRACT', dept: 'DEV', desig: 'Software Engineer', basic: 180000, travel: 20000, roles: ['EMPLOYEE'], managerNo: 'EMP0002', contractEnd: 25 },
    { no: 'EMP0004', first: 'Tharindu', last: 'Fernando', email: 'tharindu.fernando@example.com', type: 'CONTRACT', dept: 'QA', desig: 'QA Engineer', basic: 140000, managerNo: 'EMP0002', contractEnd: 120 },
    { no: 'EMP0005', first: 'Dilini', last: 'Wickramasinghe', email: 'dilini.wickramasinghe@example.com', type: 'PERMANENT', dept: 'FIN', desig: 'Accountant', basic: 160000, roles: ['PAYROLL_OFFICER', 'EMPLOYEE'] },
    { no: 'EMP0006', first: 'Amal', last: 'Gunawardena', email: 'amal.gunawardena@example.com', type: 'PROBATION', dept: 'SALES', desig: 'Sales Executive', basic: 120000, roles: ['SALES_USER', 'EMPLOYEE'] },
    { no: 'EMP0007', first: 'Sanjaya', last: 'Ranasinghe', email: 'sanjaya.ranasinghe@example.com', type: 'PERMANENT', dept: 'FIN', desig: 'Project Manager', basic: 300000, roles: ['FINANCE_MANAGER', 'SALES_MANAGER', 'EMPLOYEE'] },
    { no: 'EMP0008', first: 'Priya', last: 'Raj', email: 'priya.raj@example.com', type: 'CONSULTANT', dept: 'DEV', desig: 'Business Analyst', basic: 1500, currency: 'USD' },
  ];

  const ids = new Map<string, string>();
  for (const p of people) {
    let userId: string | undefined;
    if (p.roles) {
      const roleIds = await Promise.all(p.roles.map(role));
      const u = await prisma.user.create({
        data: { companyId, email: p.email, displayName: `${p.first} ${p.last}`, passwordHash: hash, roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      });
      userId = u.id;
    }
    const joining = p.type === 'PROBATION' ? day(-75) : day(-400);
    const e = await prisma.employee.create({
      data: {
        companyId,
        employeeNo: p.no,
        userId,
        firstName: p.first,
        lastName: p.last,
        email: p.email,
        joiningDate: joining,
        employmentType: p.type,
        departmentId: await dept(p.dept),
        designationId: await desig(p.desig),
        managerId: p.managerNo ? ids.get(p.managerNo) : null,
        workScheduleId: schedule.id,
        epfNumber: p.type === 'CONSULTANT' ? null : String(1000 + Number(p.no.slice(3))),
        bankName: 'Commercial Bank',
        bankBranch: 'Colombo 03',
      },
    });
    ids.set(p.no, e.id);
    await prisma.employmentContract.create({
      data: { companyId, employeeId: e.id, employmentType: p.type, startDate: p.contractEnd ? day(-200) : joining, endDate: p.contractEnd ? day(p.contractEnd) : null },
    });
    const components = [{ code: 'BASIC', amount: p.basic }, ...(p.travel ? [{ code: 'TRAVEL', amount: p.travel }] : [])];
    await prisma.employeeSalary.create({ data: { companyId, employeeId: e.id, effectiveFrom: joining, currency: p.currency ?? 'LKR', components: components as unknown as Prisma.InputJsonValue, note: 'Demo salary' } });
  }
  await prisma.numberSequence.upsert({
    where: { companyId_key: { companyId, key: 'EMPLOYEE' } },
    create: { companyId, key: 'EMPLOYEE', prefix: 'EMP', format: '{PREFIX}{SEQ}', padding: 4, nextValue: people.length + 1, resetYearly: false },
    update: { nextValue: people.length + 1 },
  });

  // A few days of attendance for the dashboard.
  for (let i = 1; i <= 5; i++) {
    const d = day(-i);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (const no of ['EMP0002', 'EMP0003', 'EMP0004']) {
      const signIn = new Date(d.getTime() + (3 * 60 + (no === 'EMP0004' ? 40 : 0)) * 60000); // 08:30 / 09:10 Colombo
      const signOut = new Date(d.getTime() + 12 * 60 * 60000); // 17:30 Colombo
      await prisma.attendanceRecord.create({
        data: {
          companyId,
          employeeId: ids.get(no)!,
          workDate: d,
          signInAt: signIn,
          signOutAt: signOut,
          status: 'PRESENT',
          workedMinutes: Math.round((signOut.getTime() - signIn.getTime()) / 60000) - 60,
          breakMinutes: 60,
          lateMinutes: no === 'EMP0004' ? 40 : 0,
        },
      });
    }
  }

  // CRM
  const salesUser = await prisma.user.findUniqueOrThrow({ where: { email: 'amal.gunawardena@example.com' } });
  const stage = async (name: string) => (await prisma.pipelineStage.findUniqueOrThrow({ where: { companyId_name: { companyId, name } } })).id;
  const website = await prisma.leadSource.findUniqueOrThrow({ where: { companyId_name: { companyId, name: 'Website' } } });
  const c1 = await prisma.customer.create({ data: { companyId, code: 'CUS-00001', name: 'Lanka Logistics (Pvt) Ltd', industry: 'Logistics', country: 'LK', email: 'it@example.com', status: 'ACTIVE', ownerUserId: salesUser.id, address: 'Colombo 02' } });
  const c2 = await prisma.customer.create({ data: { companyId, code: 'CUS-00002', name: 'Kiwi Retail Group', industry: 'Retail', country: 'NZ', currency: 'NZD', email: 'projects@example.com', status: 'PROSPECT', ownerUserId: salesUser.id } });
  await prisma.contact.create({ data: { companyId, customerId: c1.id, firstName: 'Nimal', lastName: 'Perera', email: 'nimal@example.com', isPrimary: true } });
  await prisma.contact.create({ data: { companyId, customerId: c2.id, firstName: 'Sarah', lastName: 'Thompson', email: 'sarah@example.com', isPrimary: true } });
  await prisma.numberSequence.upsert({ where: { companyId_key: { companyId, key: 'CUSTOMER' } }, create: { companyId, key: 'CUSTOMER', prefix: 'CUS', format: '{PREFIX}-{SEQ}', padding: 5, nextValue: 3, resetYearly: false }, update: {} });

  const year = new Date().getFullYear();
  const opps = [
    { title: 'Fleet tracking mobile app', customerId: c1.id, value: 2400000, stage: 'Proposal', items: [{ description: 'Mobile app (iOS + Android)', quantity: 1, unitPrice: 1800000, taxCode: 'VAT' }, { description: 'Admin web portal', quantity: 1, unitPrice: 600000, taxCode: 'VAT' }] },
    { title: 'E-commerce platform rebuild', customerId: c2.id, value: 85000, currency: 'NZD', stage: 'Negotiation', items: [] },
    { title: 'Annual maintenance contract', customerId: c1.id, value: 960000, stage: 'Won', items: [{ description: 'Support & maintenance (12 months)', quantity: 12, unitPrice: 80000, taxCode: 'VAT' }] },
  ];
  let i = 1;
  for (const o of opps) {
    const st = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: await stage(o.stage) } });
    await prisma.opportunity.create({
      data: {
        companyId,
        number: `OPP-${year}-${String(i++).padStart(5, '0')}`,
        title: o.title,
        customerId: o.customerId,
        expectedValue: o.value,
        currency: o.currency ?? 'LKR',
        probability: st.probability,
        stageId: st.id,
        status: st.isWon ? 'WON' : 'OPEN',
        closedAt: st.isWon ? new Date() : null,
        ownerUserId: salesUser.id,
        expectedCloseDate: day(45),
        lineItems: o.items as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await prisma.numberSequence.upsert({ where: { companyId_key: { companyId, key: 'OPPORTUNITY' } }, create: { companyId, key: 'OPPORTUNITY', prefix: 'OPP', format: '{PREFIX}-{YYYY}-{SEQ}', padding: 5, nextValue: i, resetYearly: true, lastYear: year }, update: {} });

  const leads = [
    { name: 'Dilani Fernando', companyName: 'Ceylon Tea Exports', serviceInterest: 'Web development', estimatedValue: 750000, status: 'NEW' as const },
    { name: 'Mohamed Rizwan', companyName: 'Rizwan Holdings', serviceInterest: 'Cloud migration (AWS)', estimatedValue: 1200000, status: 'CONTACTED' as const },
    { name: 'James Walker', companyName: 'Auckland Dental', serviceInterest: 'SEO & digital marketing', estimatedValue: 450000, status: 'QUALIFIED' as const },
  ];
  let li = 1;
  for (const l of leads) {
    await prisma.lead.create({
      data: { ...l, companyId, number: `LD-${year}-${String(li++).padStart(5, '0')}`, sourceId: website.id, ownerUserId: salesUser.id, nextFollowUpAt: day(li), email: `${l.name.split(' ')[0].toLowerCase()}@example.com` },
    });
  }
  await prisma.numberSequence.upsert({ where: { companyId_key: { companyId, key: 'LEAD' } }, create: { companyId, key: 'LEAD', prefix: 'LD', format: '{PREFIX}-{YYYY}-{SEQ}', padding: 5, nextValue: li, resetYearly: true, lastYear: year }, update: {} });

  console.log(`Demo data created. Demo users sign in with SEED_DEMO_PASSWORD: ${people.filter((p) => p.roles).map((p) => p.email).join(', ')}`);
}
