import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { BuildingProject } from '../../model/types';
import { calculateBOQ } from '../../engine/boqCalculator';
import { ApiError } from '../lib/api';
import { billing, islepos, mvr, type Connection, type IsleCustomer, type IsleDoc, type IsleLine, type IsleProduct, type ProjectBilling } from '../lib/islepos';
import { Link } from '../lib/router';
import { NewClientDialog } from '../screens/IsleposPages';
import { Avatar, Button, cx, Input, Spinner, toast } from '../ui';
import { Card, SheetPage } from './kit';

/** Suggested drawing packages; prices are starting points the studio edits per quote. */
const PACKAGES: IsleLine[] = [
  { name: 'Concept design', description: 'Floor plans, elevations and 3D views for approval', quantity: 1, unit_price: 15000 },
  { name: 'Construction drawing set', description: 'Plans, elevations, sections, structure and details', quantity: 1, unit_price: 35000 },
  { name: 'MEP drawings', description: 'Electrical, plumbing and HVAC layouts and schematics', quantity: 1, unit_price: 18000 },
  { name: 'Bill of quantities', description: 'Measured quantities and cost estimate', quantity: 1, unit_price: 8000 },
  { name: 'Site visit', description: 'Survey or inspection visit', quantity: 1, unit_price: 1500 },
];

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-sunken text-ink-2',
  quoted: 'bg-accent-soft text-accent',
  sent: 'bg-accent-soft text-accent',
  accepted: 'bg-ok/10 text-ok',
  converted: 'bg-sunken text-ink-3',
  partial: 'bg-warn/10 text-warn',
  overdue: 'bg-danger/10 text-danger',
  paid: 'bg-ok/10 text-ok',
  rejected: 'bg-danger/10 text-danger',
  cancelled: 'bg-sunken text-ink-3',
};
const STATUS_LABEL: Record<string, string> = { quoted: 'Issued', sent: 'Issued', partial: 'Part paid' };

function Pill({ status }: { status: string }) {
  return <span className={cx('rounded-full px-2.5 py-0.5 text-2xs font-medium capitalize', STATUS_STYLE[status] ?? 'bg-sunken text-ink-2')}>{STATUS_LABEL[status] ?? status}</span>;
}

export function BillingSheet({ projectId, model }: { projectId: string; model: BuildingProject }) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [state, setState] = useState<ProjectBilling | null>(null);
  const [customer, setCustomer] = useState<IsleCustomer | null>(null);
  const [docs, setDocs] = useState<Record<string, IsleDoc>>({});
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const b = await billing.get(projectId);
      setState(b);
      if (b.customerId) islepos.customer(b.customerId).then(setCustomer).catch(() => setCustomer(null));
      // Pull each document fresh from IslePOS (status and payments change there) and keep our record in step.
      const fresh = await Promise.all(b.documents.map((d) => islepos.doc(d.kind, d.islepos_id).catch(() => null)));
      const map: Record<string, IsleDoc> = {};
      for (const d of fresh) if (d) map[d.id] = d;
      setDocs(map);
      await Promise.all(fresh.filter((d): d is IsleDoc => !!d).map((d) => billing.record(projectId, d)));
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    islepos
      .connection()
      .then((c) => {
        setConn(c);
        if (c.connected) refresh();
      })
      .catch(() => setConn({ connected: false }));
  }, [refresh]);

  const linkCustomer = async (c: IsleCustomer | null) => {
    setCustomer(c);
    setState(await billing.setCustomer(projectId, c?.id ?? null));
  };

  const onDoc = async (d: IsleDoc) => {
    setDocs((m) => ({ ...m, [d.id]: d }));
    setState(await billing.record(projectId, d));
  };

  if (!conn) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!conn.connected)
    return (
      <SheetPage code="Billing" title="Billing" lede="Quote and invoice this project's client from your IslePOS books.">
        <Card title="Connect IslePOS">
          <p className="text-sm text-ink-2">Billing uses IslePOS for clients, quotes, invoices and payments. Connect it once in Settings.</p>
          <Link to="/settings" className="mt-4 inline-flex h-10 items-center rounded-ctl bg-ink px-4 text-sm font-medium text-page">
            Open Settings
          </Link>
        </Card>
      </SheetPage>
    );

  const records = state?.documents ?? [];
  const invoices = records.filter((r) => r.kind === 'invoice').map((r) => docs[r.islepos_id]).filter(Boolean);
  const paid = invoices.reduce((s, d) => s + d.amount_paid, 0);
  const owed = invoices.filter((d) => d.status !== 'cancelled' && d.status !== 'draft').reduce((s, d) => s + d.balance_due, 0);

  return (
    <SheetPage
      code="Billing"
      title="Billing"
      lede="Quote and invoice this project's client from your IslePOS books. Payments are recorded in IslePOS and show up here."
      actions={
        <Button size="sm" icon={<RefreshCw className={cx('h-4 w-4', refreshing && 'animate-spin')} />} onClick={refresh}>
          Refresh
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Client" value={customer?.name ?? '—'} />
        <Stat label="Paid" value={mvr(paid)} />
        <Stat label="Outstanding" value={mvr(owed)} />
      </div>

      <ClientCard customer={customer} onLink={linkCustomer} />

      {customer && <NewQuote customer={customer} model={model} onCreated={onDoc} />}

      <Card title="Quotes and invoices" flush>
        {records.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-ink-3">Nothing yet. Create a quote above.</p>
        ) : (
          <div className="divide-y divide-line">
            {records.map((r) => (
              <DocRow key={r.id} record={r} doc={docs[r.islepos_id]} onChange={onDoc} onRefresh={refresh} />
            ))}
          </div>
        )}
      </Card>
      <p className="text-2xs text-ink-3">
        Issuing marks a document as sent in IslePOS; nothing is emailed from here. Send it and record payments from IslePOS.
        {conn.env === 'staging' && ' Connected to IslePOS staging.'}
      </p>
    </SheetPage>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3.5">
      <div className="text-2xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-1 truncate text-[17px] font-semibold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}

function ClientCard({ customer, onLink }: { customer: IsleCustomer | null; onLink: (c: IsleCustomer | null) => void }) {
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<IsleCustomer[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!picking && customer) return;
    const t = setTimeout(() => islepos.customers(search).then((r) => setResults(r.data)).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [search, picking, customer]);

  if (customer && !picking)
    return (
      <Card title="Client" aside={<button onClick={() => setPicking(true)} className="text-[13px] font-medium text-accent hover:underline">Change</button>}>
        <div className="flex items-center gap-3">
          <Avatar name={customer.name} size={40} />
          <div className="min-w-0">
            <div className="truncate font-medium">{customer.name}</div>
            <div className="truncate text-[13px] text-ink-3">{[customer.mobile, customer.email].filter(Boolean).join(' · ') || 'No contact details'}</div>
          </div>
        </div>
      </Card>
    );

  return (
    <Card
      title="Choose the client"
      aside={
        <div className="flex gap-2">
          {customer && (
            <button onClick={() => setPicking(false)} className="text-[13px] text-ink-3 hover:text-ink">
              Cancel
            </button>
          )}
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
            <Plus className="h-3.5 w-3.5" /> New client
          </button>
        </div>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your IslePOS clients" className="pl-10" autoFocus />
      </div>
      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        {results === null ? (
          <div className="py-6 text-center">
            <Spinner />
          </div>
        ) : results.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-3">No clients found. Add a new one.</p>
        ) : (
          results.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onLink(c);
                setPicking(false);
              }}
              className="flex w-full items-center gap-3 rounded-ctl px-2 py-2 text-left hover:bg-sunken"
            >
              <Avatar name={c.name} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{c.name}</span>
                <span className="block truncate text-2xs text-ink-3">{[c.mobile, c.email].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))
        )}
      </div>
      <NewClientDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(c) => {
          onLink(c);
          setPicking(false);
          toast(c.existing ? `${c.name} was already in IslePOS — linked` : `${c.name} added`);
        }}
      />
    </Card>
  );
}

function NewQuote({ customer, model, onCreated }: { customer: IsleCustomer; model: BuildingProject; onCreated: (d: IsleDoc) => void }) {
  const [lines, setLines] = useState<IsleLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogue, setCatalogue] = useState<IsleProduct[] | null>(null);
  const boq = useMemo(() => calculateBOQ(model), [model]);
  const subtotal = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);

  useEffect(() => {
    islepos.products('').then((r) => setCatalogue(r.data)).catch(() => setCatalogue([]));
  }, []);

  const add = (l: IsleLine) => setLines((ls) => [...ls, { ...l }]);
  const set = (i: number, patch: Partial<IsleLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const create = async () => {
    if (!lines.length) return;
    setBusy(true);
    try {
      const doc = await islepos.createQuote({
        customer_id: customer.id,
        items: lines.map((l) => (l.sku ? { sku: l.sku, quantity: l.quantity } : { name: l.name, description: l.description ?? undefined, unit_price: l.unit_price, quantity: l.quantity })) as IsleLine[],
        discount: discount || undefined,
        notes: notes || `${model.meta.title}${model.meta.location ? ` — ${model.meta.location}` : ''}`,
        valid_days: 14,
      });
      onCreated(doc);
      setLines([]);
      setDiscount(0);
      setNotes('');
      toast(`Quote ${doc.number} created as a draft`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not create the quote');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="New quote">
      <p className="text-[13px] text-ink-3">Add drawing packages for {customer.name}. Prices are in MVR; edit them before creating the quote.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {PACKAGES.map((p) => (
          <button key={p.name} onClick={() => add(p)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-ink-2 hover:border-line-strong hover:text-ink">
            <Plus className="h-3.5 w-3.5" /> {p.name}
          </button>
        ))}
        {catalogue?.slice(0, 6).map((p) => (
          <button
            key={p.id}
            onClick={() => add({ sku: p.sku, name: p.name, description: p.description, quantity: 1, unit_price: p.price })}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 text-[13px] text-accent"
            title="From your IslePOS catalogue"
          >
            <Plus className="h-3.5 w-3.5" /> {p.name}
          </button>
        ))}
        <button onClick={() => add({ name: 'Item', quantity: 1, unit_price: 0 })} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-ink-3 hover:text-ink">
          <Plus className="h-3.5 w-3.5" /> Custom line
        </button>
      </div>

      {lines.length > 0 && (
        <div className="mt-4 space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-ctl border border-line p-2.5 sm:grid-cols-[1fr_70px_130px_auto] sm:items-center">
              <div className="min-w-0">
                <input value={l.name ?? ''} onChange={(e) => set(i, { name: e.target.value })} disabled={!!l.sku} className="w-full bg-transparent text-sm font-medium focus:outline-none" />
                <input value={l.description ?? ''} onChange={(e) => set(i, { description: e.target.value })} placeholder="Description" disabled={!!l.sku} className="w-full bg-transparent text-[13px] text-ink-3 focus:outline-none" />
              </div>
              <button onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} aria-label="Remove line" className="self-start text-ink-3 hover:text-danger sm:order-last sm:self-center">
                <Trash2 className="h-4 w-4" />
              </button>
              <input type="number" min={1} value={l.quantity} onChange={(e) => set(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} aria-label="Quantity" className="h-8 rounded-ctl border border-line bg-surface px-2 text-right text-[13px] tabular-nums" />
              <input type="number" min={0} value={l.unit_price} onChange={(e) => set(i, { unit_price: Math.max(0, Number(e.target.value) || 0) })} disabled={!!l.sku} aria-label="Unit price" className="h-8 rounded-ctl border border-line bg-surface px-2 text-right text-[13px] tabular-nums" />
            </div>
          ))}
          <div className="grid gap-3 pt-2 sm:grid-cols-[1fr_180px]">
            <Input inputSize="sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={`Note (default: ${model.meta.title})`} />
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Discount
              <input type="number" min={0} value={discount} onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))} className="h-8 w-full rounded-ctl border border-line bg-surface px-2 text-right tabular-nums" />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div className="text-sm">
              Total <span className="font-semibold tabular-nums">{mvr(Math.max(0, subtotal - discount))}</span>
              <span className="ml-2 text-2xs text-ink-3">Construction estimate for reference: {model.meta.currency} {Math.round(boq.grandTotal).toLocaleString()}</span>
            </div>
            <Button variant="primary" size="sm" loading={busy} onClick={create}>
              Create quote
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DocRow({ record, doc, onChange, onRefresh }: { record: ProjectBilling['documents'][number]; doc?: IsleDoc; onChange: (d: IsleDoc) => void; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const status = doc?.status ?? record.status;
  const kind = record.kind;
  const act = async (action: string, body?: unknown) => {
    setBusy(action);
    try {
      const d = await islepos.action(kind, record.islepos_id, action, body);
      onChange(d);
      if (action === 'convert') toast(`Invoice ${d.number} created as a draft`);
      onRefresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'IslePOS could not do that');
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy('delete');
    try {
      await islepos.deleteDoc(kind, record.islepos_id);
      toast('Draft deleted in IslePOS');
      onRefresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not delete');
    } finally {
      setBusy(null);
    }
  };
  const btn = (label: string, action: string, opts: { primary?: boolean; icon?: React.ReactNode; body?: unknown } = {}) => (
    <Button key={action} size="sm" variant={opts.primary ? 'primary' : 'secondary'} loading={busy === action} disabled={!!busy && busy !== action} icon={opts.icon} onClick={() => act(action, opts.body)}>
      {label}
    </Button>
  );

  const actions: React.ReactNode[] = [];
  if (kind === 'quote') {
    if (status === 'draft') actions.push(btn('Issue', 'issue', { primary: true }));
    if (status === 'quoted') actions.push(btn('Client accepted', 'accept', { primary: true, icon: <Check className="h-4 w-4" /> }), btn('Rejected', 'reject', { icon: <X className="h-4 w-4" /> }));
    if (status === 'accepted' || status === 'quoted') actions.push(btn('Make invoice', 'convert', { primary: status === 'accepted' }));
    if (status === 'quoted' || status === 'accepted') actions.push(btn('Cancel', 'cancel'));
  } else {
    if (status === 'draft') actions.push(btn('Issue', 'issue', { primary: true }));
    if ((status === 'sent' || status === 'overdue') && (doc?.amount_paid ?? 0) === 0) actions.push(btn('Cancel', 'cancel'));
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{kind === 'quote' ? 'Quote' : 'Invoice'} {doc?.number ?? record.number}</span>
          <Pill status={status} />
        </div>
        <div className="mt-0.5 text-[13px] text-ink-3">
          {doc ? doc.items.map((i) => i.name).filter(Boolean).join(', ') : 'Loading…'}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold tabular-nums">{mvr(doc?.total ?? record.total)}</div>
        {kind === 'invoice' && doc && doc.status !== 'draft' && (
          <div className="text-2xs text-ink-3">
            {doc.balance_due > 0 ? `${mvr(doc.balance_due)} due${doc.due_date ? ` by ${new Date(doc.due_date).toLocaleDateString()}` : ''}` : 'Paid in full'}
          </div>
        )}
      </div>
      <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
        {actions}
        {status === 'draft' && (
          <Button size="sm" variant="ghost" loading={busy === 'delete'} icon={<Trash2 className="h-4 w-4" />} onClick={remove} aria-label="Delete draft" />
        )}
      </div>
    </div>
  );
}
