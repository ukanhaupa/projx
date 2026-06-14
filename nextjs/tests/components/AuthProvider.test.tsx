import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/dashboard',
}));

const isAuthenticated = vi.fn();
const initAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  isAuthenticated: () => isAuthenticated(),
  initAuth: () => initAuth(),
}));

import { AuthProvider } from '@/components/AuthProvider';

describe('AuthProvider', () => {
  beforeEach(() => {
    replace.mockReset();
    isAuthenticated.mockReset();
    initAuth.mockReset();
  });

  afterEach(cleanup);

  it('renders children immediately when already authenticated', () => {
    isAuthenticated.mockReturnValue(true);
    render(
      <AuthProvider>
        <p>protected</p>
      </AuthProvider>,
    );
    expect(screen.getByText('protected')).toBeInTheDocument();
    expect(initAuth).not.toHaveBeenCalled();
  });

  it('renders children after initAuth resolves authenticated', async () => {
    isAuthenticated.mockReturnValue(false);
    initAuth.mockResolvedValue(true);
    render(
      <AuthProvider>
        <p>protected</p>
      </AuthProvider>,
    );
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
    expect(await screen.findByText('protected')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to login with the next param when anonymous', async () => {
    isAuthenticated.mockReturnValue(false);
    initAuth.mockResolvedValue(false);
    render(
      <AuthProvider>
        <p>protected</p>
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?next=%2Fdashboard'),
    );
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });
});
