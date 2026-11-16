import { lazy, Suspense, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

// three.js stays out of the first paint; the model streams in behind the form.
const AuthHouse = lazy(() => import('./AuthHouse'));
import { Logo } from '../ui';

const ERRORS: Record<string, string> = {
  not_allowed: 'That Google account isn’t allowed into this studio.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'The sign-in took too long or was opened in another tab. Try again.',
  google: 'Google couldn’t confirm the sign-in. Try again.',
  not_configured: 'Google sign-in isn’t set up on this server yet.',
};

/** On this computer (localhost with a local sign-in set up), sign in without Google. */
function LocalSignIn() {
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
    fetch('/api/auth/local')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.ok && setEmail(j.email))
      .catch(() => {});
  }, []);
  if (!email) return null;
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await fetch('/api/auth/local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
        if (r?.ok) window.location.href = '/';
        else setBusy(false);
      }}
      className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-ctl border border-dashed border-line-strong text-[14px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-50"
    >
      {busy ? 'Signing in…' : `Sign in as ${email} · this computer`}
    </button>
  );
}

export function AuthScreen() {
  const error = new URLSearchParams(window.location.search).get('error');
  return (
    <div className="grid min-h-screen-safe lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <Logo />
        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm py-12 animate-fade-up">
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Sign in to your studio</h1>
            <p className="mt-2 text-[15px] text-ink-2">Design, document and cost buildings in one place.</p>

            {error && (
              <p className="mt-6 rounded-ctl bg-danger/10 px-3.5 py-2.5 text-sm text-danger" role="alert">
                {ERRORS[error] ?? 'Sign-in failed. Try again.'}
              </p>
            )}

            <a
              href="/api/auth/google"
              className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-ctl border border-line bg-surface text-[15px] font-medium text-ink shadow-card transition-colors hover:border-line-strong hover:bg-raised"
            >
              <GoogleMark />
              Continue with Google
            </a>
            <LocalSignIn />
            <p className="mt-6 text-center text-[13px] text-ink-3">Access is by invitation only.</p>
          </div>
        </div>
        <p className="text-2xs text-ink-3">© {new Date().getFullYear()} Maavadiyaa</p>
      </div>

      <AuthArt />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** A quiet drawn floor plan — the product in one picture. */
function AuthArt() {
  return (
    <div className="relative hidden overflow-hidden border-l border-line bg-raised lg:flex lg:flex-col lg:justify-end">
      <Suspense fallback={null}>
        <AuthHouse />
      </Suspense>

      <p className="pointer-events-none absolute right-6 top-6 rounded-full bg-surface/80 px-3 py-1 text-2xs text-ink-3 backdrop-blur">Drag to turn · scroll to zoom</p>
      <div className="pointer-events-none relative m-10 max-w-md rounded-card border border-line bg-surface/90 p-5 shadow-float backdrop-blur">
        <div className="flex items-center gap-2 text-[13px] font-medium text-accent">
          <Sparkles className="h-4 w-4" /> AI Architect
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-ink">
          “Three-bedroom tropical house, 14 × 11 m, cinder block, hip roof and a 6 kW solar system.”
        </p>
        <p className="mt-2 text-[13px] text-ink-3">Plans, elevations, MEP and a priced BOQ — drafted in seconds.</p>
      </div>
    </div>
  );
}
