import { ensureFreshToken, getToken, logout } from './auth';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const API_PREFIX = '/api/v1';

export class ForbiddenError extends Error {
  constructor() {
    super('You do not have permission to perform this action.');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends Error {
  constructor(message = 'Resource was modified by another user.') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends Error {
  fieldErrors: Record<string, string>;
  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Resource not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

interface ValidationDetail {
  loc: (string | number)[];
  msg: string;
  type: string;
}

function parseFieldErrors(detail: unknown): Record<string, string> | null {
  if (!Array.isArray(detail)) return null;
  const errors: Record<string, string> = {};
  for (const item of detail as ValidationDetail[]) {
    if (item.loc && item.msg) {
      const fieldName = String(item.loc[item.loc.length - 1]);
      errors[fieldName] = item.msg;
    }
  }
  return Object.keys(errors).length ? errors : null;
}

async function doFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  return fetch(`${BASE}${API_PREFIX}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await ensureFreshToken();
  let res = await doFetch(path, init);

  if (res.status === 401) {
    await ensureFreshToken();
    if (!getToken()) {
      logout();
      throw new Error('Session expired');
    }
    res = await doFetch(path, init);
  }

  if (res.status === 204) return undefined as T;

  if (res.status === 403) throw new ForbiddenError();

  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    throw new NotFoundError(body.detail || 'Resource not found');
  }

  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    throw new ConflictError(body.detail || 'Resource conflict');
  }

  if (res.status === 422 || res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (body.field_errors && typeof body.field_errors === 'object') {
      throw new ValidationError(
        body.detail || 'Validation failed',
        body.field_errors,
      );
    }
    const fieldErrs = parseFieldErrors(body.detail);
    if (fieldErrs) {
      throw new ValidationError('Validation failed', fieldErrs);
    }
    throw new Error(
      typeof body.detail === 'string' ? body.detail : res.statusText,
    );
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const seconds = retryAfter ? parseInt(retryAfter, 10) : 30;
    throw new Error(`Too many requests. Please try again in ${seconds}s.`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || res.statusText);
  }

  return res.json();
}

export interface PaginatedResponse<T = Record<string, unknown>> {
  data: T[];
  pagination: {
    current_page: number;
    page_size: number;
    total_pages: number;
    total_records: number;
  };
}

export interface ListParams {
  page?: number;
  page_size?: number;
  order_by?: string[];
  search?: string;
  expand?: string;
  [key: string]: unknown;
}

export const api = {
  raw<T = unknown>(path: string, init?: RequestInit) {
    return request<T>(path, init);
  },

  list<T = Record<string, unknown>>(prefix: string, params: ListParams = {}) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v)) v.forEach((i) => sp.append(k, String(i)));
      else sp.set(k, String(v));
    });
    const qs = sp.toString();
    return request<PaginatedResponse<T>>(`${prefix}/${qs ? `?${qs}` : ''}`);
  },

  get<T = Record<string, unknown>>(prefix: string, id: string | number) {
    return request<T>(`${prefix}/${id}`);
  },

  create<T = Record<string, unknown>>(prefix: string, data: Partial<T>) {
    return request<T>(`${prefix}/`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update<T = Record<string, unknown>>(
    prefix: string,
    id: string | number,
    data: Partial<T>,
  ) {
    return request<T>(`${prefix}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  delete(prefix: string, id: string | number) {
    return request<void>(`${prefix}/${id}`, { method: 'DELETE' });
  },

  bulkCreate<T = Record<string, unknown>>(prefix: string, items: Partial<T>[]) {
    return request<{ data: T[]; count: number }>(`${prefix}/bulk`, {
      method: 'POST',
      body: JSON.stringify(items),
    });
  },

  bulkDelete(prefix: string, ids: (string | number)[]) {
    return request<void>(`${prefix}/bulk`, {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
  },
};
