import { useState, type FormEvent } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Link, useRouter } from '../lib/router';
import { Button, Field, Input, Logo } from '../ui';

export function AuthScreen({ mode }: { mode: 'login' | 'signup' }) {
  const { setUser } = useAuth();
  const { navigate } = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isSignup = mode === 'signup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = isSignup ? await api.signup({ name, email, password }) : await api.login({ email, password });
      setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach ArchStudio. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen-safe lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <Logo />
        <div className="flex flex-1 items-center">
          <form onSubmit={submit} className="mx-auto w-full max-w-sm py-12 animate-fade-up">
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
              {isSignup ? 'Create your studio' : 'Welcome back'}
            </h1>
            <p className="mt-2 text-[15px] text-ink-2">
              {isSignup ? 'Design, document and cost buildings in one place.' : 'Sign in to pick up where you left off.'}
            </p>

            <div className="mt-8 space-y-4">
              {isSignup && (
                <Field label="Your name">
                  <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
                </Field>
              )}
              <Field label="Email">
                <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!isSignup} />
              </Field>
              <Field label="Password" hint={isSignup ? 'At least 8 characters.' : undefined}>
                <Input
                  type="password"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={isSignup ? 8 : undefined}
                  required
                />
              </Field>
            </div>

            {error && <p className="mt-4 rounded-ctl bg-danger/10 px-3.5 py-2.5 text-sm text-danger" role="alert">{error}</p>}

            <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-6 w-full">
              {isSignup ? 'Create account' : 'Sign in'}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </Button>

            <p className="mt-6 text-center text-sm text-ink-2">
              {isSignup ? 'Already have an account? ' : 'New to ArchStudio? '}
              <Link to={isSignup ? '/login' : '/signup'} className="font-medium text-accent hover:underline">
                {isSignup ? 'Sign in' : 'Create an account'}
              </Link>
            </p>
          </form>
        </div>
        <p className="text-2xs text-ink-3">© {new Date().getFullYear()} ArchStudio</p>
      </div>

      <AuthArt />
    </div>
  );
}

/** A quiet drawn floor plan — the product in one picture. */
function AuthArt() {
  return (
    <div className="relative hidden overflow-hidden border-l border-line bg-raised bg-blueprint lg:flex lg:flex-col lg:justify-end">
      <svg viewBox="0 0 560 420" className="absolute left-1/2 top-[44%] w-[78%] max-w-[640px] -translate-x-1/2 -translate-y-1/2" aria-hidden>
        <g fill="none" className="stroke-ink" strokeLinejoin="round">
          <rect x="40" y="40" width="480" height="340" strokeWidth="7" />
          <path d="M240 40v130M240 230v150M40 220h140M300 220h220M380 40v180" strokeWidth="4" />
        </g>
        <g className="fill-page">
          <rect x="180" y="215" width="60" height="10" />
          <rect x="240" y="172" width="10" height="56" />
          <rect x="420" y="35" width="70" height="10" />
          <rect x="90" y="375" width="80" height="10" />
        </g>
        <g fill="none" className="stroke-ink-3" strokeWidth="1.2">
          <path d="M180 220a60 60 0 0 1 60-60" strokeDasharray="3 4" />
          <path d="M420 40h70M90 380h80" />
        </g>
        <g fill="rgb(var(--accent) / 0.08)">
          <rect x="44" y="44" width="192" height="172" />
        </g>
        <g className="fill-ink-2" fontFamily="Inter" fontSize="13" fontWeight="500">
          <text x="70" y="130">Living</text>
          <text x="70" y="148" className="fill-ink-3" fontSize="11">24.6 m²</text>
          <text x="280" y="120">Kitchen</text>
          <text x="410" y="120">Bed 1</text>
          <text x="80" y="300">Bed 2</text>
          <text x="330" y="300">Terrace</text>
        </g>
        <g className="stroke-ink-3" strokeWidth="1">
          <path d="M40 18h480M40 12v12M520 12v12" />
        </g>
        <text x="280" y="12" textAnchor="middle" className="fill-ink-3" fontFamily="JetBrains Mono" fontSize="11">14 000</text>
      </svg>

      <div className="relative m-10 max-w-md rounded-card border border-line bg-surface/90 p-5 shadow-float backdrop-blur">
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
