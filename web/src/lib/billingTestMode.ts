import 'server-only';
import type { NextRequest } from 'next/server';
import { AUTH_ENABLED } from '@/lib/auth';

export const BILLING_TEST_MODE = process.env.BILLING_TEST_MODE === 'true';
export const BILLING_TEST_SECRET = process.env.BILLING_TEST_SECRET || '';
export const BILLING_TEST_SESSION_COOKIE = 'billing_test_session';
export const BILLING_TEST_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const BILLING_TEST_HOLD_TTL_MS = 30 * 60 * 1000;
const BILLING_TEST_USER_PREFIX = 'billing-test:';

export function isBillingTestRuntimeEnabled(): boolean {
  return BILLING_TEST_MODE && !AUTH_ENABLED;
}

export function isBillingTestSecretValid(secret: unknown): boolean {
  return typeof secret === 'string'
    && secret.length > 0
    && BILLING_TEST_SECRET.length > 0
    && secret === BILLING_TEST_SECRET;
}

export function getBillingTestSessionId(request: NextRequest): string | null {
  const raw = request.cookies.get(BILLING_TEST_SESSION_COOKIE)?.value;
  if (!raw) return null;
  const sessionId = raw.trim();
  return sessionId || null;
}

export function getBillingTestUserId(sessionId: string): string {
  return `${BILLING_TEST_USER_PREFIX}${sessionId}`;
}

export function getBillingTestCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(BILLING_TEST_SESSION_TTL_MS / 1000),
  };
}
