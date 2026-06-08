import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/auth', () => ({
  login: vi.fn(),
}));

vi.mock('../../src/theme', () => ({
  useTheme: vi.fn(() => ({ theme: 'light', toggle: vi.fn() })),
}));

import { login } from '../../src/auth';
import { useTheme } from '../../src/theme';
import { Login } from '../../src/pages/Login';

const mockLogin = vi.mocked(login);
const mockUseTheme = vi.mocked(useTheme);

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTheme.mockReturnValue({ theme: 'light', toggle: vi.fn() });
  });

  afterEach(cleanup);

  it('renders the sign-in form', () => {
    render(<Login onAuth={vi.fn()} />);
    expect(
      screen.getByRole('heading', { name: 'Sign In' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('submits credentials and calls onAuth on success', async () => {
    mockLogin.mockResolvedValue(undefined as never);
    const onAuth = vi.fn();
    const user = userEvent.setup();

    render(<Login onAuth={onAuth} />);
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() =>
      expect(mockLogin).toHaveBeenCalledWith('alice', 'secret'),
    );
    expect(onAuth).toHaveBeenCalledOnce();
  });

  it('shows an error message when login rejects', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));
    const onAuth = vi.fn();
    const user = userEvent.setup();

    render(<Login onAuth={onAuth} />);
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid credentials',
    );
    expect(onAuth).not.toHaveBeenCalled();
  });

  it('shows a generic error when the rejection is not an Error', async () => {
    mockLogin.mockRejectedValue('boom');
    const user = userEvent.setup();

    render(<Login onAuth={vi.fn()} />);
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Login failed');
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    render(<Login onAuth={vi.fn()} />);

    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.type).toBe('password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password.type).toBe('password');
  });

  it('toggles the theme', async () => {
    const toggle = vi.fn();
    mockUseTheme.mockReturnValue({ theme: 'light', toggle });
    const user = userEvent.setup();

    render(<Login onAuth={vi.fn()} />);
    await user.click(
      screen.getByRole('button', { name: 'Switch to dark theme' }),
    );
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('renders the dark-theme toggle affordance when theme is dark', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggle: vi.fn() });
    render(<Login onAuth={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Switch to light theme' }),
    ).toBeInTheDocument();
  });
});
