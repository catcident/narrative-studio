'use client';

import { SessionProvider, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { useSessionErrorHandler } from '../lib/useSessionErrorHandler';
import { handleUserChange } from '../lib/userScopedStorage';
import { useStore } from '../store';

function SessionErrorHandler({ children }: { children: React.ReactNode }) {
  useSessionErrorHandler();
  return <>{children}</>;
}

/**
 * 사용자 전환 감지 → localStorage 정리 + store partialAnalysis 초기화.
 * useSession 분리 패턴: 인증 상태 의존 로직을 별도 컴포넌트로 분리.
 */
function AuthCleanup() {
  const { data: session } = useSession();

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    const changed = handleUserChange(userId);
    if (changed) {
      useStore.getState().setPartialAnalysis(null);
    }
  }, [session?.user?.id]);

  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthCleanup />
      <SessionErrorHandler>{children}</SessionErrorHandler>
    </SessionProvider>
  );
}
