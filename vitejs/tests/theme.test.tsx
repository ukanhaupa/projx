import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../src/theme';

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('ThemeProvider', () => {
  let listeners: Array<(e: { matches: boolean }) => void> = [];

  beforeEach(() => {
    localStorage.clear();
    listeners = [];
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('dark') ? false : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (
          _: string,
          cb: (e: { matches: boolean }) => void,
        ) => {
          listeners.push(cb);
        },
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to light when no preference set', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('light');
  });

  it('reads from localStorage', () => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('theme-manual', 'true');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('dark');
  });

  it('toggle sets manual flag', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('theme-manual')).toBe('true');
  });

  it('updates theme when system preference changes and no manual override', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('light');
    act(() => {
      listeners.forEach((cb) => cb({ matches: true }));
    });
    expect(result.current.theme).toBe('dark');
  });

  it('does not update theme on system change when manually set', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
    act(() => {
      listeners.forEach((cb) => cb({ matches: false }));
    });
    expect(result.current.theme).toBe('dark');
  });
});
