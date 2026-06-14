import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';

function Harness() {
  const { theme, toggle } = useTheme();
  return (
    <div>
      <span data-testid='theme'>{theme}</span>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

type MediaListener = (e: { matches: boolean }) => void;

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<MediaListener>();
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: MediaListener) => listeners.add(cb),
    removeEventListener: (_: string, cb: MediaListener) => listeners.delete(cb),
    dispatch: (value: boolean) =>
      listeners.forEach((cb) => cb({ matches: value })),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return mql;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('defaults to light when nothing is stored and system prefers light', () => {
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('honors the stored preference over the system setting', () => {
    stubMatchMedia(false);
    localStorage.setItem('theme', 'dark');
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('falls back to the system preference on first visit', () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('toggles the theme and persists a manual choice', async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    await user.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('theme-manual')).toBe('true');
  });

  it('follows system changes until a manual choice is made', async () => {
    const mql = stubMatchMedia(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    act(() => mql.dispatch(true));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');

    await user.click(screen.getByText('toggle'));
    act(() => mql.dispatch(false));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    act(() => mql.dispatch(true));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });
});
