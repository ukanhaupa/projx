'use client';

import { useEffect } from 'react';
import { ErrorScaffold } from '../components/ErrorScaffold';
import { Sentry } from '../lib/sentry';

export default function Error({
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
    <ErrorScaffold
      variant='boundary'
      primaryAction={{ label: 'Retry', onClick: () => reset() }}
      secondaryAction={{ label: 'Go home', href: '/' }}
    />
  );
}
