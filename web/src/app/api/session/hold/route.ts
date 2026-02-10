import { NextRequest, NextResponse } from 'next/server';
import { AUTH_ENABLED, requireAuth } from '@/lib/auth';
import { checkAnalyzeEligibility } from '@/lib/balanceCache';
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

    // BYOK: hold 불필요 — 크레딧 차감 없음
    if (rawBody.byok === true) {
      return NextResponse.json({ hold_token: null, byok: true });
    }

    const estimatedCredits = rawBody.estimated_credits;
    const model = rawBody.model;
    const totalChunks = rawBody.total_chunks;

    if (typeof estimatedCredits !== 'number' || typeof model !== 'string' || typeof totalChunks !== 'number') {
      return NextResponse.json({ error: 'Missing required fields: estimated_credits, model, total_chunks' }, { status: 400 });
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

    // balanceCache는 hold 후 갱신하지 않음:
    // hold가 잔액을 0으로 만들어도, 해당 세션의 analyze 호출은 held 크레딧으로 진행되어야 함.
    // 캐시에 0을 기록하면 자기 세션의 첫 analyze 호출이 차단됨.
    // settle/release 라우트에서 최종 잔액으로 캐시 갱신.
    console.log(`[session] hold created for user ${userId}: token=${data.hold_token}, amount=${data.amount}`);

    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error('[session] hold error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
