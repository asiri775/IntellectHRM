/**
 * Default, editable templates. They are seeded into the database per company and
 * can then be changed in Settings → Email templates / Document templates.
 * Syntax: Handlebars. {{var}} is HTML-escaped; {{{var}}} is raw (used only for
 * trusted, pre-rendered content such as the email body inside the layout).
 */

export const EMAIL_LAYOUT = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{subject}}</title></head>
<body style="margin:0;padding:0;background:#f3f5f9;font-family:'Segoe UI',Roboto,'Noto Sans Sinhala','Noto Sans Tamil',Arial,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f9;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr><td style="background:{{company.primaryColor}};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
    <tr><td style="padding:24px 32px 8px 32px;">
      {{#if company.logoUrl}}<img src="{{company.logoUrl}}" alt="{{company.name}}" style="max-height:48px;max-width:220px;display:block;border:0;">{{else}}<div style="font-size:20px;font-weight:700;color:{{company.primaryColor}};">{{company.name}}</div>{{/if}}
    </td></tr>
    <tr><td style="padding:8px 32px 24px 32px;font-size:15px;line-height:1.6;">{{{content}}}</td></tr>
    <tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5;">
      {{#if company.emailFooter}}{{company.emailFooter}}<br>{{/if}}
      {{company.name}}{{#if company.address}} · {{company.address}}{{/if}}<br>
      This is an automated message from the {{company.name}} HR system. Please do not reply to this email.
    </td></tr>
  </table>
</td></tr></table></body></html>`;

const btn = (href: string, label: string) =>
  `<p style="margin:24px 0;"><a href="${href}" style="background:{{company.primaryColor}};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:600;">${label}</a></p>`;

export interface DefaultEmailTemplate {
  key: string;
  language: string;
  name: string;
  subject: string;
  bodyHtml: string;
}

export const DEFAULT_EMAIL_TEMPLATES: DefaultEmailTemplate[] = [
  { key: 'LAYOUT', language: 'en', name: 'Email layout (header, logo, footer)', subject: '{{subject}}', bodyHtml: EMAIL_LAYOUT },
  {
    key: 'WELCOME_USER',
    language: 'en',
    name: 'New user account',
    subject: 'Your {{company.name}} account',
    bodyHtml: `<p>Hello {{user.displayName}},</p><p>An account has been created for you on the {{company.name}} HR system.</p><p>Sign-in email: <strong>{{user.email}}</strong></p><p>Your administrator will give you a temporary password. You will be asked to change it when you first sign in.</p>${btn('{{appUrl}}/login', 'Sign in')}`,
  },
  {
    key: 'LEAVE_REQUESTED',
    language: 'en',
    name: 'Leave request awaiting approval',
    subject: 'Leave request from {{employee.name}} – {{leave.type}}',
    bodyHtml: `<p>Hello {{approver.name}},</p><p><strong>{{employee.name}}</strong> has requested <strong>{{leave.days}} day(s)</strong> of {{leave.type}} from <strong>{{date leave.startDate}}</strong> to <strong>{{date leave.endDate}}</strong>.</p>{{#if leave.reason}}<p>Reason: {{leave.reason}}</p>{{/if}}${btn('{{appUrl}}/leave/approvals', 'Review request')}`,
  },
  {
    key: 'LEAVE_APPROVED',
    language: 'en',
    name: 'Leave approved',
    subject: 'Your leave has been approved',
    bodyHtml: `<p>Hello {{employee.name}},</p><p>Your {{leave.type}} request for <strong>{{leave.days}} day(s)</strong> from <strong>{{date leave.startDate}}</strong> to <strong>{{date leave.endDate}}</strong> has been <strong style="color:#059669;">approved</strong>.</p>{{#if comment}}<p>Comment: {{comment}}</p>{{/if}}`,
  },
  {
    key: 'LEAVE_REJECTED',
    language: 'en',
    name: 'Leave rejected',
    subject: 'Your leave request was not approved',
    bodyHtml: `<p>Hello {{employee.name}},</p><p>Your {{leave.type}} request from <strong>{{date leave.startDate}}</strong> to <strong>{{date leave.endDate}}</strong> was <strong style="color:#dc2626;">not approved</strong>.</p>{{#if comment}}<p>Comment: {{comment}}</p>{{/if}}<p>Please contact your manager if you have questions.</p>`,
  },
  {
    key: 'PAYSLIP_PUBLISHED',
    language: 'en',
    name: 'Payslip available',
    subject: 'Your payslip for {{period}}',
    bodyHtml: `<p>Hello {{employee.name}},</p><p>Your payslip for <strong>{{period}}</strong> is now available. Net pay: <strong>{{money netPay currency}}</strong>.</p><p>The payslip is attached and can also be viewed in the HR system.</p>${btn('{{appUrl}}/payroll/my-payslips', 'View payslips')}`,
  },
  {
    key: 'CONTRACT_ENDING',
    language: 'en',
    name: 'Contract ending reminder (to HR)',
    subject: 'Contract ending in {{daysLeft}} days: {{employee.name}}',
    bodyHtml: `<p>Hello,</p><p>The employment contract of <strong>{{employee.name}}</strong> ({{employee.employeeNo}}) ends on <strong>{{date contract.endDate}}</strong> — {{daysLeft}} days from today.</p><p>Please renew or end the contract before that date.</p>${btn('{{appUrl}}/employees/{{employee.id}}', 'Open employee')}`,
  },
  {
    key: 'MISSING_CHECKOUT',
    language: 'en',
    name: 'Missing sign-out',
    subject: 'You did not sign out on {{date workDate}}',
    bodyHtml: `<p>Hello {{employee.name}},</p><p>Our records show you signed in on <strong>{{date workDate}}</strong> but did not sign out. Please ask your manager to correct the record.</p>`,
  },
  {
    key: 'LEAD_ASSIGNED',
    language: 'en',
    name: 'Lead assigned',
    subject: 'New lead assigned: {{lead.name}}',
    bodyHtml: `<p>Hello {{owner.name}},</p><p>Lead <strong>{{lead.number}} – {{lead.name}}</strong>{{#if lead.companyName}} ({{lead.companyName}}){{/if}} has been assigned to you.</p>{{#if lead.serviceInterest}}<p>Interested in: {{lead.serviceInterest}}</p>{{/if}}${btn('{{appUrl}}/crm/leads/{{lead.id}}', 'Open lead')}`,
  },
  {
    key: 'FOLLOW_UP_REMINDER',
    language: 'en',
    name: 'Lead follow-up reminder',
    subject: 'Follow up today: {{lead.name}}',
    bodyHtml: `<p>Hello {{owner.name}},</p><p>A follow-up is due for lead <strong>{{lead.number}} – {{lead.name}}</strong>.</p>${btn('{{appUrl}}/crm/leads/{{lead.id}}', 'Open lead')}`,
  },
  {
    key: 'PROFORMA_INVOICE',
    language: 'en',
    name: 'Quotation / proforma invoice to customer',
    subject: '{{doc.title}} {{doc.number}} from {{company.name}}',
    bodyHtml: `<p>Dear {{customer.contactName}},</p><p>Please find attached {{doc.title}} <strong>{{doc.number}}</strong> for <strong>{{money totals.total doc.currency}}</strong>.</p>{{#if message}}<p>{{message}}</p>{{/if}}<p>Kind regards,<br>{{sender.name}}<br>{{company.name}}</p>`,
  },

  // ── Sinhala (සිංහල) — please have a native speaker review before go-live ──
  {
    key: 'LEAVE_APPROVED',
    language: 'si',
    name: 'නිවාඩු අනුමත විය',
    subject: 'ඔබගේ නිවාඩු ඉල්ලීම අනුමත කර ඇත',
    bodyHtml: `<p>ආයුබෝවන් {{employee.name}},</p><p><strong>{{date leave.startDate}}</strong> සිට <strong>{{date leave.endDate}}</strong> දක්වා දින <strong>{{leave.days}}</strong> ක {{leave.type}} සඳහා වූ ඔබගේ ඉල්ලීම <strong style="color:#059669;">අනුමත කර ඇත</strong>.</p>{{#if comment}}<p>සටහන: {{comment}}</p>{{/if}}`,
  },
  {
    key: 'LEAVE_REJECTED',
    language: 'si',
    name: 'නිවාඩු ප්‍රතික්ෂේප විය',
    subject: 'ඔබගේ නිවාඩු ඉල්ලීම අනුමත නොවීය',
    bodyHtml: `<p>ආයුබෝවන් {{employee.name}},</p><p><strong>{{date leave.startDate}}</strong> සිට <strong>{{date leave.endDate}}</strong> දක්වා වූ ඔබගේ {{leave.type}} ඉල්ලීම <strong style="color:#dc2626;">අනුමත නොවීය</strong>.</p>{{#if comment}}<p>සටහන: {{comment}}</p>{{/if}}`,
  },
  {
    key: 'PAYSLIP_PUBLISHED',
    language: 'si',
    name: 'වැටුප් පත්‍රිකාව',
    subject: '{{period}} සඳහා ඔබගේ වැටුප් පත්‍රිකාව',
    bodyHtml: `<p>ආයුබෝවන් {{employee.name}},</p><p><strong>{{period}}</strong> සඳහා ඔබගේ වැටුප් පත්‍රිකාව දැන් ලබා ගත හැක. ශුද්ධ වැටුප: <strong>{{money netPay currency}}</strong>.</p>${btn('{{appUrl}}/payroll/my-payslips', 'වැටුප් පත්‍රිකා බලන්න')}`,
  },
  // ── Tamil (தமிழ்) — please have a native speaker review before go-live ──
  {
    key: 'LEAVE_APPROVED',
    language: 'ta',
    name: 'விடுப்பு அங்கீகரிக்கப்பட்டது',
    subject: 'உங்கள் விடுப்பு அங்கீகரிக்கப்பட்டது',
    bodyHtml: `<p>வணக்கம் {{employee.name}},</p><p><strong>{{date leave.startDate}}</strong> முதல் <strong>{{date leave.endDate}}</strong> வரை <strong>{{leave.days}}</strong> நாள் {{leave.type}} க்கான உங்கள் கோரிக்கை <strong style="color:#059669;">அங்கீகரிக்கப்பட்டது</strong>.</p>{{#if comment}}<p>குறிப்பு: {{comment}}</p>{{/if}}`,
  },
  {
    key: 'LEAVE_REJECTED',
    language: 'ta',
    name: 'விடுப்பு நிராகரிக்கப்பட்டது',
    subject: 'உங்கள் விடுப்பு கோரிக்கை அங்கீகரிக்கப்படவில்லை',
    bodyHtml: `<p>வணக்கம் {{employee.name}},</p><p><strong>{{date leave.startDate}}</strong> முதல் <strong>{{date leave.endDate}}</strong> வரையிலான உங்கள் {{leave.type}} கோரிக்கை <strong style="color:#dc2626;">அங்கீகரிக்கப்படவில்லை</strong>.</p>{{#if comment}}<p>குறிப்பு: {{comment}}</p>{{/if}}`,
  },
  {
    key: 'PAYSLIP_PUBLISHED',
    language: 'ta',
    name: 'சம்பளச் சீட்டு',
    subject: '{{period}} க்கான உங்கள் சம்பளச் சீட்டு',
    bodyHtml: `<p>வணக்கம் {{employee.name}},</p><p><strong>{{period}}</strong> க்கான உங்கள் சம்பளச் சீட்டு இப்போது கிடைக்கிறது. நிகர சம்பளம்: <strong>{{money netPay currency}}</strong>.</p>${btn('{{appUrl}}/payroll/my-payslips', 'சம்பளச் சீட்டுகளைப் பார்க்க')}`,
  },
];

// ─────────────────────────────── Document templates ───────────────────────────────

const BASE_CSS = `
@page { size: {{options.paperSize}}; margin: 14mm 14mm 18mm 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Roboto, 'Noto Sans Sinhala', 'Noto Sans Tamil', Arial, sans-serif; color: #1f2937; font-size: 12px; margin: 0; }
.doc { max-width: 800px; margin: 0 auto; }
.head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid {{theme.primary}}; padding-bottom: 14px; margin-bottom: 18px; }
.logo img { max-height: 64px; max-width: 240px; }
.logo .name { font-size: 22px; font-weight: 700; color: {{theme.primary}}; }
.company { text-align: right; font-size: 11px; color: #4b5563; line-height: 1.5; }
h1 { font-size: 24px; letter-spacing: .5px; margin: 0 0 4px; color: {{theme.primary}}; text-transform: uppercase; }
.meta { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
.box { flex: 1; }
.label { font-size: 10px; text-transform: uppercase; color: #6b7280; letter-spacing: .6px; margin-bottom: 4px; }
table.lines { width: 100%; border-collapse: collapse; margin-top: 8px; }
table.lines th { background: {{theme.primary}}; color: #fff; text-align: left; padding: 8px; font-size: 11px; font-weight: 600; }
table.lines td { padding: 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
table.lines tr:nth-child(even) td { background: #f9fafb; }
.num { text-align: right; white-space: nowrap; }
.totals { width: 300px; margin-left: auto; margin-top: 12px; border-collapse: collapse; }
.totals td { padding: 6px 8px; }
.totals .grand td { border-top: 2px solid {{theme.primary}}; font-weight: 700; font-size: 14px; color: {{theme.primary}}; }
.section { margin-top: 22px; }
.footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #6b7280; text-align: center; }
.muted { color: #6b7280; }
`;

export const INVOICE_TEMPLATE_HTML = `<div class="doc">
  <div class="head">
    <div class="logo">{{#if (and options.showLogo company.logo)}}<img src="{{company.logo}}" alt="{{company.name}}">{{else}}<div class="name">{{company.name}}</div>{{/if}}</div>
    <div class="company">
      <strong>{{#if company.legalName}}{{company.legalName}}{{else}}{{company.name}}{{/if}}</strong><br>
      {{#if company.address}}{{company.address}}<br>{{/if}}
      {{#if company.phone}}{{company.phone}} · {{/if}}{{company.email}}<br>
      {{#if company.website}}{{company.website}}<br>{{/if}}
      {{#if company.tin}}TIN: {{company.tin}}{{/if}}{{#if company.vatNumber}} · VAT: {{company.vatNumber}}{{/if}}
    </div>
  </div>

  <div class="meta">
    <div class="box">
      <h1>{{#if options.title}}{{options.title}}{{else}}{{doc.title}}{{/if}}</h1>
      <div><strong>No:</strong> {{doc.number}}</div>
      <div><strong>Date:</strong> {{date doc.date}}</div>
      {{#if doc.dueDate}}<div><strong>{{#if (eq doc.type "QUOTATION")}}Valid until{{else}}Due date{{/if}}:</strong> {{date doc.dueDate}}</div>{{/if}}
      {{#if doc.reference}}<div><strong>Reference:</strong> {{doc.reference}}</div>{{/if}}
    </div>
    <div class="box">
      <div class="label">Bill to</div>
      <strong>{{customer.name}}</strong><br>
      {{#if customer.contactName}}Attn: {{customer.contactName}}<br>{{/if}}
      {{#if customer.address}}{{customer.address}}<br>{{/if}}
      {{#if customer.email}}{{customer.email}}<br>{{/if}}
      {{#if customer.tin}}TIN: {{customer.tin}}{{/if}}{{#if customer.vatNumber}} · VAT: {{customer.vatNumber}}{{/if}}
    </div>
  </div>

  <table class="lines">
    <thead><tr><th style="width:36px">#</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th>{{#if options.showTaxColumn}}<th>Tax</th>{{/if}}<th class="num">Amount ({{doc.currency}})</th></tr></thead>
    <tbody>
      {{#each lines}}
      <tr><td>{{inc @index}}</td><td>{{description}}</td><td class="num">{{quantity}}</td><td class="num">{{money unitPrice}}</td>{{#if ../options.showTaxColumn}}<td>{{taxCode}}</td>{{/if}}<td class="num">{{money amount}}</td></tr>
      {{/each}}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>Subtotal</td><td class="num">{{money totals.subtotal}}</td></tr>
    {{#if totals.discount}}<tr><td>Discount</td><td class="num">− {{money totals.discount}}</td></tr>{{/if}}
    {{#each totals.taxes}}<tr><td>{{name}} ({{percent rate}})</td><td class="num">{{money amount}}</td></tr>{{/each}}
    <tr class="grand"><td>Total</td><td class="num">{{money totals.total doc.currency}}</td></tr>
  </table>

  {{#if doc.notes}}<div class="section"><div class="label">Notes</div>{{doc.notes}}</div>{{/if}}
  {{#if options.paymentTerms}}<div class="section"><div class="label">Payment terms</div>{{options.paymentTerms}}</div>{{/if}}
  {{#if options.bankDetails}}<div class="section"><div class="label">Bank details</div><div style="white-space:pre-line">{{options.bankDetails}}</div></div>{{/if}}
  {{#if options.terms}}<div class="section muted" style="white-space:pre-line">{{options.terms}}</div>{{/if}}

  <div class="footer">{{#if options.footerText}}{{options.footerText}}{{else}}Thank you for your business.{{/if}}</div>
</div>`;

export const PAYSLIP_TEMPLATE_HTML = `<div class="doc">
  <div class="head">
    <div class="logo">{{#if (and options.showLogo company.logo)}}<img src="{{company.logo}}" alt="{{company.name}}">{{else}}<div class="name">{{company.name}}</div>{{/if}}</div>
    <div class="company"><strong>{{company.name}}</strong><br>{{#if company.address}}{{company.address}}<br>{{/if}}{{company.email}}</div>
  </div>
  <h1 style="text-transform:none">{{t.title}} – {{period}}</h1>
  <div class="meta">
    <div class="box">
      <div><strong>{{t.employee}}:</strong> {{employee.name}} ({{employee.employeeNo}})</div>
      <div><strong>{{t.designation}}:</strong> {{employee.designation}}</div>
      <div><strong>{{t.department}}:</strong> {{employee.department}}</div>
      <div><strong>{{t.employmentType}}:</strong> {{employee.employmentType}}</div>
    </div>
    <div class="box">
      <div><strong>{{t.payslipNo}}:</strong> {{payslip.number}}</div>
      <div><strong>EPF No:</strong> {{employee.epfNumber}}</div>
      <div><strong>{{t.workingDays}}:</strong> {{payslip.employedDays}} / {{payslip.workingDays}}{{#if payslip.noPayDays}} · {{t.noPay}}: {{payslip.noPayDays}}{{/if}}</div>
      <div><strong>{{t.bank}}:</strong> {{employee.bank}}</div>
    </div>
  </div>
  <div style="display:flex;gap:16px;">
    <table class="lines" style="flex:1"><thead><tr><th>{{t.earnings}}</th><th class="num">{{currency}}</th></tr></thead><tbody>
      {{#each earnings}}<tr><td>{{name}}</td><td class="num">{{money amount}}</td></tr>{{/each}}
      <tr><td><strong>{{t.totalEarnings}}</strong></td><td class="num"><strong>{{money totalEarnings}}</strong></td></tr>
    </tbody></table>
    <table class="lines" style="flex:1"><thead><tr><th>{{t.deductions}}</th><th class="num">{{currency}}</th></tr></thead><tbody>
      {{#each deductions}}<tr><td>{{name}}</td><td class="num">{{money amount}}</td></tr>{{/each}}
      <tr><td><strong>{{t.totalDeductions}}</strong></td><td class="num"><strong>{{money totalDeductions}}</strong></td></tr>
    </tbody></table>
  </div>
  <table class="totals"><tr class="grand"><td>{{t.netPay}}</td><td class="num">{{money netPay currency}}</td></tr></table>
  {{#if options.showEmployerContributions}}
  <div class="section"><div class="label">{{t.employerContributions}}</div>
    {{#each employerContributions}}<span style="margin-right:18px">{{name}}: {{money amount}}</span>{{/each}}
  </div>{{/if}}
  <div class="footer">{{#if options.footerText}}{{options.footerText}}{{else}}{{t.footer}}{{/if}}</div>
</div>`;

export const DEFAULT_DOCUMENT_TEMPLATES = [
  {
    type: 'INVOICE' as const,
    name: 'Standard tax invoice',
    html: INVOICE_TEMPLATE_HTML,
    css: BASE_CSS,
    options: {
      title: 'Tax Invoice',
      paperSize: 'A4',
      showLogo: true,
      showTaxColumn: true,
      paymentTerms: 'Payment due within 30 days of invoice date.',
      bankDetails: '',
      terms: '',
      footerText: 'Thank you for your business.',
    },
  },
  {
    type: 'PROFORMA_INVOICE' as const,
    name: 'Proforma invoice',
    html: INVOICE_TEMPLATE_HTML,
    css: BASE_CSS,
    options: {
      title: 'Proforma Invoice',
      paperSize: 'A4',
      showLogo: true,
      showTaxColumn: true,
      paymentTerms: 'Advance payment required to confirm the order.',
      bankDetails: '',
      terms: 'This is a proforma invoice and is not a demand for payment or a tax invoice.',
      footerText: 'Thank you for your business.',
    },
  },
  {
    type: 'QUOTATION' as const,
    name: 'Quotation',
    html: INVOICE_TEMPLATE_HTML,
    css: BASE_CSS,
    options: {
      title: 'Quotation',
      paperSize: 'A4',
      showLogo: true,
      showTaxColumn: false,
      paymentTerms: '',
      bankDetails: '',
      terms: 'Quotation valid for 30 days. Prices are subject to the scope described above.',
      footerText: 'We look forward to working with you.',
    },
  },
  {
    type: 'PAYSLIP' as const,
    name: 'Payslip',
    html: PAYSLIP_TEMPLATE_HTML,
    css: BASE_CSS,
    options: { paperSize: 'A4', showLogo: true, showEmployerContributions: true, footerText: '' },
  },
];

/** Localised names for payslip lines (by component/deduction code) and employment types. */
export const PAYSLIP_LINE_NAMES: Record<string, Record<string, string>> = {
  si: {
    BASIC: 'මූලික වැටුප',
    FIXED_ALLOWANCE: 'ස්ථාවර දීමනාව',
    TRAVEL: 'ගමන් දීමනාව',
    COMMUNICATION: 'සන්නිවේදන දීමනාව',
    OVERTIME: 'අතිකාල',
    BONUS: 'ප්‍රසාද දීමනාව',
    NO_PAY: 'වැටුප් රහිත නිවාඩු',
    EPF_EMPLOYEE: 'EPF සේවක දායකත්වය',
    EPF_EMPLOYER: 'EPF සේවා යෝජක දායකත්වය',
    ETF: 'ETF දායකත්වය',
    APIT: 'APIT / PAYE බද්ද',
    CONTRACT_EMPLOYEE_TAX: 'කොන්ත්‍රාත් සේවක බද්ද',
    GRATUITY_ACCRUAL: 'පාරිතෝෂික ප්‍රතිපාදනය',
    PERMANENT: 'ස්ථිර',
    PROBATION: 'පරිවාස',
    CONTRACT: 'කොන්ත්‍රාත්',
    INTERN: 'පුහුණු',
    CONSULTANT: 'උපදේශක',
  },
  ta: {
    BASIC: 'அடிப்படைச் சம்பளம்',
    FIXED_ALLOWANCE: 'நிலையான படி',
    TRAVEL: 'பயணப்படி',
    COMMUNICATION: 'தொடர்பாடல் படி',
    OVERTIME: 'மேலதிக நேரம்',
    BONUS: 'போனஸ்',
    NO_PAY: 'சம்பளமற்ற விடுப்பு',
    EPF_EMPLOYEE: 'EPF ஊழியர் பங்களிப்பு',
    EPF_EMPLOYER: 'EPF முதலாளி பங்களிப்பு',
    ETF: 'ETF பங்களிப்பு',
    APIT: 'APIT / PAYE வரி',
    CONTRACT_EMPLOYEE_TAX: 'ஒப்பந்த ஊழியர் வரி',
    GRATUITY_ACCRUAL: 'பணிக்கொடை ஒதுக்கம்',
    PERMANENT: 'நிரந்தர',
    PROBATION: 'தகுதிகாண்',
    CONTRACT: 'ஒப்பந்த',
    INTERN: 'பயிற்சி',
    CONSULTANT: 'ஆலோசகர்',
  },
  en: { PERMANENT: 'Permanent', PROBATION: 'Probation', CONTRACT: 'Contract', INTERN: 'Intern', CONSULTANT: 'Consultant' },
};

/** Translate a payslip line, keeping any rate suffix such as "(8%)". */
export function localiseLine(line: { code: string; name: string }, lang: string) {
  const name = PAYSLIP_LINE_NAMES[lang]?.[line.code];
  if (!name) return line;
  const rate = /\(([\d.]+%)\)$/.exec(line.name)?.[1];
  return { ...line, name: rate ? `${name} (${rate})` : name };
}

export function periodName(year: number, month: number, lang: string) {
  const locale = lang === 'si' ? 'si-LK' : lang === 'ta' ? 'ta-LK' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Payslip labels per language (used as {{t.*}} in the payslip template). */
export const PAYSLIP_LABELS: Record<string, Record<string, string>> = {
  en: {
    title: 'Payslip',
    employee: 'Employee',
    designation: 'Designation',
    department: 'Department',
    employmentType: 'Employment type',
    payslipNo: 'Payslip no',
    workingDays: 'Days paid',
    noPay: 'No-pay days',
    bank: 'Bank',
    earnings: 'Earnings',
    deductions: 'Deductions',
    totalEarnings: 'Total earnings',
    totalDeductions: 'Total deductions',
    netPay: 'Net pay',
    employerContributions: 'Employer contributions (not deducted from your pay)',
    footer: 'This is a computer-generated payslip and does not require a signature.',
  },
  si: {
    title: 'වැටුප් පත්‍රිකාව',
    employee: 'සේවකයා',
    designation: 'තනතුර',
    department: 'අංශය',
    employmentType: 'සේවා වර්ගය',
    payslipNo: 'පත්‍රිකා අංකය',
    workingDays: 'ගෙවූ දින',
    noPay: 'වැටුප් රහිත දින',
    bank: 'බැංකුව',
    earnings: 'ඉපැයීම්',
    deductions: 'අඩු කිරීම්',
    totalEarnings: 'මුළු ඉපැයීම්',
    totalDeductions: 'මුළු අඩු කිරීම්',
    netPay: 'ශුද්ධ වැටුප',
    employerContributions: 'සේවා යෝජක දායකත්වය (ඔබගේ වැටුපෙන් අඩු නොකෙරේ)',
    footer: 'මෙය පරිගණකයෙන් සකස් කළ වැටුප් පත්‍රිකාවකි; අත්සනක් අවශ්‍ය නොවේ.',
  },
  ta: {
    title: 'சம்பளச் சீட்டு',
    employee: 'ஊழியர்',
    designation: 'பதவி',
    department: 'பிரிவு',
    employmentType: 'பணி வகை',
    payslipNo: 'சீட்டு எண்',
    workingDays: 'சம்பளம் வழங்கிய நாட்கள்',
    noPay: 'சம்பளமற்ற நாட்கள்',
    bank: 'வங்கி',
    earnings: 'வருமானங்கள்',
    deductions: 'கழிவுகள்',
    totalEarnings: 'மொத்த வருமானம்',
    totalDeductions: 'மொத்த கழிவுகள்',
    netPay: 'நிகர சம்பளம்',
    employerContributions: 'முதலாளி பங்களிப்புகள் (உங்கள் சம்பளத்திலிருந்து கழிக்கப்படுவதில்லை)',
    footer: 'இது கணினியால் உருவாக்கப்பட்ட சம்பளச் சீட்டு; கையொப்பம் தேவையில்லை.',
  },
};
