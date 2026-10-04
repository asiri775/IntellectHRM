import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { get, patch, post, put, qs, type Page, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Badge, Button, Checkbox, Empty, ErrorNote, Field, Input, Modal, Pagination, Panel, Select, Spinner } from '@/components/ui';

export function UsersSettings() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<R | null>(null);
  const q = useQuery({ queryKey: ['users', search, page], queryFn: () => get<Page<R>>(`/users${qs({ search, page, pageSize: 25 })}`), placeholderData: keepPreviousData });
  return (
    <Panel
      title="Users"
      padded={false}
      actions={
        <div className="flex gap-2">
          <Input placeholder="Search" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="!w-48 !py-1" aria-label="Search users" />
          {can('USER_MANAGE') && (
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing({})}>
              Add user
            </Button>
          )}
        </div>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <>
          <table className="table-base">
            <thead>
              <tr>
                <th>User</th>
                <th>Roles</th>
                <th>Employee</th>
                <th>Last sign-in</th>
                <th>Status</th>
                {can('USER_MANAGE') && <th />}
              </tr>
            </thead>
            <tbody>
              {q.data?.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-xs text-ink-500">{u.email}</div>
                  </td>
                  <td className="space-x-1">
                    {u.roles.map((r: R) => (
                      <Badge key={r.role.id} tone="blue">
                        {r.role.name}
                      </Badge>
                    ))}
                  </td>
                  <td>{u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : '—'}</td>
                  <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</td>
                  <td>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}</td>
                  {can('USER_MANAGE') && (
                    <td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {q.data && <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} />}
        </>
      )}
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function UserModal({ user, onClose }: { user: R; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<R[]>('/roles') });
  const isNew = !user.id;
  const [f, setF] = useState({
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    password: '',
    roleIds: (user.roles ?? []).map((r: R) => r.role.id) as string[],
    isActive: user.isActive ?? true,
    preferredLanguage: user.preferredLanguage ?? 'en',
  });
  const m = useMutation({
    mutationFn: () =>
      isNew
        ? post('/users', { email: f.email, displayName: f.displayName, password: f.password, roleIds: f.roleIds, preferredLanguage: f.preferredLanguage })
        : patch(`/users/${user.id}`, { displayName: f.displayName, roleIds: f.roleIds, isActive: f.isActive, preferredLanguage: f.preferredLanguage, ...(f.password ? { resetPassword: f.password } : {}) }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['users'] }), onClose()),
  });
  const toggle = (id: string) => setF({ ...f, roleIds: f.roleIds.includes(id) ? f.roleIds.filter((x) => x !== id) : [...f.roleIds, id] });
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Add user' : `Edit ${user.displayName}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save user
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-500">To give an employee access, it is usually easier to tick "Create an account" when adding the employee.</p>
      <Field label="Email">
        <Input type="email" value={f.email} disabled={!isNew} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label="Name">
        <Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
      </Field>
      <Field label={isNew ? 'Temporary password' : 'Reset password (optional)'} hint="At least 10 characters with a letter and a number. The user must change it at next sign-in.">
        <Input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="off" />
      </Field>
      <Field label="Language">
        <Select value={f.preferredLanguage} onChange={(e) => setF({ ...f, preferredLanguage: e.target.value })} options={[{ value: 'en', label: 'English' }, { value: 'si', label: 'සිංහල' }, { value: 'ta', label: 'தமிழ்' }]} />
      </Field>
      <Field label="Roles">
        <div className="grid gap-2 pt-1 sm:grid-cols-2">
          {(roles.data ?? [])
            .filter((r) => r.code !== 'SUPER_ADMIN' || me?.roles.includes('SUPER_ADMIN'))
            .map((r) => (
              <Checkbox key={r.id} label={r.name} checked={f.roleIds.includes(r.id)} onChange={() => toggle(r.id)} />
            ))}
        </div>
      </Field>
      {!isNew && <Checkbox label="Account active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />}
      <ErrorNote error={m.error} />
    </Modal>
  );
}

const SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY', 'ALL'];

export function RolesSettings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<R[]>('/roles') });
  const catalogue = useQuery({ queryKey: ['permissions'], queryFn: () => get<R[]>('/permissions') });
  const [roleId, setRoleId] = useState<string>('');
  const [grants, setGrants] = useState<Record<string, string>>({});
  const [newRole, setNewRole] = useState<{ code: string; name: string } | null>(null);
  const role = roles.data?.find((r) => r.id === roleId) ?? roles.data?.[0];
  useEffect(() => {
    if (role) setGrants(Object.fromEntries(role.permissions.map((p: R) => [p.permission.code, p.scope])));
  }, [role]);
  const byModule = useMemo(() => {
    const m = new Map<string, R[]>();
    for (const p of catalogue.data ?? []) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [catalogue.data]);
  const save = useMutation({
    mutationFn: () => put(`/roles/${role!.id}/permissions`, { permissions: Object.entries(grants).map(([code, scope]) => ({ code, scope })) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
  const create = useMutation({ mutationFn: () => post<R>('/roles', newRole), onSuccess: (r) => (qc.invalidateQueries({ queryKey: ['roles'] }), setRoleId(r.id), setNewRole(null)) });
  if (roles.isLoading || catalogue.isLoading) return <Spinner />;
  const locked = role?.code === 'SUPER_ADMIN' || !can('ROLE_MANAGE');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Role">
          <Select value={role?.id ?? ''} onChange={(e) => setRoleId(e.target.value)} options={(roles.data ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r._count.users} users)` }))} />
        </Field>
        <div className="flex-1" />
        {can('ROLE_MANAGE') && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNewRole({ code: '', name: '' })}>
            New role
          </Button>
        )}
        {!locked && (
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save permissions
          </Button>
        )}
      </div>
      {role && <p className="text-sm text-ink-500">{role.description ?? ''} Scope decides whose records the permission covers: own, team (direct reports and team), department, or the whole company.</p>}
      {role?.code === 'SUPER_ADMIN' && <p className="text-sm text-saffron">The super admin role always has every permission.</p>}
      <ErrorNote error={save.error} />
      {byModule.map(([module, perms]) => (
        <Panel key={module} title={module.charAt(0) + module.slice(1).toLowerCase()} padded={false}>
          <table className="table-base">
            <tbody>
              {perms.map((p) => (
                <tr key={p.code}>
                  <td className="w-10">
                    <input
                      type="checkbox"
                      aria-label={p.description}
                      disabled={locked}
                      checked={p.code in grants}
                      onChange={(e) => {
                        const next = { ...grants };
                        if (e.target.checked) next[p.code] = 'COMPANY';
                        else delete next[p.code];
                        setGrants(next);
                      }}
                    />
                  </td>
                  <td>
                    <div>{p.description}</div>
                    <div className="font-mono text-xs text-ink-300">{p.code}</div>
                  </td>
                  <td className="w-40">
                    {p.code in grants && (
                      <Select aria-label="Scope" disabled={locked} value={grants[p.code]} onChange={(e) => setGrants({ ...grants, [p.code]: e.target.value })} options={SCOPES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} className="!py-1" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
      {newRole && (
        <Modal
          open
          onClose={() => setNewRole(null)}
          title="New role"
          footer={
            <>
              <Button onClick={() => setNewRole(null)}>Cancel</Button>
              <Button variant="primary" loading={create.isPending} disabled={!newRole.code || !newRole.name} onClick={() => create.mutate()}>
                Create role
              </Button>
            </>
          }
        >
          <Field label="Name">
            <Input value={newRole.name} onChange={(e) => setNewRole({ name: e.target.value, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') })} />
          </Field>
          <Field label="Code">
            <Input value={newRole.code} onChange={(e) => setNewRole({ ...newRole, code: e.target.value.toUpperCase() })} className="font-mono" />
          </Field>
          <ErrorNote error={create.error} />
        </Modal>
      )}
      {!roles.data?.length && <Empty title="No roles." />}
    </div>
  );
}
