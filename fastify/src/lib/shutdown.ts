interface ShutdownTarget {
  close: () => Promise<void>;
  log: {
    info: (data: unknown, msg?: string) => void;
    error: (data: unknown, msg?: string) => void;
  };
}

export async function gracefulShutdown(
  app: ShutdownTarget,
  signal: string,
  exit: (code: number) => never = process.exit as (code: number) => never,
): Promise<void> {
  app.log.info({ signal }, 'shutdown_signal_received');
  try {
    await app.close();
  } catch (err) {
    app.log.error({ err }, 'shutdown_error');
  }
  exit(0);
}
