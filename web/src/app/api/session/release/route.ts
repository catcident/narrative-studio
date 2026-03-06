import { NextRequest, NextResponse } from 'next/server';
import { AUTH_ENABLED } from '@/lib/auth';
import { updateBalanceCache } from '@/lib/balanceCache';
import { resolveBillingContext } from '@/lib/billingContext';
import { releaseBillingTestHold } from '@/lib/billingTestSessionStore';
import { clearHoldSession } from '@/lib/holdSessionCache';
import { checkRateLimit } from '@/lib/rateLimit';
import { proxyToCatcident } from '@/services/billingProxy';

export async function POST(request: NextRequest) {
  try {
    const context = await resolveBillingContext(request);
    if ('error' in context) return context.error;

    if (!AUTH_ENABLED && context.kind === 'none') {
      return NextResponse.json({ error: 'Billing not available' }, { status: 400 });
    }

    const userId = context.kind === 'none' ? null : context.userId;
    const accessToken = context.kind === 'authenticated' ? context.accessToken : undefined;

    if (userId) {
      const limited = checkRateLimit(userId);
      if (limited) {
        return NextResponse.json(
          { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) } },
        );
      }
    }

    let rawBody: Record<string, unknown>;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const holdToken = rawBody.hold_token;

    if (typeof holdToken !== 'string') {
      return NextResponse.json({ error: 'Missing required field: hold_token' }, { status: 400 });
    }

    if (context.kind === 'mock') {
      const data = releaseBillingTestHold(context.sessionId, holdToken);
      if (!data) {
        return NextResponse.json({ error: 'Invalid or expired hold session.' }, { status: 404 });
      }

      clearHoldSession(context.userId, holdToken);
      console.log(`[session] mock release for ${context.userId}: refunded=${data.refunded}`);
      return NextResponse.json({
        balance_after: data.balanceAfter,
        refunded: data.refunded,
      });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Billing not available' }, { status: 400 });
    }

    const body = JSON.stringify({
      hold_token: holdToken,
      service: 'storygraph',
    });

    const response = await proxyToCatcident('/credits/release/', accessToken, { method: 'POST', body });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(`[session] release upstream error ${response.status}:`, errorBody);
      return NextResponse.json(
        { error: 'Billing service error' },
        { status: response.status >= 500 ? 502 : response.status },
      );
    }

    let data: { balance_after: number; refunded: number };
    try {
      data = await response.json();
    } catch {
      return NextResponse.json({ error: 'Invalid response from billing service' }, { status: 502 });
    }

    clearHoldSession(userId, holdToken);
    updateBalanceCache(userId, data.balance_after);
    console.log(`[session] release for user ${userId}: refunded=${data.refunded}`);

    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error('[session] release error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
