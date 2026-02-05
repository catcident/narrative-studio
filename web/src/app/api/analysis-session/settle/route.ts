import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';
import { getAnalysisSession, deleteAnalysisSession } from '@/lib/analysisSession';
import { invalidateBalanceCache } from '@/lib/balanceCache';
import { calculateCredits } from '@/lib/modelCosts';

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

    const { session_id, title, idempotency_key } = body as {
      session_id?: string;
      title?: string;
      idempotency_key?: string;
    };

    if (!session_id) {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    }

    // 세션 조회 + userId 검증
    const session = getAnalysisSession(session_id, authResult.userId);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 404 });
    }

    // 서버 측 크레딧 계산 (클라이언트 금액 불신)
    const actualCredits = calculateCredits(session.tokens);
    const models = [...new Set(session.tokens.map(t => t.model))];
    const totalTokens = session.tokens.reduce(
      (sum, t) => sum + t.promptTokens + t.completionTokens, 0
    );

    // Backend settle 요청
    const settleBody = JSON.stringify({
      service: 'storygraph',
      hold_token: session.holdToken,
      actual_amount: actualCredits,
      description: title ? `소설 분석: ${title}` : '소설 분석',
      metadata: { models, chunks: session.tokens.length, totalTokens },
      idempotency_key: idempotency_key ?? null,
    });

    const response = await proxyToCatcident('/credits/settle/', authResult.accessToken, {
      method: 'POST',
      body: settleBody,
    });

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      console.error(`[billing] settle upstream error: ${response.status}`);
      return NextResponse.json({ error: 'Billing service error' }, { status });
    }

    // upstream 성공 확인 후 세션 정리 (실패 시 재시도 가능하도록)
    deleteAnalysisSession(session_id);
    invalidateBalanceCache(authResult.userId);

    const result = await response.json();

    console.log(
      `[billing] analysis session settled: session=${session_id}, actual=${actualCredits}, refunded=${result.refunded ?? 0}`,
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[billing] analysis-session settle error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
