import 'server-only';
import { BILLING_TEST_HOLD_TTL_MS, BILLING_TEST_SESSION_TTL_MS } from '@/lib/billingTestMode';

export interface BillingTestHold {
  holdToken: string;
  amountCredits: number;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
}

export interface BillingTestSession {
  sessionId: string;
  balanceCredits: number;
  holds: Map<string, BillingTestHold>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

interface BillingTestSessionSnapshot {
  sessionId: string;
  balanceCredits: number;
  holds: Array<{
    holdToken: string;
    amountCredits: number;
    createdAt: number;
    expiresAt: number;
    updatedAt: number;
  }>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

const MAX_SESSIONS = 200;

const sessions = new Map<string, BillingTestSession>();

function clampCredits(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function createSessionSnapshot(session: BillingTestSession): BillingTestSessionSnapshot {
  return {
    sessionId: session.sessionId,
    balanceCredits: session.balanceCredits,
    holds: [...session.holds.values()].map((hold) => ({
      holdToken: hold.holdToken,
      amountCredits: hold.amountCredits,
      createdAt: hold.createdAt,
      expiresAt: hold.expiresAt,
      updatedAt: hold.updatedAt,
    })),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
  };
}

function cleanupSessions(): void {
  const now = Date.now();

  for (const [sessionId, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(sessionId);
      continue;
    }

    for (const [holdToken, hold] of session.holds) {
      if (hold.expiresAt <= now) {
        session.balanceCredits += hold.amountCredits;
        session.holds.delete(holdToken);
      }
    }

    session.updatedAt = now;
  }

  if (sessions.size > MAX_SESSIONS) {
    const byOldest = [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    const removeCount = sessions.size - MAX_SESSIONS;
    for (let i = 0; i < removeCount; i++) {
      sessions.delete(byOldest[i].sessionId);
    }
  }
}

function buildExpiresAt(ttlMs: number): number {
  return Date.now() + ttlMs;
}

function createHoldToken(): string {
  return `btest_${crypto.randomUUID().replace(/-/g, '')}`;
}

function getMutableSession(sessionId: string): BillingTestSession | null {
  cleanupSessions();
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function getBillingTestSession(sessionId: string): BillingTestSessionSnapshot | null {
  const session = getMutableSession(sessionId);
  return session ? createSessionSnapshot(session) : null;
}

export function createOrResetBillingTestSession(
  sessionId: string | null,
  initialCredits: number,
): BillingTestSessionSnapshot {
  cleanupSessions();

  const normalizedCredits = clampCredits(initialCredits);
  const now = Date.now();
  const existing = sessionId ? sessions.get(sessionId) : null;

  const nextSessionId = existing?.sessionId ?? crypto.randomUUID();
  const nextSession: BillingTestSession = {
    sessionId: nextSessionId,
    balanceCredits: normalizedCredits,
    holds: new Map(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    expiresAt: buildExpiresAt(BILLING_TEST_SESSION_TTL_MS),
  };

  sessions.set(nextSessionId, nextSession);
  return createSessionSnapshot(nextSession);
}

export function clearBillingTestSession(sessionId: string): void {
  cleanupSessions();
  sessions.delete(sessionId);
}

export function createBillingTestHold(
  sessionId: string,
  amountCredits: number,
): { holdToken: string; amount: number; balanceAfter: number; expiresAt: string } | null {
  const session = getMutableSession(sessionId);
  if (!session) return null;

  const normalizedAmount = clampCredits(amountCredits);
  if (normalizedAmount <= 0) return null;
  if (session.balanceCredits < normalizedAmount) return null;

  const holdToken = createHoldToken();
  const now = Date.now();
  const expiresAt = buildExpiresAt(BILLING_TEST_HOLD_TTL_MS);

  session.balanceCredits -= normalizedAmount;
  session.holds.set(holdToken, {
    holdToken,
    amountCredits: normalizedAmount,
    createdAt: now,
    expiresAt,
    updatedAt: now,
  });
  session.updatedAt = now;
  session.expiresAt = buildExpiresAt(BILLING_TEST_SESSION_TTL_MS);

  return {
    holdToken,
    amount: normalizedAmount,
    balanceAfter: session.balanceCredits,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function settleBillingTestHold(
  sessionId: string,
  holdToken: string,
  actualCredits: number,
): { balanceAfter: number; amountDeducted: number; refunded: number; heldCredits: number } | null {
  const session = getMutableSession(sessionId);
  if (!session) return null;

  const hold = session.holds.get(holdToken);
  if (!hold) return null;

  const normalizedActual = clampCredits(actualCredits);
  const amountDeducted = Math.min(normalizedActual, hold.amountCredits);
  const refunded = hold.amountCredits - amountDeducted;

  session.balanceCredits += refunded;
  session.holds.delete(holdToken);
  session.updatedAt = Date.now();
  session.expiresAt = buildExpiresAt(BILLING_TEST_SESSION_TTL_MS);

  return {
    balanceAfter: session.balanceCredits,
    amountDeducted,
    refunded,
    heldCredits: hold.amountCredits,
  };
}

export function releaseBillingTestHold(
  sessionId: string,
  holdToken: string,
): { balanceAfter: number; refunded: number } | null {
  const session = getMutableSession(sessionId);
  if (!session) return null;

  const hold = session.holds.get(holdToken);
  if (!hold) return null;

  session.balanceCredits += hold.amountCredits;
  session.holds.delete(holdToken);
  session.updatedAt = Date.now();
  session.expiresAt = buildExpiresAt(BILLING_TEST_SESSION_TTL_MS);

  return {
    balanceAfter: session.balanceCredits,
    refunded: hold.amountCredits,
  };
}
