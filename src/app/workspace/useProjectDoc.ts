import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuildingProject } from '../../model/types';
import { api, ApiError, type Project, type VersionSource } from '../lib/api';
import { describeChange } from './describeChange';
import { summarize } from '../lib/templates';
import { updateCover } from '../drawing/three/cover';

const COVER_EVERY_MS = 45_000;

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

const HISTORY_LIMIT = 60;
const AUTOSAVE_MS = 1200;

/** How a change is recorded in the project history. */
export interface CommitOptions {
  /** History label; otherwise one is worked out from what changed. */
  label?: string;
  source?: VersionSource;
  /** Save straight away instead of after the autosave pause (AI changes, restores). */
  saveNow?: boolean;
}

/**
 * One open project: the model, its undo history, and autosave to the Worker.
 * Saves carry the version they were based on, so two tabs cannot silently overwrite each other.
 * Every save becomes a restorable version on the server.
 */
export function useProjectDoc(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [model, setModel] = useState<BuildingProject | null>(null);
  // Undo stacks live in refs: updating them must not run twice under StrictMode.
  const pastRef = useRef<BuildingProject[]>([]);
  const futureRef = useRef<BuildingProject[]>([]);
  const [, setHistoryTick] = useState(0);
  const bump = () => setHistoryTick((t) => t + 1);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState<string | null>(null);

  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const modelRef = useRef<BuildingProject | null>(null);
  const timerRef = useRef<number>();
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  const coverAtRef = useRef(0);
  const coverTimer = useRef<number>();
  /** The model as last saved, to describe what the next save changes. */
  const savedRef = useRef<BuildingProject | null>(null);
  /** Labels and source of the changes waiting to be saved. */
  const pendingRef = useRef<{ labels: string[]; source: VersionSource }>({ labels: [], source: 'edit' });

  useEffect(() => {
    let cancelled = false;
    setProject(null);
    setModel(null);
    setLoadError(null);
    api
      .getProject(projectId)
      .then(({ project, model }) => {
        if (cancelled) return;
        if (!model) throw new ApiError(404, 'model_missing', 'This project’s drawing could not be found.');
        versionRef.current = project.version;
        modelRef.current = model;
        savedRef.current = model;
        pendingRef.current = { labels: [], source: 'edit' };
        setProject(project);
        setModel(model);
        coverAtRef.current = project.coverAt ?? 0;
        // Make or refresh the card render if there is none, or it predates the last edit.
        if (!project.coverAt || project.coverAt < project.updatedAt)
          window.setTimeout(() => updateCover(projectId, model).then((t) => t && setProject((p) => (p ? { ...p, coverAt: t } : p))).catch(() => {}), 1500);
        pastRef.current = [];
        futureRef.current = [];
        setSaveState('saved');
      })
      .catch((e) => !cancelled && setLoadError(e instanceof ApiError ? e.message : 'Could not open this project.'));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /** Refresh the card render after edits, at most every 45 s, when the browser is idle. */
  const scheduleCover = useCallback(() => {
    window.clearTimeout(coverTimer.current);
    const wait = Math.max(3_000, coverAtRef.current + COVER_EVERY_MS - Date.now());
    coverTimer.current = window.setTimeout(() => {
      const m = modelRef.current;
      if (!m) return;
      coverAtRef.current = Date.now();
      updateCover(projectId, m)
        .then((t) => t && setProject((p) => (p ? { ...p, coverAt: t } : p)))
        .catch(() => {});
    }, wait);
  }, [projectId]);

  /**
   * Save the current model. Resolves true once it is stored. `force` skips the version check:
   * safe because the other tab's save stays in the history.
   */
  const save = useCallback(async (force = false): Promise<boolean> => {
    if (savingRef.current || !dirtyRef.current || !modelRef.current) return !dirtyRef.current && !savingRef.current;
    savingRef.current = true;
    dirtyRef.current = false;
    setSaveState('saving');
    const snapshot = modelRef.current;
    const pending = pendingRef.current;
    pendingRef.current = { labels: [], source: 'edit' };
    const labels = [...new Set(pending.labels)];
    const label = labels.length ? labels.join(' · ').slice(0, 200) : describeChange(savedRef.current, snapshot);
    try {
      const r = await api.saveModel(projectId, { model: snapshot, summary: summarize(snapshot), baseVersion: force ? undefined : versionRef.current, source: pending.source, label });
      versionRef.current = r.version;
      savedRef.current = snapshot;
      conflictRef.current = false;
      setProject((p) => (p ? { ...p, version: r.version, updatedAt: r.updatedAt, summary: summarize(snapshot) } : p));
      setSaveState(dirtyRef.current ? 'unsaved' : 'saved');
      scheduleCover();
      return true;
    } catch (e) {
      // A deleted or inaccessible project will never accept the save: stop retrying.
      const gone = e instanceof ApiError && (e.status === 404 || e.status === 401);
      dirtyRef.current = !gone;
      // Keep the labels for the retry, ahead of anything changed since.
      pendingRef.current = {
        labels: [...pending.labels, ...pendingRef.current.labels],
        source: pendingRef.current.source !== 'edit' ? pendingRef.current.source : pending.source,
      };
      conflictRef.current = e instanceof ApiError && e.code === 'version_conflict';
      setSaveState(conflictRef.current ? 'conflict' : 'error');
      return false;
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) {
        window.clearTimeout(timerRef.current);
        // A conflict needs the user's choice; anything else retries.
        if (!conflictRef.current) timerRef.current = window.setTimeout(() => save(), AUTOSAVE_MS * 2);
      }
    }
  }, [projectId]);

  const schedule = useCallback(() => {
    dirtyRef.current = true;
    setSaveState((s) => (s === 'conflict' ? s : 'unsaved'));
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => save(), AUTOSAVE_MS);
  }, [save]);

  const apply = useCallback(
    (next: BuildingProject, opts?: CommitOptions) => {
      modelRef.current = next;
      setModel(next);
      if (opts?.label) pendingRef.current.labels.push(opts.label);
      if (opts?.source && opts.source !== 'edit') pendingRef.current.source = opts.source;
      schedule();
      if (opts?.saveNow) {
        window.clearTimeout(timerRef.current);
        return save();
      }
      return Promise.resolve(true);
    },
    [schedule, save]
  );

  /** Record a change. Every edit goes through here so it can be undone, saved and restored. */
  const commit = useCallback(
    (next: BuildingProject, opts?: CommitOptions) => {
      const prev = modelRef.current;
      if (prev) pastRef.current = [...pastRef.current.slice(-HISTORY_LIMIT + 1), prev];
      futureRef.current = [];
      bump();
      return apply(next, opts);
    },
    [apply]
  );

  /** Bring back any saved version. It is saved as a new version, so the restore can be undone too. */
  const restore = useCallback(
    async (version: number) => {
      const m = await api.versionModel(projectId, version);
      const ok = await commit(m, { label: `Restored version ${version}`, source: 'restore', saveNow: true });
      if (!ok) throw new Error('not_saved');
    },
    [projectId, commit]
  );

  const undo = useCallback(() => {
    const prev = pastRef.current[pastRef.current.length - 1];
    if (!prev || !modelRef.current) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [modelRef.current, ...futureRef.current];
    bump();
    apply(prev);
  }, [apply]);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next || !modelRef.current) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, modelRef.current];
    bump();
    apply(next);
  }, [apply]);

  // Save on leave; warn if a save is still pending.
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current) {
        save();
        e.preventDefault();
      }
    };
    const onHide = () => document.visibilityState === 'hidden' && save();
    window.addEventListener('beforeunload', onBefore);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onBefore);
      document.removeEventListener('visibilitychange', onHide);
      window.clearTimeout(timerRef.current);
      window.clearTimeout(coverTimer.current);
      save();
    };
  }, [save]);

  const updateMeta = useCallback(
    async (patch: Partial<Pick<Project, 'name' | 'client' | 'location' | 'status'>>) => {
      const { project: next } = await api.updateProject(projectId, patch);
      setProject(next);
      // Keep the title block in step with the project record.
      if (modelRef.current && (patch.name !== undefined || patch.client !== undefined || patch.location !== undefined)) {
        const m = modelRef.current;
        apply({
          ...m,
          meta: {
            ...m.meta,
            title: patch.name ?? m.meta.title,
            client: patch.client ?? m.meta.client,
            location: patch.location ?? m.meta.location,
          },
        });
      }
    },
    [projectId, apply]
  );

  return {
    project,
    model,
    loadError,
    saveState,
    commit,
    undo,
    redo,
    restore,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    saveNow: () => save(),
    /** After a conflict: save this tab's design over the other one (which stays in History). */
    keepMine: () => {
      dirtyRef.current = true;
      return save(true);
    },
    updateMeta,
  };
}
