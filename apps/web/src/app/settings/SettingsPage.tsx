import { useState } from 'react';
import {
  useMarketSegments,
  useCreateMarketSegment,
  useUpdateMarketSegment,
  useUsers,
  useCreateUser,
  useUpdateUser,
} from '../../hooks/useSettings';
import { useAuth } from '../../hooks/useAuth';
import type { PublicUser, Role } from '@tracker/shared';
import { ROLES } from '@tracker/shared';

const btn =
  'rounded border px-2 py-1 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-40';
const btnPrimary = `${btn} bg-blue-600 text-white`;
const btnDanger = `${btn} bg-red-600 text-white`;
const btnGhost = `${btn} border-gray-300 text-gray-700 hover:bg-gray-100`;
const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';

export function SettingsPage() {
  const { user: me } = useAuth();

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold">Settings</h1>

      <UsersPanel me={me} />
      <MarketSegmentsPanel />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

function UsersPanel({ me }: { me: PublicUser | null }) {
  const { data: users, isLoading, isError, error } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('STAFF');
  const [addNotice, setAddNotice] = useState<string | null>(null);

  const resetAdd = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('STAFF');
    setAddNotice(null);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddNotice(null);
    try {
      await createUser.mutateAsync({ name: name.trim(), email: email.trim(), password, role });
      resetAdd();
    } catch (err) {
      setAddNotice(err instanceof Error ? err.message : 'Could not create user.');
    }
  };

  const toggleActive = async (u: PublicUser) => {
    if (u.id === me?.id) return;
    try {
      await updateUser.mutateAsync({ id: u.id, is_active: !u.is_active });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  const changeRole = async (u: PublicUser, newRole: Role) => {
    if (u.id === me?.id) return;
    try {
      await updateUser.mutateAsync({ id: u.id, role: newRole });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  return (
    <section className="rounded border border-gray-200 p-4">
      <h2 className="mb-3 text-sm font-semibold">Users</h2>

      {isLoading && <p className="text-xs text-gray-500">Loading users…</p>}
      {isError && <p className="text-xs text-red-600">{error instanceof Error ? error.message : 'Failed to load users.'}</p>}

      {users && (
        <table className="mb-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="pb-1 pr-3">Name</th>
              <th className="pb-1 pr-3">Email</th>
              <th className="pb-1 pr-3">Role</th>
              <th className="pb-1 pr-3">Active</th>
              <th className="pb-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id} className="border-b border-gray-100 align-middle">
                  <td className="py-1.5 pr-3">
                    {u.name}
                    {isSelf && <span className="ml-1 text-xs text-gray-400">(you)</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-gray-600">{u.email}</td>
                  <td className="py-1.5 pr-3">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value as Role)}
                      disabled={isSelf || updateUser.isPending}
                      className="rounded border px-1.5 py-0.5 text-xs"
                      aria-label={`Role for ${u.name}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className={u.is_active ? 'text-green-700' : 'text-gray-400'}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleActive(u)}
                      disabled={isSelf || updateUser.isPending}
                      className={u.is_active ? btnDanger : btnGhost}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 className="mb-2 text-xs font-semibold text-gray-500">Add user</h3>
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Name</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="Jane Doe"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            placeholder="jane@example.com"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
            placeholder="min 8 characters"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-36 rounded border px-2 py-1.5 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={createUser.isPending} className={btnPrimary}>
          {createUser.isPending ? 'Creating…' : 'Add user'}
        </button>
        {addNotice && <span className="text-xs text-red-600">{addNotice}</span>}
      </form>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Market Segments                                                            */
/* -------------------------------------------------------------------------- */

function MarketSegmentsPanel() {
  const { data: segments, isLoading, isError, error } = useMarketSegments();
  const createSegment = useCreateMarketSegment();
  const updateSegment = useUpdateMarketSegment();

  const [label, setLabel] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [addNotice, setAddNotice] = useState<string | null>(null);

  const resetAdd = () => {
    setLabel('');
    setSortOrder('0');
    setAddNotice(null);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddNotice(null);
    try {
      await createSegment.mutateAsync({ label: label.trim(), sort_order: Number(sortOrder) || 0 });
      resetAdd();
    } catch (err) {
      setAddNotice(err instanceof Error ? err.message : 'Could not create segment.');
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await updateSegment.mutateAsync({ id, is_active: !isActive });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  return (
    <section className="rounded border border-gray-200 p-4">
      <h2 className="mb-3 text-sm font-semibold">Market Segments</h2>

      {isLoading && <p className="text-xs text-gray-500">Loading segments…</p>}
      {isError && (
        <p className="text-xs text-red-600">{error instanceof Error ? error.message : 'Failed to load segments.'}</p>
      )}

      {segments && (
        <table className="mb-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="pb-1 pr-3">Label</th>
              <th className="pb-1 pr-3 w-24">Sort order</th>
              <th className="pb-1 pr-3">Status</th>
              <th className="pb-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 align-middle">
                <td className="py-1.5 pr-3">{s.label}</td>
                <td className="py-1.5 pr-3 text-gray-500">{s.sort_order}</td>
                <td className="py-1.5 pr-3">
                  <span className={s.is_active ? 'text-green-700' : 'text-gray-400'}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="py-1.5">
                  <button
                    type="button"
                    onClick={() => toggleActive(s.id, s.is_active)}
                    disabled={updateSegment.isPending}
                    className={s.is_active ? btnDanger : btnGhost}
                  >
                    {s.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="mb-2 text-xs font-semibold text-gray-500">Add segment</h3>
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Label</span>
          <input
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={inputCls}
            placeholder="e.g. Government"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Sort order</span>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button type="submit" disabled={createSegment.isPending} className={btnPrimary}>
          {createSegment.isPending ? 'Adding…' : 'Add segment'}
        </button>
        {addNotice && <span className="text-xs text-red-600">{addNotice}</span>}
      </form>
    </section>
  );
}