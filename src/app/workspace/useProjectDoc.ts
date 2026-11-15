import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuildingProject } from '../../model/types';
import { api, ApiError, type Project } from '../lib/api';
import { summarize } from '../lib/templates';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

const HISTORY_LIMIT = 60;
const AUTOSAVE_MS = 1200;

/**
 * One open project: the model, its undo history, and autosave to the Worker.
 * Saves carry the version they were based on, so two tabs cannot silently overwrite each other.
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
        setProject(project);
        setModel(model);
        pastRef.current = [];
        futureRef.current = [];
        setSaveState('saved');
      })
      .catch((e) => !cancelled && setLoadError(e instanceof ApiError ? e.message : 'Could not open this project.'));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const save = useCallback(async () => {
    if (savingRef.current || !dirtyRef.current || !modelRef.current) return;
    savingRef.current = true;
    dirtyRef.current = false;
    setSaveState('saving');
    const snapshot = modelRef.current;
    try {
      const r = await api.saveModel(projectId, { model: snapshot, summary: summarize(snapshot), baseVersion: versionRef.current });
      versionRef.current = r.version;
      setProject((p) => (p ? { ...p, version: r.version, updatedAt: r.updatedAt, summary: summarize(snapshot) } : p));
      setSaveState(dirtyRef.current ? 'unsaved' : 'saved');
    } catch (e) {
      dirtyRef.current = true;
      setSaveState(e instanceof ApiError && e.code === 'version_conflict' ? 'conflict' : 'error');
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(save, AUTOSAVE_MS * 2);
      }
    }
  }, [projectId]);

  const schedule = useCallback(() => {
    dirtyRef.current = true;
    setSaveState((s) => (s === 'conflict' ? s : 'unsaved'));
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(save, AUTOSAVE_MS);
  }, [save]);

  const apply = useCallback(
    (next: BuildingProject) => {
      modelRef.current = next;
      setModel(next);
      schedule();
    },
    [schedule]
  );

  /** Record a change. Every edit goes through here so it can be undone and saved. */
  const commit = useCallback(
    (next: BuildingProject) => {
      const prev = modelRef.current;
      if (prev) pastRef.current = [...pastRef.current.slice(-HISTORY_LIMIT + 1), prev];
      futureRef.current = [];
      bump();
      apply(next);
    },
    [apply]
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
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    saveNow: save,
    updateMeta,
  };
}
