import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_MODEL } from '@/types';
import { checkAnalyzeEligibility, updateBalanceCache } from '@/lib/balanceCache';
import { checkRateLimit } from '@/lib/rateLimit';
import { AUTH_ENABLED, requireAuth } from '@/lib/auth';
import { CHARS_PER_TOKEN, getModelCosts, tokenCostUsd, costUsdToCredits } from '@/lib/modelCosts';
import { getCachedModels } from '@/lib/modelCache';
import { proxyToCatcident } from '@/services/billingProxy';

const ENV_API_KEY = process.env.OPENROUTER_API_KEY || '';

const SYSTEM_PROMPT = `당신은 소설 세계관 분석 전문가입니다. 텍스트에서 인물, 장소, 물건, 세계관, 배경 정보를 빠짐없이 추출하여 "설정집"을 만듭니다.

규칙:
1. 텍스트에 명시된 정보만 추출 (추측 금지)
2. 인물의 모든 특성을 기록 (성별, 나이, 직업, 성격, 외모, 말투 등)
3. 인물 간 관계를 구체적으로 분석 (감정, 갈등, 신뢰 등)
4. 1인칭 화자("나")도 인물로 취급
5. 장소/건물/지역은 반드시 location 카테고리로 추출
6. 물건/아이템은 반드시 item 카테고리로 추출하고, 소유자/사용자 관계 필수
7. 세계관/시대배경/사회적 맥락은 concept 카테고리로 추출
8. JSON만 출력 (설명 없이)`;

// 타임아웃 유틸리티
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 120000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface TokenBilling {
  prompt_tokens: number;
  completion_tokens: number;
}

interface DeductResult {
  balance_after: number;
  amount_deducted: number;
}

/** usage 필드가 있으면 그대로 사용, 없으면 텍스트 길이에서 토큰 추정 */
function resolveTokenBilling(
  data: Record<string, unknown>,
  promptLength: number,
): TokenBilling | null {
  if (data.usage) {
    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number };
    return {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
    };
  }

  const content = (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content;
  if (!content) return null;

  const estimatedPrompt = Math.ceil(promptLength / CHARS_PER_TOKEN);
  const estimatedCompletion = Math.ceil(content.length / CHARS_PER_TOKEN);
  console.warn(`[analyze] usage 데이터 누락, 추정값 사용: prompt~${estimatedPrompt}, completion~${estimatedCompletion}`);

  return {
    prompt_tokens: estimatedPrompt,
    completion_tokens: estimatedCompletion,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, apiKey: userApiKey, model: userModel } = await request.json();

    // 사용자가 제공한 키 우선, 없으면 환경변수 키 사용
    const apiKey = userApiKey || ENV_API_KEY;
    // 사용자가 지정한 모델 사용, 없으면 기본 모델
    const model = userModel || DEFAULT_MODEL;

    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured. Please provide your OpenRouter API key.' }, { status: 400 });
    }

    // 인증 + 잔액 확인 + Rate Limit (AUTH_ENABLED=true 시에만 활성)
    let userId: string | null = null;
    let accessToken: string | undefined;
    if (AUTH_ENABLED) {
      const authResult = await requireAuth();
      if ('error' in authResult) {
        return authResult.error;
      }
      userId = authResult.userId;
      accessToken = authResult.accessToken;

      const balanceError = await checkAnalyzeEligibility(userId, accessToken);
      if (balanceError) {
        return NextResponse.json({ error: balanceError }, { status: 402 });
      }

      const limited = checkRateLimit(userId);
      if (limited) {
        return NextResponse.json(
          { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
          {
            status: 429,
            headers: { 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) },
          },
        );
      }
    }

    // 프롬프트 크기 로깅
    console.log(`[analyze] 모델: ${model}, 프롬프트 크기: ${prompt.length}자`);

    // billing 활성 시 모델 캐시 사전 워밍 (OpenRouter 호출과 병렬)
    const dynamicModelsPromise = userId ? getCachedModels() : null;

    const response = await fetchWithTimeout(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 16000,
        }),
      },
      120000  // 2분 타임아웃
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[analyze] API 오류: ${response.status} - ${errorBody.slice(0, 500)}`);

      // 클라이언트에는 제네릭 에러 반환 (상세는 서버 로그에만 기록)
      return NextResponse.json(
        { error: `AI API 오류 (${response.status})` },
        { status: response.status },
      );
    }

    const data = await response.json();

    // 토큰 사용량 결정: usage 필드 우선, 없으면 텍스트 길이에서 추정
    const billing = resolveTokenBilling(data, prompt.length);

    // 청크별 실시간 크레딧 차감
    let deductResult: DeductResult | null = null;
    let insufficientBalance = false;

    if (userId && userId !== 'anonymous' && billing) {
      const dynamicModels = dynamicModelsPromise ? await dynamicModelsPromise : [];
      const { inputCost, outputCost } = getModelCosts(model, dynamicModels);
      const credits = costUsdToCredits(
        tokenCostUsd(billing.prompt_tokens, billing.completion_tokens, inputCost, outputCost)
      );

      if (credits > 0) {
        try {
          const deductResponse = await proxyToCatcident('/credits/deduct/', accessToken, {
            method: 'POST',
            body: JSON.stringify({
              service: 'storygraph',
              amount: credits,
              description: '소설 분석 (청크)',
              metadata: { model, prompt_tokens: billing.prompt_tokens, completion_tokens: billing.completion_tokens },
            }),
          });

          if (deductResponse.ok) {
            const result: DeductResult = await deductResponse.json();
            deductResult = result;
            updateBalanceCache(userId, result.balance_after);
          } else if (deductResponse.status === 402) {
            insufficientBalance = true;
            console.warn(`[analyze] 잔액 부족으로 차감 실패 (사용량: ${credits}cr)`);
          } else {
            // Fail-open: 차감 실패해도 분석 데이터는 반환
            console.error(`[analyze] 차감 실패 (${deductResponse.status}), fail-open`);
          }
        } catch (err: unknown) {
          console.error('[analyze] 차감 네트워크 오류, fail-open:', err instanceof Error ? err.message : err);
        }
      }
    }

    // 클라이언트 UI용 billing 정보
    if (billing) {
      data._billing = {
        ...billing,
        credits_deducted: deductResult?.amount_deducted ?? 0,
        balance_after: deductResult?.balance_after ?? null,
        insufficient_balance: insufficientBalance,
      };
    }

    console.log(`[analyze] 응답 성공`);
    return NextResponse.json(data);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[analyze] 타임아웃 (2분 초과)`);
      return NextResponse.json({ error: 'API request timed out (2 minutes). Try with a smaller text.' }, { status: 504 });
    }
    console.error('[analyze] 오류:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
