'use client';

import { useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';

export function useSessionErrorHandler(): void {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error === 'RefreshTokenError') {
      console.warn('[auth] RefreshTokenError 감지, 재로그인 유도');
      signIn('catcident', { callbackUrl: window.location.pathname });
    }
  }, [session?.error]);
}
