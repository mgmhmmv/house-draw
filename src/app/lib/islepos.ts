/** Client for the IslePOS connection. Every call goes through the Worker, which holds the key. */
import { ApiError } from './api';

export interface IsleCustomer {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  address: string | null;
  tin: string | null;
  notes: string | null;
  existing?: boolean;
  created_at?: string;
  updated_at?: string;
  /** Any further fields IslePOS returns (island, atoll, balance…) are shown as they come. */
  [extra: string]: unknown;
}

export interface IsleLine {
  sku?: string | null;
  name: string | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  total?: number;
}

export type QuoteStatus = 'draft' | 'quoted' | 'accepted' | 'rejected' | 'converted' | 'cancelled';
export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export interface IsleDoc {
  id: string;
  number: string;
  kind: 'quote' | 'invoice';
  status: QuoteStatus | InvoiceStatus;
  customer: { id: string; name: string; mobile: string | null; email: string | null };
  items: IsleLine[];
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  currency: string;
  issue_date: string;
  valid_until?: string;
  due_date?: string;
  notes: string | null;
  payments?: { amount: number; method: string; reference: string | null; paid_at: string; reversed: boolean }[];
}

export interface IsleProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  description: string | null;
}

export interface Connection {
  connected: boolean;
  env?: 'staging' | 'production';
  key_hint?: string;
  business_id?: string | null;
  connected_at?: number;
  permissions?: string[];
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ApiError(resp.status, data.error || 'error', data.message || data.error || 'IslePOS request failed.');
  return data as T;
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const islepos = {
  connection: () => req<Connection>('GET', '/api/integrations/islepos'),
  connect: (key: string, env: 'staging' | 'production', businessId?: string) => req<Connection>('PUT', '/api/integrations/islepos', { key, env, businessId }),
  disconnect: () => req<Connection>('DELETE', '/api/integrations/islepos'),

  products: (search = '') => req<{ data: IsleProduct[] }>('GET', `/api/islepos/products${q({ search, limit: 50 })}`),
  customers: (search = '', offset = 0, limit = 100) => req<{ data: IsleCustomer[]; total: number }>('GET', `/api/islepos/customers${q({ search, limit, offset })}`),
  customer: (id: string) => req<IsleCustomer>('GET', `/api/islepos/customers/${id}`),
  createCustomer: (c: { name: string; mobile?: string; email?: string; address?: string; tin?: string; notes?: string }) => req<IsleCustomer>('POST', '/api/islepos/customers', c),
  updateCustomer: (id: string, c: Partial<IsleCustomer>) => req<IsleCustomer>('PATCH', `/api/islepos/customers/${id}`, c),

  doc: (kind: 'quote' | 'invoice', id: string) => req<IsleDoc>('GET', `/api/islepos/${kind}s/${id}`),
  createQuote: (b: { customer_id: string; items: IsleLine[]; discount?: number; notes?: string; terms?: string; valid_days?: number }) =>
    req<IsleDoc>('POST', '/api/islepos/quotes', b),
  deleteDoc: (kind: 'quote' | 'invoice', id: string) => req<unknown>('DELETE', `/api/islepos/${kind}s/${id}`),
  action: (kind: 'quote' | 'invoice', id: string, action: string, body?: unknown) => req<IsleDoc>('POST', `/api/islepos/${kind}s/${id}/${action}`, body ?? {}),
};

export interface ProjectBilling {
  customerId: string | null;
  documents: { id: string; kind: 'quote' | 'invoice'; islepos_id: string; number: string; status: string; total: number; balance_due: number | null; created_at: number }[];
}

export const billing = {
  get: (projectId: string) => req<ProjectBilling>('GET', `/api/projects/${projectId}/billing`),
  setCustomer: (projectId: string, customerId: string | null) => req<ProjectBilling>('PUT', `/api/projects/${projectId}/billing`, { customerId }),
  record: (projectId: string, d: IsleDoc) =>
    req<ProjectBilling>('PUT', `/api/projects/${projectId}/billing`, {
      document: { kind: d.kind, islepos_id: d.id, number: d.number, status: d.status, total: d.total, balance_due: d.kind === 'invoice' ? d.balance_due : null },
    }),
};

export const mvr = (n: number) => `MVR ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
