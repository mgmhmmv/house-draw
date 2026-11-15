import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useRouter } from '../lib/router';
import { summarize, TEMPLATES } from '../lib/templates';
import { billing, islepos, type IsleCustomer } from '../lib/islepos';
import { Button, cx, Dialog, Field, Input, toast } from '../ui';
import { ClientPicker } from './ClientPicker';
import { addressBody, AtollIslandSelects, clientAddress } from './IsleposPages';
import { PlanGlyph } from './PlanGlyph';

const EMPTY_SITE = { street: '', atoll: '', island: '' };

export function NewProjectDialog({ open, onClose, initialTemplate = 'blank' }: { open: boolean; onClose: () => void; initialTemplate?: string }) {
  const { navigate } = useRouter();
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [customer, setCustomer] = useState<IsleCustomer | null>(null);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [site, setSite] = useState(EMPTY_SITE);
  const [phone, setPhone] = useState('');
  const [template, setTemplate] = useState(initialTemplate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTemplate(initialTemplate);
      setError('');
      islepos
        .connection()
        .then((c) => setLinked(c.connected))
        .catch(() => setLinked(false));
    }
  }, [open, initialTemplate]);

  // Picking a client fills the site from their address; the fields stay editable.
  const pick = (c: IsleCustomer | null) => {
    setCustomer(c);
    setSite(c ? clientAddress(c) : EMPTY_SITE);
    setPhone(c?.mobile ?? '');
  };
  const noAddress = (c: IsleCustomer) => Object.values(clientAddress(c)).every((v) => !v.trim());
  const location = [site.street, site.island, site.atoll].map((x) => x.trim()).filter(Boolean).join(', ');

  const create = async () => {
    if (!name.trim()) {
      setError('Give the project a name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const t = TEMPLATES.find((x) => x.id === template) ?? TEMPLATES[0];
      const model = t.create();
      const clientName = (customer?.name ?? client).trim();
      model.meta = { ...model.meta, title: name.trim(), client: clientName, clientPhone: phone.trim(), location };
      const { project } = await api.createProject({ name: name.trim(), client: clientName, location, template: t.id, summary: summarize(model), model });
      if (customer) {
        // Link the project so it shows on the client's page; a failure here shouldn't lose the project.
        await billing.setCustomer(project.id, customer.id).catch(() => toast('Project created, but it could not be linked to the client.'));
        // Details the client had no record of are saved back to them; existing ones are never overwritten.
        const patch: Record<string, string> = {};
        if (noAddress(customer) && location) Object.assign(patch, addressBody(customer, site));
        if (!customer.mobile?.trim() && phone.trim()) patch.mobile = phone.trim();
        if (Object.keys(patch).length) await islepos.updateCustomer(customer.id, patch).catch(() => toast('Could not save the new details to the client.'));
      }
      onClose();
      setName('');
      setClient('');
      setCustomer(null);
      setSite(EMPTY_SITE);
      setPhone('');
      navigate(`/p/${project.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the project.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="New project"
      description="Start from a blank site or a template. You can change everything later."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={create}>
            Create project
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Project name" error={error || undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hulhumalé family house" autoFocus onKeyDown={(e) => e.key === 'Enter' && create()} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Client">
            {linked ? <ClientPicker value={customer} onChange={pick} /> : <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Optional" />}
          </Field>
        </div>
        <Field label="Contact number" hint={customer && !customer.mobile?.trim() && phone.trim() ? `Will be saved to ${customer.name}.` : undefined}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="+960 …" />
        </Field>
        <Field label="House / road">
          <Input value={site.street} onChange={(e) => setSite((s) => ({ ...s, street: e.target.value }))} placeholder="e.g. Blue Villa, Majeedhee Magu" />
        </Field>
        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Atoll and island</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <AtollIslandSelects atoll={site.atoll} island={site.island} onChange={(v) => setSite((s) => ({ ...s, ...v }))} />
          </div>
          {customer && noAddress(customer) && location && (
            <span className="mt-1.5 block text-[13px] text-ink-3">{customer.name} has no address yet; it will be saved to them.</span>
          )}
        </div>
      </div>

      <p className="mb-3 mt-7 text-[13px] font-medium text-ink-2">Start from</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => {
          const active = t.id === template;
          return (
            <button
              key={t.id}
              onClick={() => setTemplate(t.id)}
              className={cx(
                'group relative flex gap-3 rounded-card border p-3 text-left transition-all sm:flex-col sm:gap-0 sm:p-0',
                active ? 'border-accent ring-4 ring-accent/15' : 'border-line hover:border-line-strong'
              )}
            >
              <div className="h-16 w-20 shrink-0 rounded-[10px] bg-raised p-1.5 sm:h-24 sm:w-auto sm:rounded-b-none sm:rounded-t-[15px] sm:p-3">
                {t.id === 'blank' ? <div className="h-full w-full rounded-md border-2 border-dashed border-line-strong" /> : <PlanGlyph seed={t.id} rooms={t.id === 'eco' ? 4 : 6} />}
              </div>
              <div className="min-w-0 sm:p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="font-mono text-2xs text-ink-3">{t.size}</span>
                </div>
                <p className="mt-1 text-[13px] leading-snug text-ink-2">{t.blurb}</p>
              </div>
              {active && (
                <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-ink">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
