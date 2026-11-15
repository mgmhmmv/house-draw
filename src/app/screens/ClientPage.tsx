import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Mail, MapPin, Pencil, Phone, RefreshCw } from 'lucide-react';
import type { ProjectStatus } from '../lib/api';
import { islepos, mvr, type IsleCustomer, type IsleDoc } from '../lib/islepos';
import { Link } from '../lib/router';
import { timeAgo } from '../lib/hooks';
import { Avatar, Button, cx, Spinner, StatusPill } from '../ui';
import { ClientDialog } from './IsleposPages';
import { PlanGlyph } from './PlanGlyph';

interface ClientProject {
  id: string;
  name: string;
  location: string;
  status: ProjectStatus;
  summary: { area?: number; rooms?: number; levels?: number };
  cover_at: number | null;
  updated_at: number;
}

interface ClientDocRecord {
  id: string;
  project_id: string;
  project_name: string;
  kind: 'quote' | 'invoice';
  islepos_id: string;
  number: string;
  status: string;
  total: number;
  balance_due: number | null;
  created_at: number;
}

const DOC_STYLE: Record<string, string> = {
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
const DOC_LABEL: Record<string, string> = { quoted: 'Issued', sent: 'Issued', partial: 'Part paid' };
const DocPill = ({ status }: { status: string }) => (
  <span className={cx('rounded-full px-2.5 py-0.5 text-2xs font-medium capitalize', DOC_STYLE[status] ?? 'bg-sunken text-ink-2')}>{DOC_LABEL[status] ?? status}</span>
);
const day = (iso?: string | number) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * One client: their details from IslePOS, and only what ArchStudio holds for them —
 * projects linked to them and the quotes, invoices and payments raised from those projects.
 */
export function ClientPage({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<IsleCustomer | null>(null);
  const [projects, setProjects] = useState<ClientProject[] | null>(null);
  const [records, setRecords] = useState<ClientDocRecord[]>([]);
  const [docs, setDocs] = useState<Record<string, IsleDoc>>({});
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      islepos
        .customer(customerId)
        .then(setCustomer)
        .catch(() => setError('This client isn’t available from IslePOS.'));
      const r = (await fetch(`/api/clients/${encodeURIComponent(customerId)}`).then((x) => x.json())) as { projects: ClientProject[]; documents: ClientDocRecord[] };
      setProjects(r.projects ?? []);
      setRecords(r.documents ?? []);
      // Live status and payments for each document, from IslePOS.
      const fresh = await Promise.all((r.documents ?? []).map((d) => islepos.doc(d.kind, d.islepos_id).catch(() => null)));
      const map: Record<string, IsleDoc> = {};
      for (const d of fresh) if (d) map[d.id] = d;
      setDocs(map);
    } finally {
      setRefreshing(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const quotes = records.filter((r) => r.kind === 'quote');
  const invoices = records.filter((r) => r.kind === 'invoice');
  const live = (r: ClientDocRecord) => docs[r.islepos_id];
  const payments = invoices
    .flatMap((r) => (live(r)?.payments ?? []).filter((p) => !p.reversed).map((p) => ({ ...p, invoice: live(r)!.number || r.number, project: r.project_name })))
    .sort((a, b) => +new Date(b.paid_at) - +new Date(a.paid_at));
  const invoiced = invoices.reduce((s, r) => s + (live(r)?.status === 'cancelled' || live(r)?.status === 'draft' ? 0 : live(r)?.total ?? r.total), 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = invoices.reduce((s, r) => {
    const d = live(r);
    return s + (d && d.status !== 'cancelled' && d.status !== 'draft' ? d.balance_due : 0);
  }, 0);

  const place = customer ? [customer.street ?? '', customer.island ?? '', customer.atoll ?? ''].filter((x) => typeof x === 'string' && x).join(', ') || customer.address : '';

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Clients
      </Link>

      {error ? (
        <p className="mt-10 text-center text-sm text-ink-3">{error}</p>
      ) : !customer ? (
        <div className="py-24 text-center">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar name={customer.name} size={56} />
              <div className="min-w-0">
                <h1 className="truncate text-[26px] font-semibold tracking-tight">{customer.name}</h1>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
                  {customer.mobile && (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-ink-3" /> {customer.mobile}
                    </span>
                  )}
                  {customer.email && (
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-ink-3" /> {customer.email}
                    </span>
                  )}
                  {place && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-ink-3" /> {String(place)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" icon={<RefreshCw className={cx('h-4 w-4', refreshing && 'animate-spin')} />} onClick={load}>
                Refresh
              </Button>
              <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Projects', String(projects?.length ?? '—')],
              ['Invoiced', mvr(invoiced)],
              ['Received', mvr(paid)],
              ['Outstanding', mvr(outstanding)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-card border border-line bg-surface px-4 py-3.5">
                <div className="text-2xs font-medium uppercase tracking-wide text-ink-3">{k}</div>
                <div className="mt-1 truncate text-[18px] font-semibold tabular-nums tracking-tight">{v}</div>
              </div>
            ))}
          </div>

          <Section title="Projects" empty="No projects for this client yet. Choose them as the client in a project’s Billing sheet.">
            {projects && projects.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => (
                  <Link key={p.id} to={`/p/${p.id}`} className="flex gap-3 rounded-card border border-line bg-surface p-3 transition-colors hover:border-line-strong">
                    <div className="h-16 w-24 shrink-0 overflow-hidden rounded-[10px] bg-raised">
                      {p.cover_at ? (
                        <img src={`/api/projects/${p.id}/cover?v=${p.cover_at}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full p-1.5">
                          <PlanGlyph seed={p.id} rooms={p.summary?.rooms} levels={p.summary?.levels} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="mt-1">
                        <StatusPill status={p.status} />
                      </div>
                      <div className="mt-1 text-2xs text-ink-3">Edited {timeAgo(p.updated_at)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          <Section title="Quotes" empty="No quotes from ArchStudio yet." show={quotes.length > 0}>
            <DocTable rows={quotes} live={live} />
          </Section>

          <Section title="Invoices" empty="No invoices from ArchStudio yet." show={invoices.length > 0}>
            <DocTable rows={invoices} live={live} invoice />
          </Section>

          <Section title="Payments received" empty="No payments recorded against ArchStudio invoices yet." show={payments.length > 0}>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {payments.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-[13px] last:border-b-0">
                  <span className="w-28 text-ink-2">{day(p.paid_at)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    Invoice {p.invoice} · <span className="text-ink-3">{p.project}</span>
                  </span>
                  <span className="text-ink-3 capitalize">{p.method?.replace(/_/g, ' ')}</span>
                  {p.reference && <span className="font-mono text-2xs text-ink-3">{p.reference}</span>}
                  <span className="w-32 text-right font-medium tabular-nums">{mvr(p.amount)}</span>
                </div>
              ))}
            </div>
          </Section>

          <p className="mt-8 text-2xs text-ink-3">Only projects, quotes and invoices made in ArchStudio are shown here. The rest of this client’s history stays in IslePOS.</p>
        </>
      )}

      <ClientDialog client={customer} open={editing} onClose={() => setEditing(false)} onSaved={(c) => setCustomer(c)} />
    </div>
  );
}

function Section({ title, empty, show, children }: { title: string; empty: string; show?: boolean; children: React.ReactNode }) {
  const has = show ?? true;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {has && children ? children : <p className="rounded-card border border-dashed border-line-strong px-5 py-6 text-center text-[13px] text-ink-3">{empty}</p>}
    </section>
  );
}

function DocTable({ rows, live, invoice }: { rows: ClientDocRecord[]; live: (r: ClientDocRecord) => IsleDoc | undefined; invoice?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-raised text-left text-ink-3">
            <th className="px-5 py-2.5 font-medium">Number</th>
            <th className="px-4 py-2.5 font-medium">Project</th>
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
            {invoice && <th className="px-5 py-2.5 text-right font-medium">Balance</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = live(r);
            return (
              <tr key={r.id} className="border-b border-line/70 last:border-b-0">
                <td className="px-5 py-3 font-medium">{d?.number ?? r.number}</td>
                <td className="px-4 py-3">
                  <Link to={`/p/${r.project_id}/billing`} className="text-ink-2 hover:text-ink hover:underline">
                    {r.project_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-2">{day(d?.issue_date ?? r.created_at)}</td>
                <td className="px-4 py-3">
                  <DocPill status={d?.status ?? r.status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{mvr(d?.total ?? r.total)}</td>
                {invoice && <td className="px-5 py-3 text-right tabular-nums">{mvr(d?.balance_due ?? r.balance_due ?? 0)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
