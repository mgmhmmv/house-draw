import { useEffect, useState } from 'react';
import { Mail, Phone, Plus, Search, Users } from 'lucide-react';
import { ApiError } from '../lib/api';
import { islepos, type Connection, type IsleCustomer } from '../lib/islepos';
import { Link } from '../lib/router';
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

/** Clients: the customers this studio keeps in IslePOS. */
export function ClientsPage() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [list, setList] = useState<IsleCustomer[] | null>(null);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    islepos.connection().then(setConn).catch(() => setConn({ connected: false }));
  }, []);
  useEffect(() => {
    if (!conn?.connected) return;
    const t = setTimeout(() => {
      islepos
        .customers(search)
        .then((r) => setList(r.data))
        .catch((e) => {
          setList([]);
          toast(e instanceof ApiError ? e.message : 'Could not load clients');
        });
    }, 250);
    return () => clearTimeout(t);
  }, [conn, search]);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">Clients</h1>
          <p className="mt-1 text-sm text-ink-3">Kept in IslePOS, so quotes and invoices land in your books.</p>
        </div>
        {conn?.connected && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
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
          <div className="relative mt-6 sm:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, mobile, email" className="pl-10" />
          </div>
          <div className="mt-5 overflow-hidden rounded-card border border-line bg-surface">
            {list === null ? (
              <div className="py-16 text-center">
                <Spinner />
              </div>
            ) : list.length === 0 ? (
              <p className="px-5 py-14 text-center text-sm text-ink-3">{search ? 'No clients match.' : 'No clients yet. Add one, or pick one when billing a project.'}</p>
            ) : (
              list.map((c) => (
                <div key={c.id} className="flex items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0">
                  <Avatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 text-[13px] text-ink-3">
                      {c.mobile && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" /> {c.mobile}
                        </span>
                      )}
                      {c.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" /> {c.email}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
      <NewClientDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(c) => {
          setList((l) => [c, ...(l ?? []).filter((x) => x.id !== c.id)]);
          toast(c.existing ? `${c.name} was already in IslePOS — linked` : `${c.name} added`);
        }}
      />
    </div>
  );
}

export function NewClientDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: IsleCustomer) => void }) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!name.trim()) return setError('Enter the client’s name.');
    setBusy(true);
    setError('');
    try {
      const c = await islepos.createCustomer({ name: name.trim(), mobile: mobile.trim() || undefined, email: email.trim() || undefined });
      onCreated(c);
      setName('');
      setMobile('');
      setEmail('');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the client.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New client"
      description="Saved in IslePOS. If the mobile or email is already in your books, that client is linked instead."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Add client
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" error={error || undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile">
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" placeholder="+960 …" />
          </Field>
          <Field label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
