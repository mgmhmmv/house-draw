import type { ReactNode } from 'react';
import { FolderKanban, LayoutTemplate, LogOut, Moon, Plus, Settings, Sun, Users } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/hooks';
import { Link, useRouter } from '../lib/router';
import { Avatar, cx, Logo, Menu, MenuItem } from '../ui';

const NAV = [
  { to: '/', label: 'Projects', icon: FolderKanban },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/clients', label: 'Clients', icon: Users, soon: true },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** The frame around every page except the drawing workspace. */
export function AppShell({ children, onNewProject }: { children: ReactNode; onNewProject: () => void }) {
  const { path } = useRouter();

  return (
    <div className="flex min-h-screen-safe">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen-safe w-[248px] shrink-0 flex-col border-r border-line bg-raised px-3 py-5 lg:flex">
        <div className="px-3">
          <Logo />
        </div>
        <button
          onClick={onNewProject}
          className="mx-1 mt-7 flex h-10 items-center gap-2 rounded-ctl bg-ink px-3.5 text-sm font-medium text-page transition-colors hover:bg-ink/85"
        >
          <Plus className="h-4 w-4" /> New project
        </button>
        <nav className="mt-6 space-y-0.5">
          {NAV.map((n) => {
            const active = n.to === '/' ? path === '/' : path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cx(
                  'flex h-9 items-center gap-3 rounded-ctl px-3 text-sm transition-colors',
                  active ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-2 hover:bg-sunken/70 hover:text-ink'
                )}
              >
                <n.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                {n.label}
                {n.soon && <span className="ml-auto rounded-full bg-sunken px-2 py-px text-2xs text-ink-3">Soon</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto">
          <AccountMenu placement="sidebar" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-page/90 px-4 backdrop-blur lg:hidden">
          <Logo size={26} />
          <AccountMenu placement="topbar" />
        </header>
        <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      </div>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-safe backdrop-blur lg:hidden">
        <div className="mx-auto flex h-16 max-w-md items-center justify-around px-2">
          {NAV.filter((n) => !n.soon).slice(0, 2).map((n) => (
            <TabLink key={n.to} to={n.to} label={n.label} icon={n.icon} active={n.to === '/' ? path === '/' : path.startsWith(n.to)} />
          ))}
          <button onClick={onNewProject} aria-label="New project" className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-page shadow-float">
            <Plus className="h-5 w-5" />
          </button>
          <TabLink to="/clients" label="Clients" icon={Users} active={path.startsWith('/clients')} />
          <TabLink to="/settings" label="Settings" icon={Settings} active={path.startsWith('/settings')} />
        </div>
      </nav>
    </div>
  );
}

function TabLink({ to, label, icon: Icon, active }: { to: string; label: string; icon: typeof Plus; active: boolean }) {
  return (
    <Link to={to} className={cx('flex w-16 flex-col items-center gap-1 text-2xs font-medium', active ? 'text-ink' : 'text-ink-3')}>
      <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2 : 1.75} />
      {label}
    </Link>
  );
}

function AccountMenu({ placement }: { placement: 'sidebar' | 'topbar' }) {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useTheme();
  const { navigate } = useRouter();
  if (!user) return null;
  return (
    <Menu
      align={placement === 'sidebar' ? 'start' : 'end'}
      side={placement === 'sidebar' ? 'top' : 'bottom'}
      trigger={(p) =>
        placement === 'sidebar' ? (
          <button {...p} className="flex w-full items-center gap-3 rounded-ctl px-2 py-2 text-left hover:bg-sunken/70">
            <Avatar name={user.name} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-2xs text-ink-3">{user.email}</span>
            </span>
          </button>
        ) : (
          <button {...p} aria-label="Account">
            <Avatar name={user.name} size={32} />
          </button>
        )
      }
    >
      {(close) => (
        <div>
          <MenuItem
            icon={theme === 'dark' ? <Sun /> : <Moon />}
            onClick={() => {
              setTheme(theme === 'dark' ? 'light' : 'dark');
              close();
            }}
          >
            {theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
          </MenuItem>
          <MenuItem
            icon={<LogOut />}
            onClick={async () => {
              close();
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            Sign out
          </MenuItem>
        </div>
      )}
    </Menu>
  );
}
