import { NextRequest, NextResponse } from 'next/server';
import { AUTH_ENABLED, requireAuth } from '@/lib/auth';
import { updateBalanceCache } from '@/lib/balanceCache';
import { checkRateLimit } from '@/lib/rateLimit';
import { proxyToCatcident } from '@/services/billingProxy';
import { tokenCostUsd, getModelCosts, calculateChunkCostUsd, calculateSessionCredits } from '@/lib/modelCosts';
import { getCachedModels } from '@/lib/modelCache';

interface ChunkUsage {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
}

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
    const chunks = rawBody.chunks;

    // BYOK: hold_token이 null이면 차감 없이 반환
    if (holdToken === null) {
      return NextResponse.json({
        balance_after: null,
        amount_deducted: 0,
        refunded: 0,
        actual_credits: 0,
        byok: true,
      });
    }

    if (typeof holdToken !== 'string') {
      return NextResponse.json({ error: 'Missing required field: hold_token' }, { status: 400 });
    }

    if (!Array.isArray(chunks) || chunks.length === 0) {
      return NextResponse.json({ error: 'Missing required field: chunks (non-empty array)' }, { status: 400 });
    }

    // 서버가 금액 재계산 — 클라이언트 값 무시
    const dynamicModels = await getCachedModels();
    let totalSessionCostUsd = 0;
    const validatedChunks = chunks as ChunkUsage[];

    for (const chunk of validatedChunks) {
      if (typeof chunk.model !== 'string' || typeof chunk.prompt_tokens !== 'number' || typeof chunk.completion_tokens !== 'number') {
        return NextResponse.json({ error: 'Invalid chunk format: each chunk needs model, prompt_tokens, completion_tokens' }, { status: 400 });
      }
      const costs = getModelCosts(chunk.model, dynamicModels);
      totalSessionCostUsd += tokenCostUsd(chunk.prompt_tokens, chunk.completion_tokens, costs.inputCost, costs.outputCost);
    }

    // 마크업은 첫 번째 chunk의 모델 기준 (추출 모델)
    const firstChunk = validatedChunks[0];
    const chunkCostUsd = calculateChunkCostUsd(firstChunk.model, dynamicModels);
    const actualCredits = calculateSessionCredits(totalSessionCostUsd, chunkCostUsd);

    const body = JSON.stringify({
      hold_token: holdToken,
      actual_amount: actualCredits,
      description: typeof rawBody.description === 'string' ? rawBody.description : undefined,
      metadata: typeof rawBody.metadata === 'object' && rawBody.metadata !== null ? rawBody.metadata : undefined,
      idempotency_key: typeof rawBody.idempotency_key === 'string'
        ? rawBody.idempotency_key
        : `settle_${holdToken}`,
      service: 'storygraph',
    });

    const response = await proxyToCatcident('/credits/settle/', accessToken, { method: 'POST', body });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(`[session] settle upstream error ${response.status}:`, errorBody);
      return NextResponse.json(
        { error: 'Billing service error' },
        { status: response.status >= 500 ? 502 : response.status },
      );
    }

    let data: { balance_after: number; amount_deducted: number; refunded: number };
    try {
      data = await response.json();
    } catch {
      return NextResponse.json({ error: 'Invalid response from billing service' }, { status: 502 });
    }

    updateBalanceCache(userId, data.balance_after);
    console.log(`[session] settle for user ${userId}: deducted=${data.amount_deducted}, refunded=${data.refunded}, actual_credits=${actualCredits}`);

    return NextResponse.json({ ...data, actual_credits: actualCredits });
  } catch (err: unknown) {
    console.error('[session] settle error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
