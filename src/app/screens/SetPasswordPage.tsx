import { useState } from 'react';
import { Logo } from '../ui';

/** The one-time link from an invite: /set-password#t=<token>. Sets the password and signs in. */
export default function SetPasswordPage() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mismatch = again.length > 0 && again !== password;

  const input = 'h-11 w-full rounded-ctl border border-line bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-accent';
  return (
    <div className="flex min-h-screen-safe flex-col px-6 py-8 sm:px-12">
      <Logo />
      <div className="flex flex-1 items-center">
        <form
          className="mx-auto w-full max-w-sm space-y-3 py-12"
          onSubmit={async (e) => {
            e.preventDefault();
            if (password !== again) return;
            setBusy(true);
            setError('');
            const r = await fetch('/api/auth/set-password', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token, password }),
            }).catch(() => null);
            if (r?.ok) {
              window.location.replace('/');
              return;
            }
            const j = await r?.json().catch(() => null);
            setError(j?.message || 'Couldn’t set the password. Try again.');
            setBusy(false);
          }}
        >
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Choose your password</h1>
          <p className="pb-3 text-[15px] text-ink-2">At least 10 characters. You’ll sign in with your email and this password.</p>
          {!token ? (
            <p className="rounded-ctl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">This link is incomplete. Ask for a new invite.</p>
          ) : (
            <>
              <input type="password" required minLength={10} autoComplete="new-password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
              <input type="password" required autoComplete="new-password" placeholder="Type it again" value={again} onChange={(e) => setAgain(e.target.value)} className={input} />
              {(error || mismatch) && (
                <p className="text-sm text-danger" role="alert">
                  {mismatch ? 'The two passwords don’t match.' : error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || password.length < 10 || password !== again}
                className="flex h-11 w-full items-center justify-center rounded-ctl bg-ink text-[15px] font-medium text-page transition-colors hover:bg-ink/85 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Set password and sign in'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
