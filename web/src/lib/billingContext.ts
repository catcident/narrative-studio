import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_ENABLED, requireAuth } from '@/lib/auth';
import {
  BILLING_TEST_SESSION_COOKIE,
  getBillingTestSessionId,
  getBillingTestUserId,
  isBillingTestRuntimeEnabled,
} from '@/lib/billingTestMode';
import { getBillingTestSession } from '@/lib/billingTestSessionStore';

export type BillingContext =
  | { kind: 'authenticated'; userId: string; accessToken?: string }
  | { kind: 'mock'; userId: string; sessionId: string }
  | { kind: 'none' };

export type BillingContextResult = BillingContext | { error: Response };

function buildExpiredMockSessionResponse(): NextResponse {
  const response = NextResponse.json(
    { error: 'Mock billing session expired. Recreate it from /app/internal/billing-test.' },
    { status: 409 },
  );
  response.cookies.set(BILLING_TEST_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function resolveBillingContext(request: NextRequest): Promise<BillingContextResult> {
  if (AUTH_ENABLED) {
    const authResult = await requireAuth();
    if ('error' in authResult) {
      return { error: authResult.error };
    }
    return {
      kind: 'authenticated',
      userId: authResult.userId,
      accessToken: authResult.accessToken,
    };
  }

  if (!isBillingTestRuntimeEnabled()) {
    return { kind: 'none' };
  }

  const sessionId = getBillingTestSessionId(request);
  if (!sessionId) {
    return { kind: 'none' };
  }

  const session = getBillingTestSession(sessionId);
  if (!session) {
    return { error: buildExpiredMockSessionResponse() };
  }

  return {
    kind: 'mock',
    userId: getBillingTestUserId(session.sessionId),
    sessionId: session.sessionId,
  };
}
