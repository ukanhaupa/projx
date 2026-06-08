import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Dashboard } from '../../src/pages/Dashboard';

describe('Dashboard', () => {
  afterEach(cleanup);

  it('renders the dashboard heading and welcome copy', () => {
    render(<Dashboard />);
    expect(
      screen.getByRole('heading', { name: 'Dashboard' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Welcome. Build your application surface here.'),
    ).toBeInTheDocument();
  });
});
