'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { initAuth, isAuthenticated } from '../lib/auth';

type AuthState = 'pending' | 'authed' | 'anon';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    isAuthenticated() ? 'authed' : 'pending',
  );
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isAuthenticated()) return;
    let active = true;
    initAuth().then((ok) => {
      if (!active) return;
      setState(ok ? 'authed' : 'anon');
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (state === 'anon') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [state, pathname, router]);

  if (state !== 'authed') return null;

  return <>{children}</>;
}
