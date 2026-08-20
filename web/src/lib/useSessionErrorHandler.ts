'use client';

import { useEffect, useRef } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { clearUserScopedStorage } from '@/lib/userScopedStorage';
import { WITHDRAWN_ACCOUNT_ERROR } from '@/lib/withdrawalTokenGuard';
import { useStore } from '@/store';

const RELOGIN_COOLDOWN_MS = 30_000;
const RELOGIN_STORAGE_KEY = 'auth_relogin_attempt';

export function useSessionErrorHandler(): void {
  const { data: session } = useSession();
  const withdrawalHandled = useRef(false);

  useEffect(() => {
    if (session?.error === WITHDRAWN_ACCOUNT_ERROR) {
      if (withdrawalHandled.current) return;
      withdrawalHandled.current = true;
      clearUserScopedStorage();
      useStore.getState().reset();
      useStore.getState().setByokMode('disabled');
      void signOut({ callbackUrl: '/login' });
      return;
    }

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
