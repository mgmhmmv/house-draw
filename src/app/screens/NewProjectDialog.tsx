import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useRouter } from '../lib/router';
import { summarize, TEMPLATES } from '../lib/templates';
import { Button, cx, Dialog, Field, Input } from '../ui';
import { PlanGlyph } from './PlanGlyph';

export function NewProjectDialog({ open, onClose, initialTemplate = 'blank' }: { open: boolean; onClose: () => void; initialTemplate?: string }) {
  const { navigate } = useRouter();
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [location, setLocation] = useState('');
  const [template, setTemplate] = useState(initialTemplate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTemplate(initialTemplate);
      setError('');
    }
  }, [open, initialTemplate]);

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
      model.meta = { ...model.meta, title: name.trim(), client: client.trim(), location: location.trim() };
      const { project } = await api.createProject({ name: name.trim(), client, location, template: t.id, summary: summarize(model), model });
      onClose();
      setName('');
      setClient('');
      setLocation('');
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
        <Field label="Client">
          <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Site location">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
        </Field>
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
