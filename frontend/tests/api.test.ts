import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock auth module before importing api
vi.mock('../src/auth', () => ({
  ensureFreshToken: vi.fn().mockResolvedValue(true),
  getToken: vi.fn().mockReturnValue('test-token'),
  logout: vi.fn(),
}));

import {
  api,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../src/api';
import { ensureFreshToken, getToken, logout } from '../src/auth';

const mockEnsureFreshToken = ensureFreshToken as ReturnType<typeof vi.fn>;
const mockGetToken = getToken as ReturnType<typeof vi.fn>;
const mockLogout = logout as ReturnType<typeof vi.fn>;

function mockFetchResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: {
      get: (key: string) => headers[key] ?? null,
    },
    json: () => Promise.resolve(body),
  });
}

describe('Error classes', () => {
  it('ForbiddenError has correct name and message', () => {
    const err = new ForbiddenError();
    expect(err.name).toBe('ForbiddenError');
    expect(err.message).toBe(
      'You do not have permission to perform this action.',
    );
    expect(err).toBeInstanceOf(Error);
  });

  it('ConflictError has correct name and default message', () => {
    const err = new ConflictError();
    expect(err.name).toBe('ConflictError');
    expect(err.message).toBe('Resource was modified by another user.');
  });

  it('ConflictError accepts custom message', () => {
    const err = new ConflictError('Custom conflict');
    expect(err.message).toBe('Custom conflict');
  });

  it('ValidationError has correct name and fieldErrors', () => {
    const err = new ValidationError('Bad input', { name: 'required' });
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('Bad input');
    expect(err.fieldErrors).toEqual({ name: 'required' });
  });

  it('ValidationError defaults to empty fieldErrors', () => {
    const err = new ValidationError('Bad input');
    expect(err.fieldErrors).toEqual({});
  });

  it('NotFoundError has correct name and default message', () => {
    const err = new NotFoundError();
    expect(err.name).toBe('NotFoundError');
    expect(err.message).toBe('Resource not found.');
  });

  it('NotFoundError accepts custom message', () => {
    const err = new NotFoundError('Item missing');
    expect(err.message).toBe('Item missing');
  });
});

describe('api methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToken.mockReturnValue('test-token');
    mockEnsureFreshToken.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('doFetch and Authorization header', () => {
    it('includes Authorization header when token exists', async () => {
      const spy = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal('fetch', spy);
      await api.list('/items');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/items/'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('omits Authorization header when no token', async () => {
      mockGetToken.mockReturnValue(undefined);
      const spy = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal('fetch', spy);
      await api.list('/items');
      const headers = spy.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe('token refresh on 401', () => {
    it('retries after 401 when token refreshes successfully', async () => {
      const spy = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: { get: () => null },
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => null },
          json: () => Promise.resolve({ id: 1 }),
        });
      vi.stubGlobal('fetch', spy);
      mockGetToken.mockReturnValue('new-token');

      const result = await api.get('/items', 1);
      expect(result).toEqual({ id: 1 });
      expect(mockEnsureFreshToken).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('calls logout and throws when refresh fails on 401', async () => {
      const spy = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', spy);
      mockGetToken.mockReturnValue(undefined);

      await expect(api.get('/items', 1)).rejects.toThrow('Session expired');
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  describe('status 204', () => {
    it('returns undefined for 204 No Content', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
          statusText: 'No Content',
          headers: { get: () => null },
          json: () => Promise.reject(new Error('no body')),
        }),
      );
      const result = await api.delete('/items', 1);
      expect(result).toBeUndefined();
    });
  });

  describe('status 403', () => {
    it('throws ForbiddenError', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({}, 403));
      await expect(api.get('/items', 1)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('status 404', () => {
    it('throws NotFoundError with detail from body', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchResponse({ detail: 'Item not found' }, 404),
      );
      await expect(api.get('/items', 99)).rejects.toThrow('Item not found');
      await expect(api.get('/items', 99)).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError with default message on empty body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: { get: () => null },
          json: () => Promise.reject(new Error('no json')),
        }),
      );
      await expect(api.get('/items', 99)).rejects.toThrow('Resource not found');
    });
  });

  describe('status 409', () => {
    it('throws ConflictError with detail', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchResponse({ detail: 'Already exists' }, 409),
      );
      await expect(api.create('/items', {})).rejects.toThrow(ConflictError);
      await expect(api.create('/items', {})).rejects.toThrow('Already exists');
    });

    it('throws ConflictError with default on empty body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          headers: { get: () => null },
          json: () => Promise.reject(new Error('no json')),
        }),
      );
      await expect(api.create('/items', {})).rejects.toThrow(
        'Resource conflict',
      );
    });
  });

  describe('status 422 / 400 - validation', () => {
    it('throws ValidationError with field_errors from body', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchResponse(
          {
            detail: 'Validation failed',
            field_errors: { name: 'required' },
          },
          422,
        ),
      );
      try {
        await api.create('/items', {});
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).fieldErrors).toEqual({
          name: 'required',
        });
      }
    });

    it('parses field errors from detail array (FastAPI format)', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchResponse(
          {
            detail: [
              {
                loc: ['body', 'name'],
                msg: 'field required',
                type: 'value_error',
              },
              {
                loc: ['body', 'email'],
                msg: 'invalid email',
                type: 'value_error',
              },
            ],
          },
          422,
        ),
      );
      try {
        await api.create('/items', {});
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).fieldErrors).toEqual({
          name: 'field required',
          email: 'invalid email',
        });
      }
    });

    it('throws generic Error when detail is a string', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ detail: 'Bad request' }, 400));
      await expect(api.create('/items', {})).rejects.toThrow('Bad request');
    });

    it('throws statusText when detail is not a string and not array', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: { get: () => null },
          json: () => Promise.resolve({}),
        }),
      );
      await expect(api.create('/items', {})).rejects.toThrow('Bad Request');
    });

    it('parseFieldErrors returns null for non-array detail', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchResponse({ detail: 'string error' }, 422),
      );
      // string detail with no field_errors => generic error
      await expect(api.create('/items', {})).rejects.toThrow('string error');
    });

    it('parseFieldErrors returns null for empty array', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: { get: () => null },
          json: () => Promise.resolve({ detail: [] }),
        }),
      );
      // Empty array => no field errors => falls through to generic error
      await expect(api.create('/items', {})).rejects.toThrow(
        'Unprocessable Entity',
      );
    });

    it('parseFieldErrors skips items without loc or msg', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchResponse(
          {
            detail: [
              { loc: ['body', 'name'], msg: 'required', type: 'value_error' },
              { type: 'missing' }, // no loc or msg
            ],
          },
          422,
        ),
      );
      try {
        await api.create('/items', {});
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).fieldErrors).toEqual({
          name: 'required',
        });
      }
    });
  });

  describe('status 429 - rate limit', () => {
    it('throws rate limit error with Retry-After header', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchResponse({}, 429, { 'Retry-After': '60' }),
      );
      await expect(api.list('/items')).rejects.toThrow(
        'Too many requests. Please try again in 60s.',
      );
    });

    it('defaults to 30s when no Retry-After header', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({}, 429));
      await expect(api.list('/items')).rejects.toThrow(
        'Too many requests. Please try again in 30s.',
      );
    });
  });

  describe('other error status', () => {
    it('throws with body detail for 500', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchResponse({ detail: 'Internal error' }, 500),
      );
      await expect(api.get('/items', 1)).rejects.toThrow('Internal error');
    });

    it('throws statusText when no body detail', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          headers: { get: () => null },
          json: () => Promise.reject(new Error('no json')),
        }),
      );
      await expect(api.get('/items', 1)).rejects.toThrow('Bad Gateway');
    });
  });

  describe('network errors', () => {
    it('propagates fetch rejection', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      );
      await expect(api.get('/items', 1)).rejects.toThrow('Failed to fetch');
    });
  });

  describe('api.list', () => {
    it('builds query string from params', async () => {
      const spy = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal('fetch', spy);
      await api.list('/items', { page: 2, page_size: 25, search: 'test' });
      const url = spy.mock.calls[0][0] as string;
      expect(url).toContain('page=2');
      expect(url).toContain('page_size=25');
      expect(url).toContain('search=test');
    });

    it('handles array params (order_by)', async () => {
      const spy = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal('fetch', spy);
      await api.list('/items', { order_by: ['name', '-created_at'] });
      const url = spy.mock.calls[0][0] as string;
      expect(url).toContain('order_by=name');
      expect(url).toContain('order_by=-created_at');
    });

    it('skips undefined/null/empty params', async () => {
      const spy = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal('fetch', spy);
      await api.list('/items', {
        page: 1,
        search: undefined,
        order_by: undefined,
      });
      const url = spy.mock.calls[0][0] as string;
      expect(url).toContain('page=1');
      expect(url).not.toContain('search');
      expect(url).not.toContain('order_by');
    });

    it('generates no query string when no params', async () => {
      const spy = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal('fetch', spy);
      await api.list('/items');
      const url = spy.mock.calls[0][0] as string;
      expect(url).toMatch(/\/items\/$/);
    });

    it('skips null and empty string params', async () => {
      const spy = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal('fetch', spy);
      await api.list('/items', {
        search: '',
        expand: null as unknown as string,
      });
      const url = spy.mock.calls[0][0] as string;
      expect(url).not.toContain('search');
      expect(url).not.toContain('expand');
    });
  });

  describe('api.get', () => {
    it('calls GET on prefix/id', async () => {
      const spy = mockFetchResponse({ id: 1, name: 'Test' });
      vi.stubGlobal('fetch', spy);
      const result = await api.get('/items', 1);
      expect(result).toEqual({ id: 1, name: 'Test' });
      expect(spy.mock.calls[0][0]).toContain('/items/1');
    });
  });

  describe('api.create', () => {
    it('calls POST with JSON body', async () => {
      const spy = mockFetchResponse({ id: 1 });
      vi.stubGlobal('fetch', spy);
      await api.create('/items', { name: 'New' });
      expect(spy.mock.calls[0][1].method).toBe('POST');
      expect(spy.mock.calls[0][1].body).toBe(JSON.stringify({ name: 'New' }));
    });
  });

  describe('api.update', () => {
    it('calls PATCH with JSON body', async () => {
      const spy = mockFetchResponse({ id: 1 });
      vi.stubGlobal('fetch', spy);
      await api.update('/items', 1, { name: 'Updated' });
      expect(spy.mock.calls[0][1].method).toBe('PATCH');
      expect(spy.mock.calls[0][0]).toContain('/items/1');
    });
  });

  describe('api.delete', () => {
    it('calls DELETE', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
          statusText: 'No Content',
          headers: { get: () => null },
          json: () => Promise.reject(new Error('no body')),
        }),
      );
      const result = await api.delete('/items', 1);
      expect(result).toBeUndefined();
    });
  });

  describe('api.bulkCreate', () => {
    it('calls POST to /bulk with items array', async () => {
      const spy = mockFetchResponse({ data: [{ id: 1 }], count: 1 });
      vi.stubGlobal('fetch', spy);
      await api.bulkCreate('/items', [{ name: 'A' }, { name: 'B' }]);
      expect(spy.mock.calls[0][0]).toContain('/items/bulk');
      expect(spy.mock.calls[0][1].method).toBe('POST');
      expect(spy.mock.calls[0][1].body).toBe(
        JSON.stringify([{ name: 'A' }, { name: 'B' }]),
      );
    });
  });

  describe('api.bulkDelete', () => {
    it('calls DELETE to /bulk with ids', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
          statusText: 'No Content',
          headers: { get: () => null },
          json: () => Promise.reject(new Error('no body')),
        }),
      );
      await api.bulkDelete('/items', [1, 2, 3]);
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('/items/bulk');
      expect(call[1].method).toBe('DELETE');
      expect(call[1].body).toBe(JSON.stringify({ ids: [1, 2, 3] }));
    });
  });

  describe('api.raw', () => {
    it('passes through path and init', async () => {
      const spy = mockFetchResponse({ ok: true });
      vi.stubGlobal('fetch', spy);
      const result = await api.raw('/custom-endpoint');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('ensureFreshToken is called before every request', () => {
    it('calls ensureFreshToken', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ data: [] }));
      await api.raw('/test');
      expect(mockEnsureFreshToken).toHaveBeenCalled();
    });
  });
});
