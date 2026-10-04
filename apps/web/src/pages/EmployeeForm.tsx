import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { get, patch, post, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase } from '@/lib/format';
import { Button, Checkbox, ErrorNote, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { EMPLOYMENT_TYPES } from './Employees';

const nic = /^([0-9]{9}[VvXx]|[0-9]{12})$/;
const opt = z.string().optional().transform((v) => (v === '' ? undefined : v));

const schema = z
  .object({
    firstName: z.string().min(1, 'Required'),
    lastName: z.string().min(1, 'Required'),
    nameWithInitials: opt,
    preferredName: opt,
    email: z.string().email('Enter a valid email'),
    phone: opt,
    dateOfBirth: opt,
    gender: opt,
    address: opt,
    joiningDate: z.string().min(1, 'Required'),
    employmentType: z.string(),
    contractStartDate: opt,
    contractEndDate: opt,
    departmentId: opt,
    teamId: opt,
    designationId: opt,
    managerId: opt,
    locationId: opt,
    workScheduleId: opt,
    preferredLanguage: z.enum(['en', 'si', 'ta']),
    nic: opt.refine((v) => !v || nic.test(v), 'NIC must be 9 digits + V/X, or 12 digits'),
    passportNumber: opt,
    epfNumber: opt,
    tin: opt,
    bankName: opt,
    bankBranch: opt,
    bankAccountNumber: opt,
    createAccount: z.boolean().optional(),
    password: opt,
    roleCodes: z.array(z.string()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.employmentType === 'CONTRACT' && (!v.contractStartDate || !v.contractEndDate)) ctx.addIssue({ code: 'custom', path: ['contractEndDate'], message: 'Contract employees need start and end dates' });
    if (v.createAccount && (!v.password || v.password.length < 10)) ctx.addIssue({ code: 'custom', path: ['password'], message: 'At least 10 characters with a letter and a number' });
  });
type Form = z.infer<typeof schema>;

export default function EmployeeFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const lookups = useQuery({ queryKey: ['org', 'lookups'], queryFn: () => get('/org/lookups') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<R[]>('/roles'), enabled: can('USER_MANAGE', 'ROLE_VIEW') });
  const existing = useQuery({ queryKey: ['employee', id], queryFn: () => get(`/employees/${id}`), enabled: editing });
  const { register, handleSubmit, watch, reset, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { employmentType: 'PERMANENT', preferredLanguage: 'en', createAccount: true, roleCodes: ['EMPLOYEE'] },
  });
  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    reset({
      ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ?? undefined])),
      dateOfBirth: e.dateOfBirth?.slice(0, 10),
      joiningDate: e.joiningDate?.slice(0, 10),
      nic: e.sensitiveVisible ? e.nic ?? undefined : undefined,
      tin: e.sensitiveVisible ? e.tin ?? undefined : undefined,
      passportNumber: e.sensitiveVisible ? e.passportNumber ?? undefined : undefined,
      bankAccountNumber: e.sensitiveVisible ? e.bankAccountNumber ?? undefined : undefined,
      createAccount: false,
    } as Form);
  }, [existing.data, reset]);

  const save = useMutation({
    mutationFn: async (f: Form) => {
      const body: R = { ...f };
      delete body.createAccount;
      delete body.password;
      delete body.roleCodes;
      for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
      if (editing) {
        delete body.contractStartDate;
        delete body.contractEndDate;
        if (!existing.data?.sensitiveVisible) ['nic', 'tin', 'passportNumber', 'bankAccountNumber'].forEach((k) => delete body[k]);
        return patch(`/employees/${id}`, body);
      }
      if (f.createAccount) body.createUser = { password: f.password, roleCodes: f.roleCodes?.length ? f.roleCodes : ['EMPLOYEE'], sendWelcomeEmail: true };
      return post('/employees', body);
    },
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee', e.id] });
      nav(`/employees/${e.id}`);
    },
  });

  if (editing && existing.isLoading) return <Spinner />;
  const L = lookups.data ?? {};
  const dept = watch('departmentId');
  const type = watch('employmentType');
  const createAccount = watch('createAccount');
  const err = (k: keyof Form) => formState.errors[k]?.message as string | undefined;
  const sensitiveAllowed = can('EMPLOYEE_SENSITIVE_VIEW');

  return (
    <form onSubmit={handleSubmit((f) => save.mutate(f))} className="space-y-6">
      <PageHeader
        title={editing ? `Edit ${existing.data?.firstName ?? ''} ${existing.data?.lastName ?? ''}` : 'Add employee'}
        actions={
          <>
            <Button type="button" onClick={() => nav(-1)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {editing ? 'Save changes' : 'Create employee'}
            </Button>
          </>
        }
      />
      <ErrorNote error={save.error} />

      <Panel title="Personal details">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First name" error={err('firstName')}>
            <Input {...register('firstName')} />
          </Field>
          <Field label="Last name" error={err('lastName')}>
            <Input {...register('lastName')} />
          </Field>
          <Field label="Name with initials" hint="As on the NIC, e.g. K. A. Silva">
            <Input {...register('nameWithInitials')} />
          </Field>
          <Field label="Preferred name">
            <Input {...register('preferredName')} />
          </Field>
          <Field label="Work email" error={err('email')}>
            <Input type="email" {...register('email')} />
          </Field>
          <Field label="Mobile">
            <Input {...register('phone')} placeholder="07X XXX XXXX" />
          </Field>
          <Field label="Date of birth">
            <Input type="date" {...register('dateOfBirth')} />
          </Field>
          <Field label="Gender">
            <Select {...register('gender')} placeholder="—" options={['Female', 'Male', 'Other'].map((g) => ({ value: g, label: g }))} />
          </Field>
          <Field label="Preferred language" hint="Used for emails and payslips">
            <Select {...register('preferredLanguage')} options={[{ value: 'en', label: 'English' }, { value: 'si', label: 'සිංහල' }, { value: 'ta', label: 'தமிழ்' }]} />
          </Field>
          <Field label="Address" className="sm:col-span-2 lg:col-span-3">
            <Input {...register('address')} />
          </Field>
        </div>
      </Panel>

      <Panel title="Employment">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Joining date" error={err('joiningDate')}>
            <Input type="date" {...register('joiningDate')} />
          </Field>
          <Field label="Employment type">
            <Select {...register('employmentType')} options={EMPLOYMENT_TYPES.map((x) => ({ value: x, label: titleCase(x) }))} />
          </Field>
          {!editing && (type === 'CONTRACT' || type === 'PROBATION') && (
            <>
              <Field label="Contract start">
                <Input type="date" {...register('contractStartDate')} />
              </Field>
              <Field label="Contract end" error={err('contractEndDate')}>
                <Input type="date" {...register('contractEndDate')} />
              </Field>
            </>
          )}
          <Field label="Department">
            <Select {...register('departmentId')} placeholder="—" options={(L.departments ?? []).map((d: R) => ({ value: d.id, label: d.name }))} />
          </Field>
          <Field label="Team">
            <Select {...register('teamId')} placeholder="—" options={(L.teams ?? []).filter((t: R) => !dept || t.departmentId === dept).map((t: R) => ({ value: t.id, label: t.name }))} />
          </Field>
          <Field label="Designation">
            <Select {...register('designationId')} placeholder="—" options={(L.designations ?? []).map((d: R) => ({ value: d.id, label: d.name }))} />
          </Field>
          <Field label="Manager">
            <Select {...register('managerId')} placeholder="—" options={(L.managers ?? []).filter((m: R) => m.id !== id).map((m: R) => ({ value: m.id, label: `${m.firstName} ${m.lastName} (${m.employeeNo})` }))} />
          </Field>
          <Field label="Location">
            <Select {...register('locationId')} placeholder="—" options={(L.locations ?? []).map((d: R) => ({ value: d.id, label: d.name }))} />
          </Field>
          <Field label="Work schedule">
            <Select {...register('workScheduleId')} placeholder="Company default" options={(L.schedules ?? []).map((d: R) => ({ value: d.id, label: d.name }))} />
          </Field>
          {type === 'CONTRACT' && <p className="self-end text-xs text-ink-500 sm:col-span-2 lg:col-span-3">Contract employees earning above LKR 150,000 a month have 5% contract employee tax deducted in payroll.</p>}
        </div>
      </Panel>

      {sensitiveAllowed && (
        <Panel title="Identity, tax and bank" actions={<span className="text-xs text-ink-500">Encrypted at rest. Views are audited.</span>}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="NIC" error={err('nic')}>
              <Input {...register('nic')} placeholder="199012345678 or 901234567V" />
            </Field>
            <Field label="Passport">
              <Input {...register('passportNumber')} />
            </Field>
            <Field label="EPF number">
              <Input {...register('epfNumber')} />
            </Field>
            <Field label="TIN">
              <Input {...register('tin')} />
            </Field>
            <Field label="Bank">
              <Input {...register('bankName')} />
            </Field>
            <Field label="Branch">
              <Input {...register('bankBranch')} />
            </Field>
            <Field label="Account number">
              <Input {...register('bankAccountNumber')} inputMode="numeric" />
            </Field>
          </div>
        </Panel>
      )}

      {!editing && (
        <Panel title="Sign-in account">
          <div className="space-y-4">
            <Checkbox label="Create an account so this employee can sign in, record attendance and apply for leave" {...register('createAccount')} />
            {createAccount && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Temporary password" hint="They will be asked to change it on first sign-in." error={err('password')}>
                  <Input type="text" autoComplete="off" {...register('password')} />
                </Field>
                {roles.data && (
                  <Field label="Roles">
                    <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                      {roles.data
                        .filter((r) => r.code !== 'SUPER_ADMIN')
                        .map((r) => (
                          <Checkbox key={r.code} label={r.name} value={r.code} {...register('roleCodes')} />
                        ))}
                    </div>
                  </Field>
                )}
              </div>
            )}
          </div>
        </Panel>
      )}
    </form>
  );
}
