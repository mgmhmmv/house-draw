import { useEffect, useState } from 'react';
import { ArrowRight, Moon, Sun } from 'lucide-react';
import { IsleposSettings } from './IsleposPages';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/hooks';
import { TEMPLATES } from '../lib/templates';
import { Avatar, Button, Field, Input, Segmented, toast } from '../ui';
import { getStudio, saveStudio, type StudioProfile } from '../lib/studio';
import { PlanGlyph } from './PlanGlyph';

function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
      <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">{title}</h1>
      {subtitle && <p className="mt-2 max-w-xl text-[15px] text-ink-2">{subtitle}</p>}
      <div className="mt-8">{children}</div>
    </div>
  );
}

export function TemplatesPage({ onUse }: { onUse: (templateId: string) => void }) {
  return (
    <Page title="Templates" subtitle="Starting points with a full drawing set: plans, elevations, structure, MEP and a priced BOQ.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onUse(t.id)}
            className="group overflow-hidden rounded-card border border-line bg-surface text-left transition-all hover:-translate-y-0.5 hover:shadow-float"
          >
            <div className="h-44 bg-raised bg-blueprint px-10 py-6">
              {t.id === 'blank' ? <div className="h-full w-full rounded-lg border-2 border-dashed border-line-strong" /> : <PlanGlyph seed={t.id} rooms={t.id === 'eco' ? 4 : 7} levels={t.id === 'villa' ? 2 : 1} />}
            </div>
            <div className="border-t border-line p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold tracking-tight">{t.name}</h3>
                <span className="font-mono text-2xs text-ink-3">{t.size}</span>
              </div>
              <p className="mt-1 text-[13px] text-ink-2">{t.blurb}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent">
                Use template <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </button>
        ))}
      </div>
    </Page>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const [theme, setTheme] = useTheme();
  if (!user) return null;
  return (
    <Page title="Settings">
      <div className="max-w-2xl divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex items-center gap-4 p-5">
          <Avatar name={user.name} size={48} />
          <div className="min-w-0">
            <div className="font-medium">{user.name}</div>
            <div className="truncate text-sm text-ink-3">{user.email}</div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 p-5">
          <div>
            <div className="text-sm font-medium">Appearance</div>
            <div className="text-[13px] text-ink-3">Light or dark interface.</div>
          </div>
          <Segmented
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: <Sun className="h-4 w-4" />, title: 'Light' },
              { value: 'dark', label: <Moon className="h-4 w-4" />, title: 'Dark' },
            ]}
          />
        </div>
        <IsleposSettings />
        <StudioSettings />
      </div>
    </Page>
  );
}

/** Studio details for drawing title blocks. */
function StudioSettings() {
  const [p, setP] = useState<StudioProfile | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getStudio().then(setP);
  }, []);
  if (!p) return null;
  const f = (k: keyof StudioProfile, label: string, ph = '') => (
    <Field label={label}>
      <Input value={p[k]} placeholder={ph} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
    </Field>
  );
  return (
    <div className="space-y-4 p-5">
      <div>
        <div className="text-sm font-medium">Drawing title block</div>
        <div className="text-[13px] text-ink-3">Printed in the sidebar of every exported sheet.</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {f('studioName', 'Studio name', 'e.g. Rajje Sol')}
        {f('legalName', 'Company', 'e.g. PICAD PVT LTD')}
        {f('regNo', 'Registration no.')}
        {f('tin', 'GST TIN')}
        <div className="sm:col-span-2">{f('address', 'Address', "e.g. G. Hazel House, Rah Dhebai Magu, Male'")}</div>
        {f('phone', 'Phone')}
        {f('email', 'Email')}
        {f('drawnBy', 'Drawn by')}
        {f('checkedBy', 'Checked by')}
        {f('prefix', 'Drawing number prefix', 'e.g. RS')}
      </div>
      <Field label="General notes (one per line)">
        <textarea
          value={p.notes}
          onChange={(e) => setP({ ...p, notes: e.target.value })}
          rows={4}
          className="w-full rounded-ctl border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        />
      </Field>
      <div className="flex justify-end">
        <Button
          variant="primary"
          loading={busy}
          onClick={() => {
            setBusy(true);
            saveStudio(p)
              .then((x) => {
                setP(x);
                toast('Title block saved');
              })
              .catch(() => toast('Could not save'))
              .finally(() => setBusy(false));
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
