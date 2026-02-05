/**
 * 서버 사이드 분석 세션 관리
 *
 * /api/analyze 호출마다 OpenRouter 응답의 토큰 사용량을 서버 메모리에 누적한다.
 * settle 시 서버가 직접 크레딧을 계산하므로, 클라이언트의 토큰 수 조작을 방지한다.
 *
 * 인메모리 저장: 서버 재시작 시 세션 사라짐.
 * → 만료된 hold는 backend Celery 태스크가 자동 정산하므로 크레딧 유실 없음.
 */

import { randomUUID } from 'crypto';

export interface TokenRecord {
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface AnalysisSession {
  userId: string;
  holdToken: string;
  model: string;
  tokens: TokenRecord[];
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, AnalysisSession>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30분
const MAX_SESSIONS = 1000;

/** 만료 세션 정리 */
function evictExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}

/** 분석 세션 생성 */
export function createAnalysisSession(
  userId: string,
  holdToken: string,
  model: string,
): string {
  if (sessions.size >= MAX_SESSIONS) {
    evictExpired();
  }
  const sessionId = randomUUID();
  const now = Date.now();
  sessions.set(sessionId, {
    userId,
    holdToken,
    model,
    tokens: [],
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return sessionId;
}

/** 세션에 토큰 사용량 추가 */
export function addSessionTokens(
  sessionId: string,
  record: TokenRecord,
): boolean {
  const session = sessions.get(sessionId);
  if (!session || Date.now() > session.expiresAt) return false;
  session.tokens.push(record);
  return true;
}

/** 세션 조회 (userId 일치 검증 포함) */
export function getAnalysisSession(
  sessionId: string,
  userId: string,
): AnalysisSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.userId !== userId) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

/** 세션 삭제 */
export function deleteAnalysisSession(sessionId: string): void {
  sessions.delete(sessionId);
}
