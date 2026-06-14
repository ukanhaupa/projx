import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/auth', () => ({
  getUserInfo: vi.fn(() => ({ name: 'TestUser', email: 'test@example.com' })),
  logout: vi.fn(),
}));

vi.mock('../../src/theme', () => ({
  useTheme: vi.fn(() => ({ theme: 'light', toggle: vi.fn() })),
}));

import { logout } from '../../src/auth';
import { Layout } from '../../src/components/Layout';

function renderLayout(initialRoute = '/') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Layout />
    </MemoryRouter>,
  );
}

describe('Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.style.overflow = '';
  });

  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  it('renders Dashboard nav link', () => {
    renderLayout();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders skip-to-content link', () => {
    renderLayout();
    expect(screen.getByText('Skip to main content')).toBeInTheDocument();
  });

  it('renders user info', () => {
    renderLayout();
    expect(screen.getByText('TestUser')).toBeInTheDocument();
  });

  it('renders logout button', async () => {
    const user = userEvent.setup();
    renderLayout();
    const logoutBtn = screen.getByRole('button', { name: /log out/i });
    await user.click(logoutBtn);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('sidebar collapse saves to localStorage', async () => {
    const user = userEvent.setup();
    renderLayout();
    const collapseBtn = screen.getByRole('button', {
      name: /collapse sidebar/i,
    });
    await user.click(collapseBtn);
    expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
  });

  it('sidebar expand saves to localStorage', async () => {
    const user = userEvent.setup();
    localStorage.setItem('sidebar-collapsed', 'true');
    renderLayout();
    const expandBtn = screen.getByRole('button', {
      name: /expand sidebar/i,
    });
    await user.click(expandBtn);
    expect(localStorage.getItem('sidebar-collapsed')).toBe('false');
  });

  it('reads collapsed state from localStorage on mount', () => {
    localStorage.setItem('sidebar-collapsed', 'true');
    renderLayout();
    const layout = document.querySelector('.layout');
    expect(layout?.classList.contains('sidebar-collapsed')).toBe(true);
  });

  it('mobile menu button opens sidebar', async () => {
    const user = userEvent.setup();
    renderLayout();
    const menuBtn = screen.getByRole('button', {
      name: /open navigation menu/i,
    });
    await user.click(menuBtn);
    const sidebar = document.querySelector('.sidebar');
    expect(sidebar?.classList.contains('sidebar-open')).toBe(true);
  });

  it('escape key closes mobile sidebar', async () => {
    const user = userEvent.setup();
    renderLayout();
    const menuBtn = screen.getByRole('button', {
      name: /open navigation menu/i,
    });
    await user.click(menuBtn);
    expect(document.querySelector('.sidebar-open')).toBeTruthy();

    await act(async () => {
      await user.keyboard('{Escape}');
    });
    expect(document.querySelector('.sidebar-open')).toBeFalsy();
  });

  it('body overflow hidden when sidebar open', async () => {
    const user = userEvent.setup();
    renderLayout();
    const menuBtn = screen.getByRole('button', {
      name: /open navigation menu/i,
    });
    await user.click(menuBtn);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('body overflow restored when sidebar closes', async () => {
    const user = userEvent.setup();
    renderLayout();
    const menuBtn = screen.getByRole('button', {
      name: /open navigation menu/i,
    });
    await user.click(menuBtn);
    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => {
      await user.keyboard('{Escape}');
    });
    expect(document.body.style.overflow).toBe('');
  });

  it('clicking backdrop closes sidebar', async () => {
    const user = userEvent.setup();
    renderLayout();
    const menuBtn = screen.getByRole('button', {
      name: /open navigation menu/i,
    });
    await user.click(menuBtn);
    const backdrop = document.querySelector('.sidebar-backdrop');
    expect(backdrop).toBeTruthy();
    await user.click(backdrop!);
    expect(document.querySelector('.sidebar-open')).toBeFalsy();
  });

  it('renders theme toggle button', () => {
    renderLayout();
    const themeBtn = screen.getByRole('button', {
      name: /switch to dark theme/i,
    });
    expect(themeBtn).toBeInTheDocument();
  });

  it('sidebar nav has correct aria-label', () => {
    renderLayout();
    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(nav).toBeInTheDocument();
  });
});
