import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Plus, Search } from 'lucide-react';
import { download, get, qs, type Page, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, fullName, titleCase } from '@/lib/format';
import { Badge, Button, Empty, Input, PageHeader, Pagination, Panel, Select, Spinner, StatusBadge } from '@/components/ui';

export const EMPLOYMENT_TYPES = ['PERMANENT', 'PROBATION', 'CONTRACT', 'INTERN', 'CONSULTANT'];

export default function EmployeesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [departmentId, setDept] = useState('');
  const [employmentType, setType] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const lookups = useQuery({ queryKey: ['org', 'lookups'], queryFn: () => get('/org/lookups') });
  const q = useQuery({
    queryKey: ['employees', search, departmentId, employmentType, status, page],
    queryFn: () => get<Page<R>>(`/employees${qs({ search, departmentId, employmentType, status, page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title={t('nav.employees')}
        subtitle={q.data ? `${q.data.total} ${status ? titleCase(status).toLowerCase() : ''} employees` : undefined}
        actions={
          <>
            {can('EMPLOYEE_EXPORT') && (
              <Button icon={<Download className="h-4 w-4" />} onClick={() => download('/employees/export.csv', 'employees.csv')}>
                Export
              </Button>
            )}
            {can('EMPLOYEE_CREATE') && (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => nav('/employees/new')}>
                Add employee
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_10rem_10rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-300" />
          <Input placeholder="Search name, email or employee no" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="pl-9" aria-label={t('common.search')} />
        </div>
        <Select aria-label="Department" value={departmentId} onChange={(e) => (setDept(e.target.value), setPage(1))} placeholder="All departments" options={(lookups.data?.departments ?? []).map((d: R) => ({ value: d.id, label: d.name }))} />
        <Select aria-label="Employment type" value={employmentType} onChange={(e) => (setType(e.target.value), setPage(1))} placeholder="All types" options={EMPLOYMENT_TYPES.map((x) => ({ value: x, label: titleCase(x) }))} />
        <Select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} placeholder="Any status" options={['ACTIVE', 'ON_NOTICE', 'RESIGNED', 'TERMINATED', 'CONTRACT_ENDED'].map((x) => ({ value: x, label: titleCase(x) }))} />
      </div>
      <Panel padded={false}>
        {q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <Empty title="No employees match these filters." action={can('EMPLOYEE_CREATE') ? <Button onClick={() => nav('/employees/new')}>Add employee</Button> : undefined} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Type</th>
                    <th>Manager</th>
                    <th>Joined</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((e) => {
                    const end = e.contracts?.[0]?.endDate;
                    const soon = end && new Date(end).getTime() - Date.now() < 30 * 86400000;
                    return (
                      <tr key={e.id} className="cursor-pointer" onClick={() => nav(`/employees/${e.id}`)}>
                        <td>
                          <Link to={`/employees/${e.id}`} className="font-medium hover:text-brand" onClick={(ev) => ev.stopPropagation()}>
                            {fullName(e)}
                          </Link>
                          <div className="text-xs text-ink-500">
                            {e.employeeNo} · {e.email}
                          </div>
                        </td>
                        <td>{e.department?.name ?? '—'}</td>
                        <td>{e.designation?.name ?? '—'}</td>
                        <td>
                          {titleCase(e.employmentType)}
                          {end && <div className={soon ? 'text-xs text-saffron' : 'text-xs text-ink-500'}>until {date(end)}</div>}
                        </td>
                        <td>{e.manager ? fullName(e.manager) : '—'}</td>
                        <td>{date(e.joiningDate)}</td>
                        <td>
                          <StatusBadge status={e.employmentStatus} />
                          {e.employmentType === 'CONTRACT' && <Badge tone="teal">contract</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
