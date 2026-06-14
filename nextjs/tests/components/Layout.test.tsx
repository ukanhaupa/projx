import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    role,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    role?: string;
  }) => (
    <a href={href} className={className} role={role}>
      {children}
    </a>
  ),
}));

const logout = vi.fn();
vi.mock('@/lib/auth', () => ({
  getUserInfo: () => ({ name: 'Ada' }),
  logout: () => logout(),
}));

const toggle = vi.fn();
vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggle }),
}));

import { Layout } from '@/components/Layout';

describe('Layout', () => {
  beforeEach(() => {
    pathname = '/';
    logout.mockReset();
    toggle.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  function dashboardLink() {
    return screen.getByText('Dashboard').closest('a')!;
  }

  it('renders the nav, user name, and children', () => {
    render(
      <Layout>
        <p>page body</p>
      </Layout>,
    );
    expect(dashboardLink()).toHaveAttribute('href', '/');
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('marks the active nav item', () => {
    render(
      <Layout>
        <p>x</p>
      </Layout>,
    );
    expect(dashboardLink()).toHaveClass('active');
  });

  it('logs out when the logout button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Layout>
        <p>x</p>
      </Layout>,
    );
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('toggles the theme', async () => {
    const user = userEvent.setup();
    render(
      <Layout>
        <p>x</p>
      </Layout>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Switch to dark theme' }),
    );
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('opens the sidebar from the mobile menu and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Layout>
        <p>x</p>
      </Layout>,
    );
    const menuBtn = screen.getByRole('button', {
      name: 'Open navigation menu',
    });
    await user.click(menuBtn);
    expect(screen.getByLabelText('Main navigation')).toHaveClass(
      'sidebar-open',
    );
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Main navigation')).not.toHaveClass(
      'sidebar-open',
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('closes the sidebar when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Layout>
        <p>x</p>
      </Layout>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Open navigation menu' }),
    );
    const backdrop = document.querySelector('.sidebar-backdrop')!;
    await user.click(backdrop);
    expect(screen.getByLabelText('Main navigation')).not.toHaveClass(
      'sidebar-open',
    );
  });

  it('persists and restores the collapsed state', async () => {
    const user = userEvent.setup();
    render(
      <Layout>
        <p>x</p>
      </Layout>,
    );
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeInTheDocument();
  });

  it('reads the collapsed preference from storage on mount', () => {
    localStorage.setItem('sidebar-collapsed', 'true');
    render(
      <Layout>
        <p>x</p>
      </Layout>,
    );
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeInTheDocument();
  });
});
