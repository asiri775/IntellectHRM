import { Fragment, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Download, FileText, Mail, RotateCcw, Send, Calculator } from 'lucide-react';
import { download, get, openDocument, post, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, fullName, money, monthName, titleCase } from '@/lib/format';
import { Button, Empty, ErrorNote, Field, Modal, PageHeader, Panel, Spinner, Stat, StatStrip, StatusBadge, Textarea } from '@/components/ui';

const STEPS = ['DRAFT', 'CALCULATED', 'APPROVED', 'POSTED'];

export default function PayrollRunPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<'return' | 'reverse' | null>(null);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['payroll', 'run', id], queryFn: () => get(`/payroll/runs/${id}`) });
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: R }) => post(`/payroll/runs/${id}/${action}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll'] });
      setReasonFor(null);
      setReason('');
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const run = q.data!;
  const lines: R[] = run.lines ?? [];
  const busy = (a: string) => act.isPending && act.variables?.action === a;
  const stepIndex = STEPS.indexOf(run.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Payroll — ${monthName(run.month)} ${run.year}`}
        subtitle={
          <span className="flex items-center gap-2">
            {run.number} <StatusBadge status={run.status} />
          </span>
        }
        actions={
          <>
            {['DRAFT', 'CALCULATED'].includes(run.status) && can('PAYROLL_RUN') && (
              <Button variant={run.status === 'DRAFT' ? 'primary' : 'secondary'} icon={<Calculator className="h-4 w-4" />} loading={busy('calculate')} onClick={() => act.mutate({ action: 'calculate' })}>
                {run.status === 'DRAFT' ? 'Calculate' : 'Recalculate'}
              </Button>
            )}
            {run.status === 'CALCULATED' && can('PAYROLL_APPROVE') && (
              <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={busy('approve')} onClick={() => act.mutate({ action: 'approve' })}>
                Approve
              </Button>
            )}
            {run.status === 'APPROVED' && can('PAYROLL_APPROVE') && (
              <>
                <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setReasonFor('return')}>
                  Send back
                </Button>
                <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={busy('post')} onClick={() => confirm('Post this payroll? Payslips become visible to employees and the run can no longer be edited.') && act.mutate({ action: 'post' })}>
                  Post and publish payslips
                </Button>
              </>
            )}
            {run.status === 'POSTED' && can('PAYROLL_APPROVE') && (
              <>
                <Button icon={<Mail className="h-4 w-4" />} loading={busy('email-payslips')} onClick={() => act.mutate({ action: 'email-payslips' })}>
                  Email payslips
                </Button>
                <Button variant="ghost" onClick={() => setReasonFor('reverse')}>
                  Reverse
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Lifecycle — a real sequence, so it is shown as steps. */}
      <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Payroll status">
        {STEPS.map((s, i) => (
          <li key={s} className={i <= stepIndex ? 'font-medium text-ink dark:text-white' : 'text-ink-300'}>
            <span className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${i <= stepIndex ? 'bg-brand text-white' : 'border border-ink-100'}`}>{i + 1}</span>
            {titleCase(s)}
          </li>
        ))}
        {run.status === 'REVERSED' && <li className="font-medium text-rose">Reversed {dateTime(run.reversedAt)}</li>}
      </ol>
      {act.data?.queued !== undefined && <p className="text-sm text-leaf">{act.data.queued} payslip email(s) queued.</p>}
      <ErrorNote error={act.error} />

      {run.status !== 'DRAFT' && (
        <StatStrip>
          <Stat label="Gross pay" value={money(run.totalGross)} />
          <Stat label="Net pay" value={money(run.totalNet)} />
          <Stat label="EPF (8% + 12%) / ETF (3%)" value={`${money(Number(run.totalEpfEmployee) + Number(run.totalEpfEmployer))} / ${money(run.totalEtf)}`} />
          <Stat label="APIT / contract tax" value={`${money(run.totalApit)} / ${money(run.totalContractTax)}`} />
        </StatStrip>
      )}

      {['APPROVED', 'POSTED'].includes(run.status) && can('PAYROLL_EXPORT') && (
        <Panel title="Statutory and bank files">
          <div className="flex flex-wrap gap-2">
            {[
              ['epf', 'EPF return'],
              ['etf', 'ETF return'],
              ['apit', 'APIT schedule'],
              ['contract-tax', 'Contract employee tax'],
              ['bank', 'Bank transfer'],
            ].map(([k, label]) => (
              <Button key={k} size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => download(`/payroll/runs/${id}/reports/${k}`, `${k}-${run.year}-${run.month}.csv`)}>
                {label}
              </Button>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Employees" padded={false}>
        {!lines.length ? (
          <Empty title={run.status === 'DRAFT' ? 'Calculate the run to see each employee’s pay.' : 'No employees in this run.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th />
                  <th>Employee</th>
                  <th>Type</th>
                  <th className="num">Days</th>
                  <th className="num">Gross</th>
                  <th className="num">EPF 8%</th>
                  <th className="num">APIT</th>
                  <th className="num">Contract tax</th>
                  <th className="num">Other</th>
                  <th className="num">Net</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <Fragment key={l.id}>
                    <tr className="cursor-pointer" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                      <td className="w-6">{expanded === l.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td>
                        <div className="font-medium">{fullName(l.employee)}</div>
                        <div className="text-xs text-ink-500">
                          {l.employee.employeeNo} · {l.employee.department?.name ?? '—'}
                        </div>
                      </td>
                      <td>{titleCase(l.employmentType)}</td>
                      <td className="num">
                        {l.employedDays}/{l.workingDays}
                        {Number(l.noPayDays) > 0 && <div className="text-xs text-rose">{Number(l.noPayDays)} no-pay</div>}
                      </td>
                      <td className="num">{money(l.grossEarnings, l.currency !== 'LKR' ? l.currency : undefined)}</td>
                      <td className="num">{money(l.epfEmployee)}</td>
                      <td className="num">{money(l.apit)}</td>
                      <td className={`num ${Number(l.contractTax) > 0 ? 'font-medium text-saffron' : ''}`}>{money(l.contractTax)}</td>
                      <td className="num">{money(l.otherDeductions)}</td>
                      <td className="num font-semibold">{money(l.netPay)}</td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<FileText className="h-3.5 w-3.5" />}
                          aria-label="Payslip"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDocument(`/payroll/payslips/${l.id}/document`);
                          }}
                        />
                      </td>
                    </tr>
                    {expanded === l.id && (
                      <tr>
                        <td />
                        <td colSpan={10} className="bg-ink-50/50 dark:bg-ink-700/20">
                          <div className="grid gap-4 py-2 md:grid-cols-3">
                            <LineList title="Earnings" items={l.detail.earnings} />
                            <LineList title="Deductions" items={l.detail.deductions} />
                            <LineList title="Employer contributions" items={l.detail.employerContributions} />
                          </div>
                          <details className="text-xs text-ink-500">
                            <summary className="cursor-pointer">How this was calculated</summary>
                            <ol className="mt-1 list-decimal pl-5">
                              {l.detail.trace.map((t: string, i: number) => (
                                <li key={i}>{t}</li>
                              ))}
                            </ol>
                          </details>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {run.journal && (
        <Panel title="Payroll journal (posts to accounting in Phase 7)" padded={false}>
          <table className="table-base">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Debit (LKR)</th>
                <th className="num">Credit (LKR)</th>
              </tr>
            </thead>
            <tbody>
              {run.journal.lines.map((j: R) => (
                <tr key={j.account}>
                  <td>
                    {j.account} {j.name}
                  </td>
                  <td className="num">{j.debit ? money(j.debit) : ''}</td>
                  <td className="num">{j.credit ? money(j.credit) : ''}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>Total</td>
                <td className="num">{money(run.journal.totalDebit)}</td>
                <td className="num">{money(run.journal.totalCredit)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      )}

      {reasonFor && (
        <Modal
          open
          onClose={() => setReasonFor(null)}
          title={reasonFor === 'return' ? 'Send back for changes' : 'Reverse posted payroll'}
          footer={
            <>
              <Button onClick={() => setReasonFor(null)}>Cancel</Button>
              <Button variant={reasonFor === 'reverse' ? 'danger' : 'primary'} disabled={reason.length < 3} loading={act.isPending} onClick={() => act.mutate({ action: reasonFor, body: { reason } })}>
                {reasonFor === 'return' ? 'Send back' : 'Reverse payroll'}
              </Button>
            </>
          }
        >
          {reasonFor === 'reverse' && <p className="text-sm">Posted payroll is never edited. Reversing it lets you create a corrected run for the same month. The original stays in the history.</p>}
          <Field label="Reason">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function LineList({ title, items }: { title: string; items: R[] }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-ink-500">{title}</div>
      {!items.length ? (
        <p className="text-sm text-ink-300">None</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {items.map((i) => (
            <li key={i.code} className="flex justify-between gap-3" title={i.note}>
              <span>{i.name}</span>
              <span className="tabular-nums">{money(i.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
