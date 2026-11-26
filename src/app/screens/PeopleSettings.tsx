import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button, Field, Input, toast } from '../ui';

type Person = { email: string; name: string; createdAt: number; hasPassword: boolean };

/** Owner only: invite people to sign in with email and password, and take access away. */
export function PeopleSettings() {
  const [people, setPeople] = useState<Person[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  const load = () => api.people().then((r) => setPeople(r.people)).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const invite = async (target: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.invitePerson(target);
      setLink({ email: r.email, url: r.url });
      setEmail('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-5">
      <div>
        <div className="text-sm font-medium">People</div>
        <p className="mt-0.5 text-[13px] text-ink-3">
          Let someone in without Google. You get a one-time link (valid 7 days) to send them; they choose their own password from it.
        </p>
      </div>
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) invite(email.trim());
        }}
      >
        <div className="flex-1">
          <Field label="Email" error={error || undefined}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" />
          </Field>
        </div>
        <Button variant="primary" loading={busy} disabled={!email.trim()} type="submit">
          Invite
        </Button>
      </form>
      {link && (
        <div className="rounded-ctl border border-line bg-raised p-3 text-[13px]">
          <div className="text-ink-2">Send this link to {link.email}. It works once.</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-ink">{link.url}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(link.url).then(() => toast('Link copied'))}
            >
              Copy
            </Button>
          </div>
        </div>
      )}
      {people.length > 0 && (
        <ul className="divide-y divide-line rounded-ctl border border-line">
          {people.map((p) => (
            <li key={p.email} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm">{p.email}</div>
                <div className="text-2xs text-ink-3">{p.hasPassword ? 'Password set' : 'Invited · no password yet'}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => invite(p.email)}>
                  New link
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api.removePerson(p.email);
                    toast(`${p.email} can no longer sign in`);
                    load();
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
