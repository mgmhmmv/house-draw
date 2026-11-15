import { useEffect, useState } from 'react';
import { Plus, Search, Users } from 'lucide-react';
import { ApiError } from '../lib/api';
import { islepos, type Connection, type IsleCustomer } from '../lib/islepos';
import { Link } from '../lib/router';
import { ATOLL_NAMES, getAllIslandsByAtoll } from '../lib/maldivesLocations';
import { Avatar, Button, Dialog, Field, Input, Segmented, Spinner, toast } from '../ui';

/** Settings card: paste the merchant's IslePOS key once; it is checked and stored encrypted. */
export function IsleposSettings() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [key, setKey] = useState('');
  const [env, setEnv] = useState<'production' | 'staging'>('production');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    islepos.connection().then(setConn).catch(() => setConn({ connected: false }));
  }, []);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const c = await islepos.connect(key.trim(), env);
      setConn({ ...c, connected: true, key_hint: `…${key.trim().slice(-4)}` });
      setKey('');
      toast('IslePOS connected');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  if (!conn) return <div className="p-5"><Spinner /></div>;

  if (conn.connected)
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="h-2 w-2 rounded-full bg-ok" /> IslePOS connected
          </div>
          <div className="mt-0.5 text-[13px] text-ink-3">
            Key {conn.key_hint} · {conn.env === 'staging' ? 'Staging' : 'Production'}
            {conn.business_id ? ` · business ${conn.business_id.slice(0, 8)}` : ''}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await islepos.disconnect();
            setConn({ connected: false });
            toast('IslePOS disconnected');
          }}
        >
          Disconnect
        </Button>
      </div>
    );

  return (
    <div className="space-y-4 p-5">
      <div>
        <div className="text-sm font-medium">IslePOS</div>
        <p className="mt-0.5 text-[13px] text-ink-3">
          Bill clients for drawings from your IslePOS books. In IslePOS, open Settings → Claude &amp; ChatGPT, create a key with customers, quotations and invoices
          ticked, and paste it here.
        </p>
      </div>
      <Field label="API key" error={error || undefined}>
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="isle_mcp_…" autoComplete="off" spellCheck={false} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={env} onChange={setEnv} options={[{ value: 'production', label: 'Production' }, { value: 'staging', label: 'Staging' }]} />
        <Button variant="primary" loading={busy} disabled={!key.trim()} onClick={connect}>
          Connect
        </Button>
      </div>
    </div>
  );
}

/** Set once any customer from IslePOS carries `street`, i.e. the API takes structured addresses. */
let structuredApi = false;

const SELECT =
  'h-11 w-full rounded-ctl border border-line bg-surface px-3 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-50 sm:text-sm';

/** Fields IslePOS already shows elsewhere, or that are internal. */
const HIDDEN = new Set(['id', 'name', 'mobile', 'email', 'address', 'street', 'island', 'atoll', 'billing_address', 'tin', 'notes', 'existing', 'created_at', 'updated_at']);
/** Address with island and atoll, the way Maldivian addresses are read. */
const place = (c: IsleCustomer) => [c.address, c.island, c.atoll].filter((x) => typeof x === 'string' && x.trim()).join(', ');
const label = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Clients: the customers in the studio's IslePOS books, with their full details. */
export function ClientsPage() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [list, setList] = useState<IsleCustomer[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<IsleCustomer | 'new' | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    islepos.connection().then(setConn).catch(() => setConn({ connected: false }));
  }, []);
  useEffect(() => {
    if (!conn?.connected) return;
    setList(null);
    const t = setTimeout(() => {
      islepos
        .customers(search)
        .then((r) => {
          if (r.data.some((c) => 'street' in c)) structuredApi = true;
          setList(r.data);
          setTotal(r.total ?? r.data.length);
        })
        .catch((e) => {
          setList([]);
          toast(e instanceof ApiError ? e.message : 'Could not load clients');
        });
    }, 250);
    return () => clearTimeout(t);
  }, [conn, search]);

  const more = async () => {
    if (!list) return;
    setLoadingMore(true);
    try {
      const r = await islepos.customers(search, list.length);
      setList([...list, ...r.data]);
      setTotal(r.total ?? total);
    } finally {
      setLoadingMore(false);
    }
  };

  const saved = (c: IsleCustomer) => {
    setList((l) => {
      const rest = (l ?? []).filter((x) => x.id !== c.id);
      return editing === 'new' ? [c, ...rest] : (l ?? []).map((x) => (x.id === c.id ? c : x));
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">Clients</h1>
          <p className="mt-1 text-sm text-ink-3">Your IslePOS customers. Changes here are saved to IslePOS.</p>
        </div>
        {conn?.connected && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            New client
          </Button>
        )}
      </div>

      {!conn ? (
        <div className="py-20 text-center">
          <Spinner />
        </div>
      ) : !conn.connected ? (
        <div className="mt-8 flex flex-col items-center rounded-card border border-dashed border-line-strong bg-surface/50 px-6 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Users className="h-6 w-6" />
          </div>
          <h2 className="mt-5 text-lg font-semibold tracking-tight">Connect IslePOS to manage clients</h2>
          <p className="mt-2 max-w-md text-sm text-ink-2">Clients, quotes and invoices live in your IslePOS books. Connect once in Settings.</p>
          <Link to="/settings" className="mt-6 inline-flex h-10 items-center rounded-ctl bg-ink px-4 text-sm font-medium text-page">
            Open Settings
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, mobile, email" className="pl-10" />
            </div>
            {list && <span className="text-[13px] text-ink-3">{total.toLocaleString()} {total === 1 ? 'client' : 'clients'}</span>}
          </div>
          <div className="mt-5 overflow-hidden rounded-card border border-line bg-surface">
            {list === null ? (
              <div className="py-16 text-center">
                <Spinner />
              </div>
            ) : list.length === 0 ? (
              <p className="px-5 py-14 text-center text-sm text-ink-3">{search ? 'No clients match.' : 'No clients yet.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-raised text-left text-ink-3">
                      <th className="px-5 py-2.5 font-medium">Client</th>
                      <th className="px-4 py-2.5 font-medium">Mobile</th>
                      <th className="px-4 py-2.5 font-medium">Email</th>
                      <th className="px-4 py-2.5 font-medium">Address</th>
                      <th className="px-4 py-2.5 font-medium">TIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id} onClick={() => setEditing(c)} className="cursor-pointer border-b border-line/70 last:border-b-0 hover:bg-raised">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={c.name} size={30} />
                            <span className="font-medium text-ink">{c.name}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-2">{c.mobile || '—'}</td>
                        <td className="px-4 py-3 text-ink-2">{c.email || '—'}</td>
                        <td className="max-w-[280px] truncate px-4 py-3 text-ink-2" title={place(c)}>
                          {place(c) || '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-2xs text-ink-3">{c.tin || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {list && list.length < total && (
            <div className="mt-4 text-center">
              <Button size="sm" loading={loadingMore} onClick={more}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
      <ClientDialog
        client={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(c) => {
          saved(c);
          toast(c.existing ? `${c.name} was already in IslePOS — linked` : `${c.name} saved to IslePOS`);
        }}
      />
    </div>
  );
}

/** Create or edit a client. Every field maps to the IslePOS customer record. */
export function ClientDialog({ client, open, onClose, onSaved }: { client: IsleCustomer | null; open: boolean; onClose: () => void; onSaved: (c: IsleCustomer) => void }) {
  const [form, setForm] = useState({ name: '', mobile: '', email: '', street: '', atoll: '', island: '', tin: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const atoll = str(client?.atoll);
    const island = str(client?.island);
    // House and road: the structured street if IslePOS sends it, else the flat address minus island/atoll.
    let street = str(client?.street);
    if (!street) {
      // Older records only have the flat "house, road, island, atoll[, country]": keep what comes
      // before the island or atoll (spelling and apostrophes ignored).
      const norm = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '');
      const stops = new Set([norm(island), norm(atoll), 'maldives', 'mv'].filter(Boolean));
      const parts = (str(client?.billing_address) || client?.address || '').split(',').map((p) => p.trim());
      const cut = parts.findIndex((p) => stops.has(norm(p)));
      street = (cut >= 0 ? parts.slice(0, cut) : parts).filter(Boolean).join(', ');
    }
    setForm({ name: client?.name ?? '', mobile: client?.mobile ?? '', email: client?.email ?? '', street, atoll, island, tin: client?.tin ?? '', notes: client?.notes ?? '' });
  }, [open, client]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const islands = form.atoll ? getAllIslandsByAtoll(form.atoll) : [];

  const save = async () => {
    if (!form.name.trim()) return setError('Enter the client’s name.');
    setBusy(true);
    setError('');
    try {
      const body: Record<string, string> = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]));
      // Newer IslePOS APIs take street / island / atoll (and refuse a flat address alongside them);
      // older ones only take the flat "street, island, atoll". The record tells us which: newer
      // APIs return a `street` field.
      const structured = client ? 'street' in client : structuredApi;
      if (!structured) {
        body.address = [body.street, body.island, body.atoll].filter(Boolean).join(', ');
        delete body.street;
        delete body.island;
        delete body.atoll;
      }
      const c = client ? await islepos.updateCustomer(client.id, body) : await islepos.createCustomer({ ...body, name: body.name });
      onSaved(c);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the client.');
    } finally {
      setBusy(false);
    }
  };

  const extras = client ? Object.entries(client).filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== '' && typeof v !== 'object') : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={client ? client.name : 'New client'}
      description={client ? 'Saved to the customer record in IslePOS.' : 'Saved in IslePOS. If the mobile or email is already in your books, that client is linked instead.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {client ? 'Save changes' : 'Add client'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" error={error || undefined}>
          <Input value={form.name} onChange={set('name')} autoFocus={!client} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile">
            <Input value={form.mobile} onChange={set('mobile')} inputMode="tel" placeholder="+960 …" />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={set('email')} type="email" />
          </Field>
        </div>
        <Field label="House and road">
          <Input value={form.street} onChange={set('street')} placeholder="e.g. G. Hazel House, Rah Dhebai Magu" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Atoll">
            <select
              value={form.atoll}
              onChange={(e) => setForm((f) => ({ ...f, atoll: e.target.value, island: getAllIslandsByAtoll(e.target.value).includes(f.island) ? f.island : '' }))}
              className={SELECT}
            >
              <option value="">Choose atoll</option>
              {ATOLL_NAMES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Island">
            <select value={form.island} onChange={set('island')} disabled={!form.atoll} className={SELECT}>
              <option value="">{form.atoll ? 'Choose island' : 'Choose an atoll first'}</option>
              {/* Keep a saved island that is not on the list, so it is never silently dropped. */}
              {form.island && !islands.includes(form.island) && <option value={form.island}>{form.island}</option>}
              {islands.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="TIN" hint="Tax identification number, for invoices.">
          <Input value={form.tin} onChange={set('tin')} />
        </Field>
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={set('notes')}
            rows={3}
            className="w-full rounded-ctl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-sm"
          />
        </Field>
        {extras.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-ctl bg-raised px-3.5 py-3 text-[13px]">
            {extras.map(([k, v]) => (
              <div key={k}>
                <dt className="text-2xs text-ink-3">{label(k)}</dt>
                <dd className="text-ink">{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Dialog>
  );
}

/** Kept for the Billing sheet: create-only. */
export function NewClientDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: IsleCustomer) => void }) {
  return <ClientDialog client={null} open={open} onClose={onClose} onSaved={onCreated} />;
}
