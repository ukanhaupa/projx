'use client';

import { useEffect } from 'react';
import { ErrorScaffold } from '../components/ErrorScaffold';
import { Sentry } from '../lib/sentry';
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang='en'>
      <body>
        <ErrorScaffold
          variant='server-error'
          primaryAction={{ label: 'Retry', onClick: () => reset() }}
        />
      </body>
    </html>
  );
}
