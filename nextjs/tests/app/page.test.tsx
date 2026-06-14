import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='auth'>{children}</div>
  ),
}));

vi.mock('@/components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='layout'>{children}</div>
  ),
}));

vi.mock('@/components/Dashboard', () => ({
  Dashboard: () => <div data-testid='dashboard'>dashboard</div>,
}));

import HomePage from '@/app/page';

describe('HomePage', () => {
  afterEach(cleanup);

  it('nests the dashboard inside the layout and auth guard', () => {
    render(<HomePage />);
    const auth = screen.getByTestId('auth');
    const layout = screen.getByTestId('layout');
    const dashboard = screen.getByTestId('dashboard');
    expect(auth).toContainElement(layout);
    expect(layout).toContainElement(dashboard);
  });
});
