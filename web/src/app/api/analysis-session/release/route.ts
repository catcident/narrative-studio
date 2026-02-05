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

    const { session_id } = body as { session_id?: string };

    if (!session_id) {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    }

    const session = getAnalysisSession(session_id, authResult.userId);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 404 });
    }

    let response: Response;

    if (session.tokens.length > 0) {
      // 토큰 사용 있음 → 부분 정산 (settle)
      const actualCredits = calculateCredits(session.tokens);
      console.log(`[billing] smart release: session=${session_id}, credits=${actualCredits}, chunks=${session.tokens.length}`);

      const settleBody = JSON.stringify({
        service: 'storygraph',
        hold_token: session.holdToken,
        actual_amount: actualCredits,
        description: '소설 분석 (부분)',
        metadata: { partial: true, chunks: session.tokens.length },
      });
      response = await proxyToCatcident('/credits/settle/', authResult.accessToken, {
        method: 'POST',
        body: settleBody,
      });
    } else {
      // 토큰 사용 없음 → 전액 환불 (release)
      const releaseBody = JSON.stringify({
        service: 'storygraph',
        hold_token: session.holdToken,
      });
      response = await proxyToCatcident('/credits/release/', authResult.accessToken, {
        method: 'POST',
        body: releaseBody,
      });
    }

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      return NextResponse.json({ error: 'Billing service error' }, { status });
    }

    // upstream 성공 확인 후 세션 정리 (실패 시 재시도 가능하도록)
    const hadTokens = session.tokens.length > 0;
    deleteAnalysisSession(session_id);
    invalidateBalanceCache(authResult.userId);

    const result = await response.json();
    console.log(`[billing] analysis session released: session=${session_id}, partial=${hadTokens}`);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[billing] analysis-session release error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
