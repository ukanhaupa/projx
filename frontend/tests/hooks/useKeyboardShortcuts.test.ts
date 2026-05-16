import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../../src/hooks/useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  let mockElement: HTMLInputElement;

  beforeEach(() => {
    mockElement = document.createElement('input');
    mockElement.setAttribute('data-search-input', 'true');
    document.body.appendChild(mockElement);
  });

  afterEach(() => {
    document.body.removeChild(mockElement);
  });

  it('focuses search input on Cmd+K', () => {
    renderHook(() => useKeyboardShortcuts());
    const focusSpy = vi.spyOn(mockElement, 'focus');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
    );
    expect(focusSpy).toHaveBeenCalled();
  });

  it('focuses search input on Ctrl+K', () => {
    renderHook(() => useKeyboardShortcuts());
    const focusSpy = vi.spyOn(mockElement, 'focus');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }),
    );
    expect(focusSpy).toHaveBeenCalled();
  });

  it('does not trigger when typing in an input', () => {
    renderHook(() => useKeyboardShortcuts());
    const otherInput = document.createElement('input');
    document.body.appendChild(otherInput);
    otherInput.focus();

    const focusSpy = vi.spyOn(mockElement, 'focus');
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    });
    otherInput.dispatchEvent(event);
    expect(focusSpy).not.toHaveBeenCalled();

    document.body.removeChild(otherInput);
  });
});
