/**
 * Server-side per-hold session cache for /api/analyze.
 *
 * Associates an authenticated user with a billing hold token and tracks
 * remaining budget in KRW to prevent unbounded calls during one hold session.
 */

import 'server-only';
import { KRW_PER_CREDIT } from '@/lib/serverCosts';
import { isSubjectLocallyBlocked } from '@/lib/subjectWriteFence';

interface HoldSessionEntry {
  userId: string;
  holdToken: string;
  initialKrw: number;
  remainingKrw: number;
  expiresAt: number;
  updatedAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE = 500;

const holdSessions = new Map<string, HoldSessionEntry>();

function toBudgetSnapshot(entry: HoldSessionEntry): { remainingKrw: number; remainingCredits: number } {
  return {
    remainingKrw: entry.remainingKrw,
    remainingCredits: Math.max(0, Math.ceil(entry.remainingKrw / KRW_PER_CREDIT)),
  };
}

function cleanupStaleSessions(): void {
  const now = Date.now();

  for (const [token, entry] of holdSessions) {
    if (entry.expiresAt <= now) {
      holdSessions.delete(token);
    }
  }

  if (holdSessions.size > MAX_CACHE_SIZE) {
    const byOldest = [...holdSessions.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    const removeCount = holdSessions.size - MAX_CACHE_SIZE;
    for (let i = 0; i < removeCount; i++) {
      holdSessions.delete(byOldest[i][0]);
    }
  }
}

function getValidSession(userId: string, holdToken: string): HoldSessionEntry | null {
  cleanupStaleSessions();

  const entry = holdSessions.get(holdToken);
  if (!entry) return null;
  if (entry.userId !== userId) return null;
  if (isSubjectLocallyBlocked(userId)) {
    holdSessions.delete(holdToken);
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    holdSessions.delete(holdToken);
    return null;
  }
  return entry;
}

export function registerHoldSession(
  userId: string,
  holdToken: string,
  amountCredits: number,
  expiresAtIso?: string | null,
): void {
  if (!holdToken || !userId || isSubjectLocallyBlocked(userId)) return;

  const parsedExpiresAt = expiresAtIso ? Date.parse(expiresAtIso) : NaN;
  const expiresAt = Number.isFinite(parsedExpiresAt)
    ? parsedExpiresAt
    : Date.now() + DEFAULT_TTL_MS;

  const remainingCredits = Number.isFinite(amountCredits) ? Math.max(0, amountCredits) : 0;
  const initialKrw = remainingCredits * KRW_PER_CREDIT;

  cleanupStaleSessions();
  holdSessions.set(holdToken, {
    userId,
    holdToken,
    initialKrw,
    remainingKrw: initialKrw,
    expiresAt,
    updatedAt: Date.now(),
  });
}

export function hasActiveHoldSession(userId: string): boolean {
  if (isSubjectLocallyBlocked(userId)) {
    clearHoldSessionsForUser(userId);
    return false;
  }
  cleanupStaleSessions();
  for (const entry of holdSessions.values()) {
    if (entry.userId === userId && entry.expiresAt > Date.now()) {
      return true;
    }
  }
  return false;
}

export function hasUsableHoldSession(userId: string, holdToken: string): boolean {
  const entry = getValidSession(userId, holdToken);
  return !!entry && entry.remainingKrw > 0;
}

export function hasValidHoldSession(userId: string, holdToken: string): boolean {
  return getValidSession(userId, holdToken) !== null;
}

export function getHoldRemainingKrw(userId: string, holdToken: string): number | null {
  const entry = getValidSession(userId, holdToken);
  if (!entry) return null;
  return entry.remainingKrw;
}

export function getHoldInitialCredits(userId: string, holdToken: string): number | null {
  const entry = getValidSession(userId, holdToken);
  if (!entry) return null;
  return Math.max(0, Math.ceil(entry.initialKrw / KRW_PER_CREDIT));
}

/**
 * 원자적 예산 예약:
 * - 부족하면 null 반환 (차감하지 않음)
 * - 충분하면 즉시 차감 후 남은 예산 반환
 */
export function reserveHoldSessionBudget(
  userId: string,
  holdToken: string,
  requiredKrw: number,
): { remainingKrw: number; remainingCredits: number } | null {
  const entry = getValidSession(userId, holdToken);
  if (!entry) return null;

  if (!Number.isFinite(requiredKrw) || requiredKrw <= 0) {
    entry.updatedAt = Date.now();
    holdSessions.set(holdToken, entry);
    return toBudgetSnapshot(entry);
  }

  if (entry.remainingKrw < requiredKrw) {
    return null;
  }

  entry.remainingKrw -= requiredKrw;
  entry.updatedAt = Date.now();
  holdSessions.set(holdToken, entry);
  return toBudgetSnapshot(entry);
}

export function consumeHoldSessionBudget(
  userId: string,
  holdToken: string,
  costKrw: number,
): { remainingKrw: number; remainingCredits: number } | null {
  const entry = getValidSession(userId, holdToken);
  if (!entry) return null;

  if (Number.isFinite(costKrw) && costKrw > 0) {
    entry.remainingKrw = Math.max(0, entry.remainingKrw - costKrw);
  }
  entry.updatedAt = Date.now();
  holdSessions.set(holdToken, entry);
  return toBudgetSnapshot(entry);
}

export function refundHoldSessionBudget(
  userId: string,
  holdToken: string,
  refundKrw: number,
): { remainingKrw: number; remainingCredits: number } | null {
  const entry = getValidSession(userId, holdToken);
  if (!entry) return null;

  if (Number.isFinite(refundKrw) && refundKrw > 0) {
    entry.remainingKrw = Math.min(entry.initialKrw, entry.remainingKrw + refundKrw);
  }
  entry.updatedAt = Date.now();
  holdSessions.set(holdToken, entry);
  return toBudgetSnapshot(entry);
}

export function clearHoldSession(userId: string, holdToken: string): void {
  const entry = holdSessions.get(holdToken);
  if (!entry) return;
  if (entry.userId !== userId) return;
  holdSessions.delete(holdToken);
}

export function clearHoldSessionsForUser(userId: string): void {
  cleanupStaleSessions();
  for (const [holdToken, entry] of holdSessions) {
    if (entry.userId === userId) {
      holdSessions.delete(holdToken);
    }
  }
}
