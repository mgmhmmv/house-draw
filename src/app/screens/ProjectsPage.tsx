import { useEffect, useMemo, useState } from 'react';
import { Archive, Building2, LayoutGrid, List, MapPin, MoreHorizontal, Plus, Search, Trash2, User as UserIcon } from 'lucide-react';
import { api, type Project, type ProjectStatus } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/hooks';
import { Link } from '../lib/router';
import { Button, cx, Dialog, IconButton, Input, Menu, MenuItem, Spinner, STATUS_META, StatusPill, toast } from '../ui';
import { PlanGlyph } from './PlanGlyph';

type Filter = 'active' | ProjectStatus | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'concept', label: 'Concept' },
  { id: 'design', label: 'Design' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'construction', label: 'Construction' },
  { id: 'complete', label: 'Complete' },
  { id: 'archived', label: 'Archived' },
];

export function ProjectsPage({ onNewProject }: { onNewProject: () => void }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('as_projects_view') as 'grid' | 'list') || 'grid');
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));
  }, []);

  const setViewSaved = (v: 'grid' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('as_projects_view', v);
    } catch {
      /* ignore */
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { active: 0 };
    for (const p of projects ?? []) {
      c[p.status] = (c[p.status] ?? 0) + 1;
      if (p.status !== 'archived' && p.status !== 'complete') c.active++;
    }
    return c;
  }, [projects]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects ?? []).filter((p) => {
      if (filter === 'active' && (p.status === 'archived' || p.status === 'complete')) return false;
      if (filter !== 'active' && filter !== 'all' && p.status !== filter) return false;
      return !q || `${p.name} ${p.client} ${p.location}`.toLowerCase().includes(q);
    });
  }, [projects, filter, query]);

  const setStatus = async (p: Project, status: ProjectStatus) => {
    const { project } = await api.updateProject(p.id, { status });
    setProjects((ps) => ps?.map((x) => (x.id === p.id ? project : x)) ?? null);
    toast(`Moved to ${STATUS_META[status].label}`);
  };

  const remove = async (p: Project) => {
    await api.deleteProject(p.id);
    setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
    setConfirmDelete(null);
    toast('Project deleted');
  };

  const firstName = user?.name.split(' ')[0];
  const totalArea = (projects ?? []).filter((p) => p.status !== 'archived').reduce((s, p) => s + (p.summary.area ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-3">{greeting()}{firstName ? `, ${firstName}` : ''}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight sm:text-[32px]">Projects</h1>
        </div>
        <div className="hidden lg:block">
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onNewProject}>
            New project
          </Button>
        </div>
      </div>

      {projects && projects.length > 0 && (
        <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-xl">
          <Stat label="Active" value={String(counts.active)} />
          <Stat label="On site"value={String(counts.construction ?? 0)} />
          <Stat label="Floor area" value={`${Math.round(totalArea).toLocaleString()} m²`} />
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects, clients, sites" className="pl-10" />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:px-0">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cx(
                'h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors',
                filter === f.id ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken'
              )}
            >
              {f.label}
              {counts[f.id] ? <span className={cx('ml-1.5', filter === f.id ? 'text-page/60' : 'text-ink-3')}>{counts[f.id]}</span> : null}
            </button>
          ))}
        </div>
        <div className="ml-auto hidden gap-1 sm:flex">
          <IconButton label="Grid view" size="sm" active={view === 'grid'} onClick={() => setViewSaved('grid')}>
            <LayoutGrid className="h-4 w-4" />
          </IconButton>
          <IconButton label="List view" size="sm" active={view === 'list'} onClick={() => setViewSaved('list')}>
            <List className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="mt-6">
        {projects === null ? (
          <div className="flex justify-center py-24">
            <Spinner />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onNewProject={onNewProject} />
        ) : visible.length === 0 ? (
          <p className="py-20 text-center text-sm text-ink-3">No projects match.</p>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => (
              <ProjectCard key={p.id} p={p} onStatus={setStatus} onDelete={setConfirmDelete} />
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {visible.map((p) => (
              <ProjectRow key={p.id} p={p} onStatus={setStatus} onDelete={setConfirmDelete} />
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete project?"
        description={confirmDelete ? `“${confirmDelete.name}” and all its drawings and files will be permanently deleted. This cannot be undone.` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => confirmDelete && remove(confirmDelete)}>
              Delete project
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <div className="text-2xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}

function facts(p: Project) {
  const s = p.summary;
  const out: string[] = [];
  if (s.area) out.push(`${Math.round(s.area)} m²`);
  if (s.bedrooms) out.push(`${s.bedrooms} bed`);
  if (s.levels) out.push(`${s.levels} ${s.levels === 1 ? 'level' : 'levels'}`);
  return out;
}

type RowProps = { p: Project; onStatus: (p: Project, s: ProjectStatus) => void; onDelete: (p: Project) => void };

function ProjectMenu({ p, onStatus, onDelete }: RowProps) {
  return (
    <Menu
      trigger={(t) => (
        <IconButton
          label="Project actions"
          size="sm"
          {...t}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            t.onClick();
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </IconButton>
      )}
    >
      {(close) => (
        <div onClick={(e) => e.stopPropagation()}>
          <p className="px-2.5 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-ink-3">Stage</p>
          {(['concept', 'design', 'documentation', 'construction', 'complete'] as ProjectStatus[]).map((s) => (
            <MenuItem
              key={s}
              icon={<span className={cx('ml-1 block h-2 w-2 rounded-full', STATUS_META[s].dot)} />}
              onClick={() => {
                close();
                onStatus(p, s);
              }}
            >
              {STATUS_META[s].label}
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem
            icon={<Archive />}
            onClick={() => {
              close();
              onStatus(p, p.status === 'archived' ? 'concept' : 'archived');
            }}
          >
            {p.status === 'archived' ? 'Restore' : 'Archive'}
          </MenuItem>
          <MenuItem
            icon={<Trash2 />}
            danger
            onClick={() => {
              close();
              onDelete(p);
            }}
          >
            Delete…
          </MenuItem>
        </div>
      )}
    </Menu>
  );
}

function ProjectCard(props: RowProps) {
  const { p } = props;
  return (
    <Link
      to={`/p/${p.id}`}
      className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float"
    >
      <div className="relative h-44 bg-raised bg-blueprint px-10 py-6">
        <PlanGlyph seed={p.id} rooms={p.summary.rooms} levels={p.summary.levels} />
        <div className="absolute left-3 top-3">
          <StatusPill status={p.status} />
        </div>
        <div className="absolute right-2 top-2 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
          <ProjectMenu {...props} />
        </div>
      </div>
      <div className="flex flex-1 flex-col border-t border-line p-4">
        <h3 className="truncate text-[15px] font-semibold tracking-tight">{p.name}</h3>
        <div className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-2">
          {p.client && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserIcon className="h-3.5 w-3.5 text-ink-3" />
              <span className="truncate">{p.client}</span>
            </span>
          )}
          {p.location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-ink-3" />
              <span className="truncate">{p.location}</span>
            </span>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between pt-4 text-2xs text-ink-3">
          <span className="font-mono">{facts(p).join(' · ') || 'Empty site'}</span>
          <span>Edited {timeAgo(p.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function ProjectRow(props: RowProps) {
  const { p } = props;
  return (
    <Link to={`/p/${p.id}`} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0 hover:bg-raised">
      <div className="h-11 w-14 shrink-0 rounded-[8px] bg-raised p-1">
        <PlanGlyph seed={p.id} rooms={p.summary.rooms} levels={p.summary.levels} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{p.name}</div>
        <div className="truncate text-[13px] text-ink-3">{[p.client, p.location].filter(Boolean).join(' · ') || '—'}</div>
      </div>
      <span className="hidden w-40 font-mono text-2xs text-ink-3 md:block">{facts(p).join(' · ')}</span>
      <span className="hidden w-32 sm:block">
        <StatusPill status={p.status} />
      </span>
      <span className="hidden w-24 text-right text-2xs text-ink-3 sm:block">{timeAgo(p.updatedAt)}</span>
      <ProjectMenu {...props} />
    </Link>
  );
}

function EmptyState({ onNewProject }: { onNewProject: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong bg-surface/50 px-6 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Building2 className="h-6 w-6" />
      </div>
      <h2 className="mt-5 text-lg font-semibold tracking-tight">Start your first project</h2>
      <p className="mt-2 max-w-sm text-sm text-ink-2">
        Pick a template or a blank site, then draw it yourself or describe it to the AI Architect.
      </p>
      <Button variant="primary" className="mt-6" icon={<Plus className="h-4 w-4" />} onClick={onNewProject}>
        New project
      </Button>
    </div>
  );
}
