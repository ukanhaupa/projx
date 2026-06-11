import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth', () => ({
  initAuth: vi.fn(),
  getUserInfo: vi.fn(() => ({ name: 'TestUser', email: 'test@example.com' })),
  logout: vi.fn(),
}));

vi.mock('../src/theme', () => ({
  useTheme: vi.fn(() => ({ theme: 'light', toggle: vi.fn() })),
}));

import { initAuth } from '../src/auth';
import { App } from '../src/App';

const mockInitAuth = vi.mocked(initAuth);

describe('App', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('renders the Login page when unauthenticated', async () => {
    mockInitAuth.mockResolvedValue(false);
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Sign In' }),
    ).toBeInTheDocument();
  });

  it('renders the Dashboard when authenticated', async () => {
    mockInitAuth.mockResolvedValue(true);
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Dashboard' }),
    ).toBeInTheDocument();
  });
});
