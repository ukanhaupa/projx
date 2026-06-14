import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
const searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

const login = vi.fn();
vi.mock('@/lib/auth', () => ({
  login: (u: string, p: string) => login(u, p),
}));

vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggle: vi.fn() }),
}));

import { LoginForm } from '@/components/LoginForm';

describe('LoginForm', () => {
  beforeEach(() => {
    replace.mockReset();
    login.mockReset();
    searchParams.delete('next');
  });

  afterEach(cleanup);

  it('logs in and redirects home by default', async () => {
    login.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(login).toHaveBeenCalledWith('alice', 'secret');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('redirects to the validated next param after login', async () => {
    login.mockResolvedValue(undefined);
    searchParams.set('next', '/reports');
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('Username'), 'a');
    await user.type(screen.getByLabelText('Password'), 'b');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/reports'));
  });

  it('ignores an unsafe next param and falls back to home', async () => {
    login.mockResolvedValue(undefined);
    searchParams.set('next', 'https://evil.example');
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('Username'), 'a');
    await user.type(screen.getByLabelText('Password'), 'b');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('surfaces the error message when login fails', async () => {
    login.mockRejectedValue(new Error('Invalid credentials'));
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('Username'), 'a');
    await user.type(screen.getByLabelText('Password'), 'b');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid credentials',
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a generic message for a non-Error rejection', async () => {
    login.mockRejectedValue('nope');
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('Username'), 'a');
    await user.type(screen.getByLabelText('Password'), 'b');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Login failed');
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });
});
