import type { BuildingProject } from '../../model/types';

export interface User {
  id: string;
  email: string;
  name: string;
}

export type ProjectStatus = 'concept' | 'design' | 'documentation' | 'construction' | 'complete' | 'archived';

export interface ProjectSummary {
  area?: number;
  levels?: number;
  rooms?: number;
  bedrooms?: number;
  width?: number;
  depth?: number;
  roof?: string;
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
}

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
  saveModel: (id: string, b: { model: BuildingProject; summary: ProjectSummary; baseVersion: number }) =>
    request<{ version: number; updatedAt: number }>('PUT', `/api/projects/${id}/model`, b),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', `/api/projects/${id}`),
};
