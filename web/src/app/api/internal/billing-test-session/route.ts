import { NextRequest, NextResponse } from 'next/server';
import {
  BILLING_TEST_SESSION_COOKIE,
  getBillingTestCookieOptions,
  getBillingTestSessionId,
  getBillingTestUserId,
  isBillingTestRuntimeEnabled,
  isBillingTestSecretValid,
} from '@/lib/billingTestMode';
import {
  clearBillingTestSession,
  createOrResetBillingTestSession,
  getBillingTestSession,
} from '@/lib/billingTestSessionStore';
import { clearHoldSessionsForUser } from '@/lib/holdSessionCache';

function deleteBillingTestCookie(response: NextResponse): void {
  response.cookies.set(BILLING_TEST_SESSION_COOKIE, '', {
    ...getBillingTestCookieOptions(),
    maxAge: 0,
  });
}

function serializeSession(session: {
  balanceCredits: number;
  createdAt: number;
  expiresAt: number;
  holds: Array<unknown>;
}) {
  return {
    active: true,
    balanceCredits: session.balanceCredits,
    holdCount: session.holds.length,
    createdAt: new Date(session.createdAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

export async function GET(request: NextRequest) {
  if (!isBillingTestRuntimeEnabled()) {
    return NextResponse.json({ enabled: false, active: false });
  }

  const sessionId = getBillingTestSessionId(request);
  if (!sessionId) {
    return NextResponse.json({ enabled: true, active: false });
  }

  const session = getBillingTestSession(sessionId);
  if (!session) {
    const response = NextResponse.json({
      enabled: true,
      active: false,
      message: 'Mock billing session expired.',
    });
    deleteBillingTestCookie(response);
    return response;
  }

  return NextResponse.json({
    enabled: true,
    sessionId: session.sessionId,
    ...serializeSession(session),
  });
}

export async function POST(request: NextRequest) {
  if (!isBillingTestRuntimeEnabled()) {
    return NextResponse.json({ error: 'Billing test mode is disabled.' }, { status: 404 });
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isBillingTestSecretValid(rawBody.secret)) {
    return NextResponse.json({ error: 'Invalid billing test secret.' }, { status: 403 });
  }

  if (typeof rawBody.initialCredits !== 'number' || !Number.isFinite(rawBody.initialCredits) || rawBody.initialCredits < 0) {
    return NextResponse.json({ error: 'initialCredits must be a non-negative number.' }, { status: 400 });
  }

  const existingSessionId = getBillingTestSessionId(request);
  if (existingSessionId) {
    clearBillingTestSession(existingSessionId);
    clearHoldSessionsForUser(getBillingTestUserId(existingSessionId));
  }

  const session = createOrResetBillingTestSession(existingSessionId, rawBody.initialCredits);
  const response = NextResponse.json({
    enabled: true,
    sessionId: session.sessionId,
    ...serializeSession(session),
  });
  response.cookies.set(BILLING_TEST_SESSION_COOKIE, session.sessionId, getBillingTestCookieOptions());
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isBillingTestRuntimeEnabled()) {
    return NextResponse.json({ enabled: false, cleared: true });
  }

  let rawBody: Record<string, unknown> = {};
  try {
    rawBody = await request.json();
  } catch {
    // empty body is allowed only when there is already an active cookie
  }

  if (!isBillingTestSecretValid(rawBody.secret)) {
    return NextResponse.json({ error: 'Invalid billing test secret.' }, { status: 403 });
  }

  const sessionId = getBillingTestSessionId(request);
  if (sessionId) {
    clearBillingTestSession(sessionId);
    clearHoldSessionsForUser(getBillingTestUserId(sessionId));
  }

  const response = NextResponse.json({ enabled: true, cleared: true });
  deleteBillingTestCookie(response);
  return response;
}
