import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NotFound } from '../../src/pages/NotFound';

describe('NotFound', () => {
  afterEach(cleanup);

  it('renders the not-found error scaffold', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });
});
