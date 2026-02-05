'use client';

import { useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';

const RELOGIN_COOLDOWN_MS = 30_000;
const RELOGIN_STORAGE_KEY = 'auth_relogin_attempt';

export function useSessionErrorHandler(): void {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error === 'RefreshTokenError') {
      // 무한 리다이렉트 루프 방지: 30초 쿨다운
      const lastAttempt = sessionStorage.getItem(RELOGIN_STORAGE_KEY);
      if (lastAttempt && Date.now() - Number(lastAttempt) < RELOGIN_COOLDOWN_MS) {
        console.warn('[auth] RefreshTokenError 감지, 재로그인 쿨다운 중 (30초)');
        return;
      }
      console.warn('[auth] RefreshTokenError 감지, 재로그인 유도');
      sessionStorage.setItem(RELOGIN_STORAGE_KEY, String(Date.now()));
      signIn('catcident', { callbackUrl: window.location.pathname });
    }
  }, [session?.error]);
}
