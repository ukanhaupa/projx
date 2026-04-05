import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { initAuth } from './auth';
import { Layout } from './components/Layout';
import { loadEntities, resetEntityCache } from './entities';
import { Dashboard } from './pages/Dashboard';
import { EntityPage } from './pages/EntityPage';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';

const AUTH_ENABLED = (import.meta.env.VITE_AUTH_ENABLED ?? 'true') !== 'false';

function useLoadEntities(authed: boolean) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    loadEntities()
      .catch((e: unknown) => {
        if (!cancelled)
          setLoadError(
            e instanceof Error ? e.message : 'Failed to load application data',
          );
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, loadKey]);

  const retrying = loadKey > 0 && !ready;

  const retry = useCallback(() => {
    resetEntityCache();
    setReady(false);
    setLoadError('');
    setLoadKey((k) => k + 1);
  }, []);

  return { ready, loadError, retrying, retry };
}

export function App() {
  const [authed, setAuthed] = useState(() =>
    AUTH_ENABLED ? initAuth() : true,
  );
  const {
    ready,
    loadError,
    retrying,
    retry: handleRetry,
  } = useLoadEntities(authed);

  if (!authed) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path='*' element={<Login onAuth={() => setAuthed(true)} />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (!ready) {
    return (
      <div
        role='status'
        aria-label='Loading application'
        style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}
      >
        <div className='loading-spinner' />
        <span className='sr-only'>Loading...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className='full-page-state' role='alert'>
        <div>
          <h2>Unable to Load</h2>
          <p>{loadError}</p>
          <button onClick={handleRetry} disabled={retrying}>
            {retrying ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path='/:slug' element={<EntityPage />} />
        </Route>
        <Route path='*' element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
