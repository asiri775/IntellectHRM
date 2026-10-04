import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { get, openDocument, type R } from '@/lib/api';
import { money, monthName } from '@/lib/format';
import { Button, Empty, ErrorNote, PageHeader, Panel, Spinner } from '@/components/ui';

export default function MyPayslipsPage() {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({ queryKey: ['payslips', 'me'], queryFn: () => get<R[]>('/payroll/payslips/me') });
  return (
    <div>
      <PageHeader title={t('payslip.title')} />
      <ErrorNote error={error} />
      <Panel padded={false}>
        {q.isLoading ? (
          <Spinner />
        ) : !q.data?.length ? (
          <Empty title={t('payslip.none')} />
        ) : (
          <ul className="divide-y divide-ink-50 dark:divide-ink-700">
            {q.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-medium">
                    {monthName(p.run.month)} {p.run.year}
                  </div>
                  <div className="text-xs text-ink-500">{p.payslipNumber}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-ink-500">{t('payslip.net')}</div>
                  <div className="text-lg font-semibold tabular-nums">{money(p.netPay, p.currency)}</div>
                </div>
                <Button icon={<FileText className="h-4 w-4" />} onClick={() => openDocument(`/payroll/payslips/${p.id}/document?lang=${i18n.language}`).catch(setError)}>
                  {t('payslip.open')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
