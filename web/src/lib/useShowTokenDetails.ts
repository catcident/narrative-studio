'use client';

import { useSession } from 'next-auth/react';
import { useAuthEnabled } from '../store';

/**
 * 토큰 상세 표시 여부
 * - AUTH_ENABLED=false (Railway): 항상 표시
 * - AUTH_ENABLED=true: admin/developer 역할만 표시
 */
export function useShowTokenDetails(): boolean {
  const authEnabled = useAuthEnabled();
  const { data: session } = useSession();

  // 설정 미로드 -> 기본 숨김
  if (authEnabled === null) return false;

  // AUTH_ENABLED=false (Railway) -> 항상 표시
  if (!authEnabled) return true;

  // AUTH_ENABLED=true + 세션 없음 -> 숨김
  if (!session?.user) return false;

  // admin/developer 역할 -> 표시
  const roles = session.user.roles ?? [];
  return roles.includes('admin') || roles.includes('developer');
}
