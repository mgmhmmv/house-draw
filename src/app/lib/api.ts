import type { BuildingProject } from '../../model/types';

export interface User {
  id: string;
  email: string;
  name: string;
}

/** Design-studio stages. 'done' = handed over and paid. */
export type ProjectStatus = 'brief' | 'concept' | 'design' | 'drawings' | 'review' | 'handover' | 'done' | 'archived';

/** The working stages, in order (archived sits outside the flow). */
export const STAGES: ProjectStatus[] = ['brief', 'concept', 'design', 'drawings', 'review', 'handover', 'done'];

export interface ProjectSummary {
  area?: number;
  levels?: number;
  rooms?: number;
  bedrooms?: number;
  width?: number;
  depth?: number;
  roof?: string;
}

export type VersionSource = 'edit' | 'ai' | 'restore' | 'create' | 'import';

/** One saved state of a project; any of them can be restored. */
export interface ProjectVersion {
  version: number;
  createdAt: number;
  source: VersionSource;
  label: string;
  summary: ProjectSummary;
  size: number;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  location: string;
  status: ProjectStatus;
  template: string;
  summary: ProjectSummary;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** When the 3D cover render was last updated, or null if there is none yet. */
  coverAt: number | null;
  /** Token of the public 3D view link (/v/<token>); every project has one. */
  shareToken?: string | null;
}

/** The public 3D view link for a project. */
export const shareUrl = (token: string) => `${location.origin}/v/${token}`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new ApiError(resp.status, data.error || 'error', data.message || 'Something went wrong. Try again.');
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>('GET', '/api/auth/me'),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  logoutAll: () => request<{ ok: true }>('POST', '/api/auth/logout-all'),

  listProjects: () => request<{ projects: Project[] }>('GET', '/api/projects'),
  createProject: (b: { name: string; client: string; location: string; template: string; summary: ProjectSummary; model: BuildingProject }) =>
    request<{ project: Project }>('POST', '/api/projects', b),
  getProject: (id: string) => request<{ project: Project; model: BuildingProject | null }>('GET', `/api/projects/${id}`),
  updateProject: (id: string, b: Partial<Pick<Project, 'name' | 'client' | 'location' | 'status'>>) =>
    request<{ project: Project }>('PATCH', `/api/projects/${id}`, b),
  saveModel: (id: string, b: { model: BuildingProject; summary: ProjectSummary; baseVersion?: number; source?: VersionSource; label?: string }) =>
    request<{ version: number; updatedAt: number }>('PUT', `/api/projects/${id}/model`, b),
  versions: (id: string, before?: number) =>
    request<{ current: number; versions: ProjectVersion[] }>('GET', `/api/projects/${id}/versions${before ? `?before=${before}` : ''}`),
  versionModel: (id: string, v: number) => request<BuildingProject>('GET', `/api/projects/${id}/versions/${v}`),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', `/api/projects/${id}`),
  /** A new public 3D link; the old one stops working. */
  rotateShare: (id: string) => request<{ project: Project }>('POST', `/api/projects/${id}/share`),
};
