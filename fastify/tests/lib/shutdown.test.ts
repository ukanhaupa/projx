import { describe, expect, it, vi } from 'vitest';
import { gracefulShutdown } from '../../src/lib/shutdown.js';

interface FakeLog {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function fakeApp(close: () => Promise<void> = async () => {}) {
  const log: FakeLog = { info: vi.fn(), error: vi.fn() };
  return {
    close: vi.fn(close),
    log,
  };
}

describe('gracefulShutdown', () => {
  it('logs the signal, closes the app, and exits 0', async () => {
    const app = fakeApp();
    const exit = vi.fn() as unknown as (code: number) => never;
    await gracefulShutdown(app, 'SIGTERM', exit);
    expect(app.log.info).toHaveBeenCalledWith(
      { signal: 'SIGTERM' },
      'shutdown_signal_received',
    );
    expect(app.close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('still exits 0 when app.close throws', async () => {
    const app = fakeApp(async () => {
      throw new Error('boom');
    });
    const exit = vi.fn() as unknown as (code: number) => never;
    await gracefulShutdown(app, 'SIGINT', exit);
    expect(app.log.error).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
