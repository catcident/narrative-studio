/**
 * Server-side per-hold session cache for /api/analyze.
 *
 * Associates an authenticated user with a billing hold token and tracks
 * remaining budget in KRW to prevent unbounded calls during one hold session.
 */

import 'server-only';
import { KRW_PER_CREDIT } from '@/lib/serverCosts';

interface HoldSessionEntry {
  userId: string;
  holdToken: string;
  remainingKrw: number;
  expiresAt: number;
  updatedAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE = 500;

const holdSessions = new Map<string, HoldSessionEntry>();

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
  if (!holdToken || !userId) return;

  const parsedExpiresAt = expiresAtIso ? Date.parse(expiresAtIso) : NaN;
  const expiresAt = Number.isFinite(parsedExpiresAt)
    ? parsedExpiresAt
    : Date.now() + DEFAULT_TTL_MS;

  const remainingCredits = Number.isFinite(amountCredits) ? Math.max(0, amountCredits) : 0;

  cleanupStaleSessions();
  holdSessions.set(holdToken, {
    userId,
    holdToken,
    remainingKrw: remainingCredits * KRW_PER_CREDIT,
    expiresAt,
    updatedAt: Date.now(),
  });
}

export function hasActiveHoldSession(userId: string): boolean {
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

export function getHoldRemainingKrw(userId: string, holdToken: string): number | null {
  const entry = getValidSession(userId, holdToken);
  if (!entry) return null;
  return entry.remainingKrw;
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

  return {
    remainingKrw: entry.remainingKrw,
    remainingCredits: Math.max(0, Math.ceil(entry.remainingKrw / KRW_PER_CREDIT)),
  };
}

export function clearHoldSession(userId: string, holdToken: string): void {
  const entry = holdSessions.get(holdToken);
  if (!entry) return;
  if (entry.userId !== userId) return;
  holdSessions.delete(holdToken);
}

