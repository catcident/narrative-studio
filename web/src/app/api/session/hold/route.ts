import { NextRequest, NextResponse } from 'next/server';
import { AUTH_ENABLED } from '@/lib/auth';
import { checkAnalyzeEligibility } from '@/lib/balanceCache';
import { resolveBillingContext } from '@/lib/billingContext';
import { createBillingTestHold } from '@/lib/billingTestSessionStore';
import { registerHoldSession } from '@/lib/holdSessionCache';
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

    // BYOK: hold 불필요 — 크레딧 차감 없음
    if (rawBody.byok === true) {
      if (context.kind === 'mock') {
        return NextResponse.json(
          { error: 'Mock billing test session requires held credits.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ hold_token: null, byok: true });
    }

    const estimatedCredits = rawBody.estimated_credits;
    const model = rawBody.model;
    const totalChunks = rawBody.total_chunks;

    if (typeof estimatedCredits !== 'number' || typeof model !== 'string' || typeof totalChunks !== 'number') {
      return NextResponse.json({ error: 'Missing required fields: estimated_credits, model, total_chunks' }, { status: 400 });
    }

    if (estimatedCredits <= 0) {
      return NextResponse.json({ error: 'estimated_credits must be greater than 0' }, { status: 400 });
    }

    if (context.kind === 'mock') {
      const data = createBillingTestHold(context.sessionId, estimatedCredits);
      if (!data) {
        return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 });
      }

      registerHoldSession(context.userId, data.holdToken, data.amount, data.expiresAt);
      console.log(`[session] mock hold created for ${context.userId}: token=${data.holdToken}, amount=${data.amount}`);

      return NextResponse.json({
        hold_token: data.holdToken,
        amount: data.amount,
        expires_at: data.expiresAt,
        balance_after: data.balanceAfter,
      });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Billing not available' }, { status: 400 });
    }

    // 잔액 확인 안전망
    const balanceError = await checkAnalyzeEligibility(userId, accessToken);
    if (balanceError) {
      return NextResponse.json({ error: balanceError }, { status: 402 });
    }

    const body = JSON.stringify({
      amount: estimatedCredits,
      metadata: typeof rawBody.metadata === 'object' && rawBody.metadata !== null ? rawBody.metadata : undefined,
      service: 'storygraph',
    });

    const response = await proxyToCatcident('/credits/hold/', accessToken, { method: 'POST', body });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(`[session] hold upstream error ${response.status}:`, errorBody);

      if (response.status === 402) {
        return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 });
      }
      return NextResponse.json(
        { error: 'Billing service error' },
        { status: response.status >= 500 ? 502 : response.status },
      );
    }

    let data: { hold_token: string; amount: number; expires_at: string; balance_after: number };
    try {
      data = await response.json();
    } catch {
      return NextResponse.json({ error: 'Invalid response from billing service' }, { status: 502 });
    }

    // hold 세션을 서버 캐시에 등록: analyze 요청은 hold_token으로 세션을 증명해야 함.
    registerHoldSession(userId, data.hold_token, data.amount, data.expires_at);
    console.log(`[session] hold created for user ${userId}: token=${data.hold_token}, amount=${data.amount}`);

    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error('[session] hold error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
