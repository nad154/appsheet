import { useEffect, useState } from 'react';
import {
  useMarketSegments,
  useCreateMarketSegment,
  useUpdateMarketSegment,
  useUsers,
  useCreateUser,
  useUpdateUser,
  useAgingThresholds,
  useUpdateAgingThresholds,
} from '../../hooks/useSettings';
import {
  useCustomers,
  useCreateCustomer,
  useRenameCustomer,
  useDeleteCustomer,
} from '../../hooks/useCustomers';
import {
  useVendors,
  useCreateVendor,
  useRenameVendor,
  useDeleteVendor,
} from '../../hooks/useVendors';
import { useAuth } from '../../hooks/useAuth';
import type { PublicUser, Role } from '@tracker/shared';
import { ROLES } from '@tracker/shared';
// import { useToast } from '../../components/Toast'

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
      <CustomersPanel />
      <VendorsPanel />
      <MarketSegmentsPanel />
      <AgingThresholdsPanel />
    </div>
  );
}

// const { showToast } = useToast();

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
      // showToast(err instanceof Error ? err.message : 'Update failed.', 'error');
    }
  };

  const changeRole = async (u: PublicUser, newRole: Role) => {
    if (u.id === me?.id) return;
    try {
      await updateUser.mutateAsync({ id: u.id, role: newRole });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed.');
      // showToast(err instanceof Error ? err.message : 'Update failed.', 'error');
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
/* Customers / Vendors                                                         */
/* -------------------------------------------------------------------------- */

// Shared admin panel for the customers/vendors lookup tables (plan §3.4).
// POST is open to any role — that happens in the grid comboboxes — while the
// rename/delete here are SUPER_ADMIN-only, enforced server-side. Deleting
// returns usageCount so the UI can report how many projects/vendor lines still
// reference the removed row (they render as "(deleted …)" orphan labels).
interface EntityMutation {
  isPending: boolean;
  // The tanstack mutations carry specific payload types (create {name}, rename
  // {id,name}, delete id) — `any` keeps the shared panel simple and typechecks
  // the individual calls at their call sites with react-query anyway.
  mutateAsync: (input: any) => Promise<unknown>;
}

function EntityAdminPanel({
  title,
  usageNoun,
  list,
  create,
  rename,
  del,
}: {
  title: string;
  usageNoun: string;
  list: { data?: { id: string; name: string }[]; isLoading: boolean; isError: boolean; error?: Error | null };
  create: EntityMutation;
  rename: EntityMutation;
  del: EntityMutation;
}) {
  const [addName, setAddName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      await create.mutateAsync({ name: addName.trim() });
      setAddName('');
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not add.' });
    }
  };

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const commitRename = async (id: string) => {
    setNotice(null);
    try {
      await rename.mutateAsync({ id, name: editingName.trim() });
      setEditingId(null);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not rename.' });
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? Existing references will show as "(deleted)".`)) return;
    setNotice(null);
    try {
      const res = (await del.mutateAsync(id)) as { usageCount?: number };
      const usage = res?.usageCount ?? 0;
      setNotice({
        kind: 'info',
        text:
          usage > 0
            ? `Deleted — still referenced by ${usage} ${usageNoun}.`
            : 'Deleted — nothing was referencing it.',
      });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not delete.' });
    }
  };

  return (
    <section className="rounded border border-gray-200 p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>

      {list.isLoading && <p className="text-xs text-gray-500">Loading…</p>}
      {list.isError && (
        <p className="text-xs text-red-600">
          {list.error instanceof Error ? list.error.message : 'Failed to load.'}
        </p>
      )}

      {list.data && list.data.length > 0 && (
        <table className="mb-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="pb-1 pr-3">Name</th>
              <th className="pb-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 align-middle">
                <td className="py-1.5 pr-3">
                  {editingId === row.id ? (
                    <input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename(row.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="w-64 rounded border border-gray-300 px-2 py-1 text-sm"
                      aria-label={`Rename ${row.name}`}
                    />
                  ) : (
                    row.name
                  )}
                </td>
                <td className="py-1.5">
                  <div className="flex items-center gap-1.5">
                    {editingId === row.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void commitRename(row.id)}
                          disabled={rename.isPending}
                          className={btnPrimary}
                        >
                          Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className={btnGhost}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startRename(row.id, row.name)}
                        disabled={del.isPending}
                        className={btnGhost}
                      >
                        Rename
                      </button>
                    )}
                    <button type="button" onClick={() => void handleDelete(row.id, row.name)} disabled={del.isPending} className={btnDanger}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="mb-2 text-xs font-semibold text-gray-500">Add {title.toLowerCase().replace(/s$/, '')}</h3>
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Name</span>
          <input
            type="text"
            required
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            className={inputCls}
            placeholder="Name"
          />
        </label>
        <button type="submit" disabled={create.isPending} className={btnPrimary}>
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
      {notice && <p className={`mt-2 text-xs ${notice.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>{notice.text}</p>}
    </section>
  );
}

function CustomersPanel() {
  const list = useCustomers();
  return (
    <EntityAdminPanel
      title="Customers"
      usageNoun="project(s)"
      list={list}
      create={useCreateCustomer()}
      rename={useRenameCustomer()}
      del={useDeleteCustomer()}
    />
  );
}

function VendorsPanel() {
  const list = useVendors();
  return (
    <EntityAdminPanel
      title="Vendors"
      usageNoun="vendor line(s)"
      list={list}
      create={useCreateVendor()}
      rename={useRenameVendor()}
      del={useDeleteVendor()}
    />
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
      // showToast(err instanceof Error ? err.message : 'Update failed.', 'error');
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

/* -------------------------------------------------------------------------- */
/* Aging → Priority thresholds                                                */
/* -------------------------------------------------------------------------- */

function AgingThresholdsPanel() {
  const { data, isLoading, isError, error } = useAgingThresholds();
  const updateThresholds = useUpdateAgingThresholds();

  const [low, setLow] = useState('');
  const [medium, setMedium] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setLow(String(data.low_max_days));
      setMedium(String(data.medium_max_days));
    }
  }, [data]);

  const lowNum = Number(low);
  const mediumNum = Number(medium);
  const valid =
    Number.isInteger(lowNum) &&
    lowNum > 0 &&
    Number.isInteger(mediumNum) &&
    mediumNum > 0 &&
    mediumNum > lowNum;

  const handleSave = async () => {
    setNotice(null);
    try {
      await updateThresholds.mutateAsync({ low_max_days: lowNum, medium_max_days: mediumNum });
      setNotice('Thresholds updated.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed.');
      // showToast(err instanceof Error ? err.message : 'Update failed.', 'error');
    }
  };

  return (
    <section className="rounded border border-gray-200 p-4">
      <h2 className="mb-3 text-sm font-semibold">Aging → Priority</h2>
      <p className="mb-3 text-xs text-gray-500">
        Projects are assigned a Priority from their Aging value. High priority is anything above the
        Medium threshold.
      </p>

      {isLoading && <p className="text-xs text-gray-500">Loading thresholds…</p>}
      {isError && (
        <p className="text-xs text-red-600">{error instanceof Error ? error.message : 'Failed to load thresholds.'}</p>
      )}

      {data && (
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-gray-500">Low priority — up to N days</span>
            <input
              type="number"
              min={1}
              value={low}
              onChange={(e) => setLow(e.target.value)}
              className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-gray-500">Medium priority — up to N days</span>
            <input
              type="number"
              min={1}
              value={medium}
              onChange={(e) => setMedium(e.target.value)}
              className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <span className="text-sm text-gray-600">High priority — anything above</span>
          <button type="button" onClick={handleSave} disabled={!valid || updateThresholds.isPending} className={btnPrimary}>
            {updateThresholds.isPending ? 'Saving…' : 'Save'}
          </button>
          {notice && <span className="text-xs text-green-700">{notice}</span>}
          {!valid && (
            <span className="text-xs text-amber-700">Medium must be greater than Low, both must be positive integers.</span>
          )}
        </div>
      )}
    </section>
  );
}