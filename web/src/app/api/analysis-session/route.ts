import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';
import { createAnalysisSession } from '@/lib/analysisSession';
import { invalidateBalanceCache } from '@/lib/balanceCache';
import { estimateCreditsFromCharCount } from '@/lib/modelCosts';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { model, metadata } = body as {
      model?: string;
      metadata?: Record<string, unknown>;
    };

    if (!model || typeof model !== 'string') {
      return NextResponse.json({ error: 'model is required' }, { status: 400 });
    }

    const charCount = typeof metadata?.charCount === 'number' ? metadata.charCount : 0;
    if (charCount <= 0) {
      return NextResponse.json({ error: 'metadata.charCount is required' }, { status: 400 });
    }

    // 서버가 hold 금액 계산 (클라이언트 amount 무시)
    const amount = estimateCreditsFromCharCount(charCount, model);

    // Backend에 hold 요청
    const holdBody = JSON.stringify({
      service: 'storygraph',
      amount,
      metadata: metadata ?? {},
    });

    const response = await proxyToCatcident('/credits/hold/', authResult.accessToken, {
      method: 'POST',
      body: holdBody,
    });

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      const errorMsg = response.status === 402
        ? '크레딧이 부족합니다.'
        : 'Billing service error';
      return NextResponse.json({ error: errorMsg }, { status });
    }

    const holdResult = await response.json();

    // 서버 사이드 분석 세션 생성
    const sessionId = createAnalysisSession(
      authResult.userId,
      holdResult.hold_token,
      model,
    );

    // 잔액 캐시 무효화 (hold로 잔액이 변경됨)
    invalidateBalanceCache(authResult.userId);

    console.log(`[billing] analysis session started: session=${sessionId}, hold=${holdResult.hold_token}, amount=${amount}`);

    return NextResponse.json({
      session_id: sessionId,
      hold_token: holdResult.hold_token,
      amount: holdResult.amount,
      balance_after: holdResult.balance_after,
      expires_at: holdResult.expires_at,
    });
  } catch (error: unknown) {
    console.error('[billing] analysis-session start error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
