import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/LoginForm', () => ({
  LoginForm: () => <div data-testid='login-form'>login form</div>,
}));

import LoginPage from '@/app/login/page';

describe('LoginPage', () => {
  afterEach(cleanup);

  it('renders the login form within a Suspense boundary', () => {
    render(<LoginPage />);
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
  });
});
