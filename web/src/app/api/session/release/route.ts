import { NextRequest, NextResponse } from 'next/server';
import { AUTH_ENABLED, requireAuth } from '@/lib/auth';
import { updateBalanceCache } from '@/lib/balanceCache';
import { clearHoldSession } from '@/lib/holdSessionCache';
import { checkRateLimit } from '@/lib/rateLimit';
import { proxyToCatcident } from '@/services/billingProxy';

export async function POST(request: NextRequest) {
  try {
    if (!AUTH_ENABLED) {
      return NextResponse.json({ error: 'Billing not available' }, { status: 400 });
    }

    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId, accessToken } = authResult;

    const limited = checkRateLimit(userId);
    if (limited) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) } },
      );
    }

    let rawBody: Record<string, unknown>;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const holdToken = rawBody.hold_token;

    if (typeof holdToken !== 'string') {
      return NextResponse.json({ error: 'Missing required field: hold_token' }, { status: 400 });
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
