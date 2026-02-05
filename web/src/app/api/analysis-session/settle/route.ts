import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';
import { getAnalysisSession, deleteAnalysisSession } from '@/lib/analysisSession';
import { invalidateBalanceCache } from '@/lib/balanceCache';

// 크레딧 계산 상수 (catcident-backend StorygraphEstimator와 동기화)
const MARGIN = 3.0;
const USD_TO_KRW = 1400;
const KRW_PER_CREDIT = 10;

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.60 },
  'anthropic/claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
};

const DEFAULT_COST = { input: 1.0, output: 5.0 };

function calculateCredits(tokens: Array<{ promptTokens: number; completionTokens: number; model: string }>): number {
  if (tokens.length === 0) return 0;
  return tokens.reduce((sum, t) => {
    const costs = MODEL_COSTS[t.model] ?? DEFAULT_COST;
    const costUsd =
      (t.promptTokens / 1_000_000) * costs.input +
      (t.completionTokens / 1_000_000) * costs.output;
    return sum + Math.max(1, Math.ceil(costUsd * USD_TO_KRW * MARGIN / KRW_PER_CREDIT));
  }, 0);
}

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

    // 세션 정리
    deleteAnalysisSession(session_id);
    invalidateBalanceCache(authResult.userId);

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      console.error(`[billing] settle upstream error: ${response.status}`);
      return NextResponse.json({ error: 'Billing service error' }, { status });
    }

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
