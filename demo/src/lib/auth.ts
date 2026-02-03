import { NextResponse } from 'next/server';

// API 라우트에서 사용할 헬퍼 함수
export async function requireAuth(): Promise<{ userId: string } | { error: Response }> {
  // 현재는 인증 없이 anonymous로 사용
  return { userId: 'anonymous' };
}
