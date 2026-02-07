/**
 * 소설 채팅 API 엔드포인트
 * 스트리밍 응답 지원 + 서버 사이드 과금 (/api/analyze 패턴)
 */

import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_MODEL } from '@/types';
import { AUTH_ENABLED, requireAuth } from '@/lib/auth';
import { checkAnalyzeEligibility, updateBalanceCache, isCachedByokEnabled, getCachedPlanCode } from '@/lib/balanceCache';
import { checkRateLimit, getRateLimitForPlan } from '@/lib/rateLimit';
import { getCachedModels } from '@/lib/modelCache';
import {
  getModelCosts, tokenCostUsd, costUsdToCredits, CHARS_PER_TOKEN,
  resolveTokenBilling, type DeductResult,
} from '@/lib/modelCosts';
import { proxyToCatcident } from '@/services/billingProxy';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const ENV_API_KEY = process.env.OPENROUTER_API_KEY || '';

/** 토큰 기반 크레딧 차감 (스트리밍/비스트리밍 공용) */
async function deductForTokens(
  promptTokens: number,
  completionTokens: number,
  model: string,
  userId: string,
  accessToken: string | undefined,
  dynamicModelsPromise: Promise<import('@/types').ModelInfo[]> | null,
  logPrefix: string,
): Promise<{ deductResult: DeductResult | null; insufficientBalance: boolean }> {
  const dynamicModels = dynamicModelsPromise ? await dynamicModelsPromise : [];
  const { inputCost, outputCost } = getModelCosts(model, dynamicModels);
  const credits = costUsdToCredits(
    tokenCostUsd(promptTokens, completionTokens, inputCost, outputCost),
    model,
    dynamicModels,
  );

  let deductResult: DeductResult | null = null;
  let insufficientBalance = false;

  if (credits > 0) {
    try {
      const deductResponse = await proxyToCatcident('/credits/deduct/', accessToken, {
        method: 'POST',
        body: JSON.stringify({
          service: 'storygraph',
          amount: credits,
          description: '소설 채팅',
          metadata: { model, prompt_tokens: promptTokens, completion_tokens: completionTokens },
        }),
      });

      if (deductResponse.ok) {
        const result: DeductResult = await deductResponse.json();
        deductResult = result;
        updateBalanceCache(userId, result.balance_after);
      } else if (deductResponse.status === 402) {
        insufficientBalance = true;
        console.warn(`${logPrefix} 잔액 부족으로 차감 실패 (사용량: ${credits}cr)`);
      } else {
        console.error(`${logPrefix} 차감 실패 (${deductResponse.status}), fail-open`);
      }
    } catch (err: unknown) {
      console.error(`${logPrefix} 차감 네트워크 오류, fail-open:`, err instanceof Error ? err.message : err);
    }
  }

  return { deductResult, insufficientBalance };
}

/** 비스트리밍 응답에 대해 크레딧 차감 수행 + _billing 필드 추가 */
async function deductCreditsForResponse(
  data: Record<string, unknown>,
  promptLength: number,
  model: string,
  userId: string,
  accessToken: string | undefined,
  dynamicModelsPromise: Promise<import('@/types').ModelInfo[]> | null,
  logPrefix: string,
): Promise<{ deductResult: DeductResult | null; insufficientBalance: boolean }> {
  const billing = resolveTokenBilling(data, promptLength, logPrefix);

  if (!userId || userId === 'anonymous' || !billing) {
    return { deductResult: null, insufficientBalance: false };
  }

  const result = await deductForTokens(
    billing.prompt_tokens, billing.completion_tokens,
    model, userId, accessToken, dynamicModelsPromise, logPrefix,
  );

  data._billing = {
    ...billing,
    credits_deducted: result.deductResult?.amount_deducted ?? 0,
    balance_after: result.deductResult?.balance_after ?? null,
    insufficient_balance: result.insufficientBalance,
    model,
  };

  return result;
}

export async function POST(request: NextRequest) {
  console.log('[chat] POST 요청 수신');
  try {
    const { messages, apiKey: userApiKey, model: userModel, stream: userStream } = await request.json();

    const apiKey = userApiKey || ENV_API_KEY;
    const model = userModel || DEFAULT_MODEL;
    const stream = userStream !== false;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API 키가 설정되지 않았습니다.' },
        { status: 400 },
      );
    }

    // 인증 + 잔액 확인 + Rate Limit (AUTH_ENABLED=true 시에만)
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

      const planCode = getCachedPlanCode(userId);
      const limited = checkRateLimit(userId, getRateLimitForPlan(planCode));
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

    // BYOK 판정
    const isUsingPersonalKey = !!userApiKey && userApiKey !== ENV_API_KEY;

    // BYOK 권한 확인
    if (AUTH_ENABLED && isUsingPersonalKey && userId) {
      const byokAllowed = isCachedByokEnabled(userId);
      if (!byokAllowed) {
        return NextResponse.json(
          { error: 'BYOK는 Pro 이상 플랜에서 사용 가능합니다.' },
          { status: 403 },
        );
      }
    }

    // 프롬프트 크기 계산 (billing용)
    const totalPromptChars = (messages as Array<{ content?: string }>).reduce(
      (sum: number, m) => sum + (m.content?.length || 0), 0,
    );

    console.log(`[chat] 모델: ${model}, 메시지 수: ${messages.length}, 스트리밍: ${stream}, 프롬프트: ${totalPromptChars}자, BYOK: ${isUsingPersonalKey}`);

    // billing 활성 시 모델 캐시 사전 워밍 (OpenRouter 호출과 병렬)
    const dynamicModelsPromise = userId ? getCachedModels() : null;

    const response = await fetchWithTimeout(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': request.headers.get('referer') || 'https://storygraph.catcident.com',
          'X-Title': 'StoryGraph Chat',
        },
        body: JSON.stringify({
          model,
          messages,
          stream,
          temperature: 0.7,
          max_tokens: 2000,
        }),
      },
      120000,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[chat] API 오류: ${response.status} - ${errorBody.slice(0, 500)}`);
      return NextResponse.json(
        { error: `API 오류: ${response.status}` },
        { status: response.status },
      );
    }

    // ========== 비스트리밍 경로 ==========
    if (!stream) {
      const data = await response.json();

      if (isUsingPersonalKey) {
        // BYOK: 차감 스킵, billing 정보만 추가
        const billing = resolveTokenBilling(data, totalPromptChars, '[chat]');
        if (billing) {
          data._billing = {
            ...billing,
            credits_deducted: 0,
            balance_after: null,
            insufficient_balance: false,
            byok: true,
            model,
          };
        }
      } else {
        await deductCreditsForResponse(
          data, totalPromptChars, model, userId ?? '', accessToken, dynamicModelsPromise, '[chat]',
        );
      }

      return NextResponse.json(data);
    }

    // ========== 스트리밍 경로 ==========
    if (!response.body) {
      return NextResponse.json(
        { error: '스트리밍 응답 수신 실패' },
        { status: 502 },
      );
    }

    const upstreamReader = response.body.getReader();
    const decoder = new TextDecoder();

    // 스트림 완료 후 billing 처리를 위한 축적 변수
    let accumulatedText = '';
    let streamUsage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
    // SSE 라인 버퍼: TCP 세그먼트 경계에서 잘린 불완전한 행 처리
    let lineBuffer = '';

    // 로컬 상수로 캡처 (non-null assertion 방지)
    const billingUserId = userId;
    const billingByok = isUsingPersonalKey;

    const outputStream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await upstreamReader.read();
          if (done) {
            // 스트림 종료 → billing 처리 후 billing SSE 이벤트 추가
            if (billingUserId && billingUserId !== 'anonymous') {
              try {
                let promptTokens: number;
                let completionTokens: number;

                if (streamUsage?.prompt_tokens != null && streamUsage?.completion_tokens != null) {
                  promptTokens = streamUsage.prompt_tokens;
                  completionTokens = streamUsage.completion_tokens;
                } else {
                  promptTokens = Math.ceil(totalPromptChars / CHARS_PER_TOKEN);
                  completionTokens = Math.ceil(accumulatedText.length / CHARS_PER_TOKEN);
                  console.warn(`[chat] 스트리밍 usage 누락, 추정값 사용: prompt~${promptTokens}, completion~${completionTokens}`);
                }

                let billingEvent: Record<string, unknown>;

                if (billingByok) {
                  // BYOK: 차감 스킵
                  billingEvent = {
                    prompt_tokens: promptTokens,
                    completion_tokens: completionTokens,
                    model,
                    credits_deducted: 0,
                    balance_after: null,
                    insufficient_balance: false,
                    byok: true,
                  };
                } else {
                  const { deductResult, insufficientBalance } = await deductForTokens(
                    promptTokens, completionTokens,
                    model, billingUserId, accessToken, dynamicModelsPromise, '[chat]',
                  );
                  billingEvent = {
                    prompt_tokens: promptTokens,
                    completion_tokens: completionTokens,
                    model,
                    credits_deducted: deductResult?.amount_deducted ?? 0,
                    balance_after: deductResult?.balance_after ?? null,
                    insufficient_balance: insufficientBalance,
                  };
                }

                const sseEvent = `event: billing\ndata: ${JSON.stringify(billingEvent)}\n\n`;
                controller.enqueue(new TextEncoder().encode(sseEvent));
              } catch (err: unknown) {
                console.error('[chat] 스트리밍 billing 처리 오류:', err instanceof Error ? err.message : err);
              }
            }

            controller.close();
            return;
          }

          // 클라이언트에 데이터 그대로 전달
          controller.enqueue(value);

          // 응답 텍스트 축적 + usage 감지 (라인 버퍼 사용)
          const rawText = lineBuffer + decoder.decode(value, { stream: true });
          const lines = rawText.split('\n');
          // 마지막 요소는 불완전할 수 있으므로 버퍼에 보관
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                accumulatedText += content;
              }
              if (parsed.usage) {
                streamUsage = parsed.usage;
              }
            } catch {
              // JSON 파싱 실패 무시
            }
          }
        } catch (err: unknown) {
          console.error('[chat] 스트림 읽기 오류:', err instanceof Error ? err.message : err);
          controller.error(err);
        }
      },
      cancel() {
        upstreamReader.cancel();
      },
    });

    return new Response(outputStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[chat] 타임아웃 (2분 초과)');
      return NextResponse.json({ error: 'API 요청 시간 초과 (2분). 잠시 후 다시 시도해주세요.' }, { status: 504 });
    }
    console.error('[chat] 서버 오류:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
