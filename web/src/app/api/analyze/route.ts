import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_MODEL } from '@/types';
import { checkAnalyzeEligibility, isCachedByokEnabled, getCachedPlanCode } from '@/lib/balanceCache';
import {
  hasActiveHoldSession,
  hasValidHoldSession as isValidHoldSession,
  reserveHoldSessionBudget,
  consumeHoldSessionBudget,
  refundHoldSessionBudget,
} from '@/lib/holdSessionCache';
import { checkRateLimit, getRateLimitForPlan } from '@/lib/rateLimit';
import { AUTH_ENABLED, requireAuth } from '@/lib/auth';
import { getCachedServerModels } from '@/lib/modelCache';
import { resolveTokenBilling, tokenCostUsd, getModelCosts, calculateChunkCostUsd, calculateMarkup, USD_TO_KRW } from '@/lib/serverCosts';
import { CHARS_PER_TOKEN, OUTPUT_RATIO } from '@/lib/modelCosts';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

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

export async function POST(request: NextRequest) {
  let reservedHoldKrw = 0;
  let refundUserId: string | null = null;
  let refundHoldToken: string | null = null;
  let refundHasValidHoldSession = false;
  const refundReservedBudget = () => {
    if (!AUTH_ENABLED || !refundUserId || !refundHoldToken || !refundHasValidHoldSession || reservedHoldKrw <= 0) return;
    refundHoldSessionBudget(refundUserId, refundHoldToken, reservedHoldKrw);
    reservedHoldKrw = 0;
  };

  try {
    const rawBody = await request.json() as {
      prompt: string;
      apiKey?: string;
      model?: string;
      holdToken?: string;
    };
    const prompt = rawBody.prompt;
    const userApiKey = rawBody.apiKey;
    const userModel = rawBody.model;
    const holdToken = typeof rawBody.holdToken === 'string' ? rawBody.holdToken : null;
    refundHoldToken = holdToken;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // 사용자가 제공한 키 우선, 없으면 환경변수 키 사용
    const apiKey = userApiKey || ENV_API_KEY;
    // 사용자가 지정한 모델 사용, 없으면 기본 모델
    const model = userModel || DEFAULT_MODEL;
    let cachedServerModels: Awaited<ReturnType<typeof getCachedServerModels>> | null = null;
    const getServerModels = async () => {
      if (!cachedServerModels) {
        cachedServerModels = await getCachedServerModels();
      }
      return cachedServerModels;
    };

    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured. Please provide your OpenRouter API key.' }, { status: 400 });
    }

    // 인증 + 잔액 확인 + Rate Limit (AUTH_ENABLED=true 시에만 활성)
    let userId: string | null = null;
    let accessToken: string | undefined;
    let hasValidHoldSession = false;
    if (AUTH_ENABLED) {
      const authResult = await requireAuth();
      if ('error' in authResult) {
        return authResult.error;
      }
      userId = authResult.userId;
      refundUserId = userId;
      accessToken = authResult.accessToken;

      if (holdToken) {
        hasValidHoldSession = isValidHoldSession(userId, holdToken);
        refundHasValidHoldSession = hasValidHoldSession;
        if (!hasValidHoldSession) {
          return NextResponse.json(
            { error: 'Invalid or expired hold session. Please restart analysis.' },
            { status: 403 },
          );
        }
      } else if (hasActiveHoldSession(userId)) {
        // hold가 살아있는 동안에는 hold_token 없는 analyze 호출을 차단해 무제한 호출을 방지
        return NextResponse.json(
          { error: 'Active hold session requires hold token.' },
          { status: 409 },
        );
      }

      if (!hasValidHoldSession) {
        const balanceError = await checkAnalyzeEligibility(userId, accessToken);
        if (balanceError) {
          return NextResponse.json({ error: balanceError }, { status: 402 });
        }
      } else {
        if (!holdToken) {
          return NextResponse.json({ error: 'Hold token is required for active hold session.' }, { status: 400 });
        }

        // preflight: 호출 전에 최소 필요 예산을 원자적으로 예약 (동시 호출 시 초과 사용 방지)
        const dynamicModels = await getServerModels();
        const { inputCost, outputCost } = getModelCosts(model, dynamicModels);
        const estPromptTokens = Math.ceil((prompt.length + SYSTEM_PROMPT.length) / CHARS_PER_TOKEN);
        const estCompletionTokens = Math.ceil(estPromptTokens * OUTPUT_RATIO);
        const estUsd = tokenCostUsd(estPromptTokens, estCompletionTokens, inputCost, outputCost);
        const refChunkCost = calculateChunkCostUsd(model, dynamicModels);
        const estKrw = estUsd * calculateMarkup(refChunkCost) * USD_TO_KRW;

        if (estKrw > 0) {
          const reserved = reserveHoldSessionBudget(userId, holdToken, estKrw);
          if (!reserved) {
            return NextResponse.json({ error: 'Insufficient held credits. Please resume with more credits.' }, { status: 402 });
          }
          reservedHoldKrw = estKrw;
        }
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

    // BYOK 판정: 사용자가 개인 키를 제공하고 그것이 서버 키와 다른 경우
    const isUsingPersonalKey = !!userApiKey && userApiKey !== ENV_API_KEY;

    // BYOK 권한 확인: AUTH_ENABLED이고 개인 키 사용 시 byok 플래그 필요
    if (AUTH_ENABLED && isUsingPersonalKey && userId) {
      const byokAllowed = isCachedByokEnabled(userId);
      if (!byokAllowed) {
        return NextResponse.json(
          { error: 'BYOK는 Pro 이상 플랜에서 사용 가능합니다.' },
          { status: 403 },
        );
      }
    }

    // 프롬프트 크기 로깅
    console.log(`[analyze] 모델: ${model}, 프롬프트 크기: ${prompt.length}자, BYOK: ${isUsingPersonalKey}`);

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
      refundReservedBudget();
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
    const billing = resolveTokenBilling(data, prompt.length, '[analyze]');

    // 클라이언트 UI용 billing 정보 (토큰 사용량만 — 차감은 세션 settle 시 일괄 처리)
    if (billing) {
      data._billing = {
        ...billing,
        model,
        byok: isUsingPersonalKey,
      };

      // hold 세션이면 호출 단위로 예산을 차감하여 무제한 호출을 방지
      if (AUTH_ENABLED && userId && holdToken && hasValidHoldSession) {
        const dynamicModels = await getServerModels();
        const { inputCost, outputCost } = getModelCosts(model, dynamicModels);
        const costUsd = tokenCostUsd(
          billing.prompt_tokens,
          billing.completion_tokens,
          inputCost,
          outputCost,
        );
        const refChunkCost = calculateChunkCostUsd(model, dynamicModels);
        const costKrw = costUsd * calculateMarkup(refChunkCost) * USD_TO_KRW;

        let budget: { remainingKrw: number; remainingCredits: number } | null = null;
        if (reservedHoldKrw > 0) {
          const deltaKrw = costKrw - reservedHoldKrw;
          if (deltaKrw > 0) {
            budget = consumeHoldSessionBudget(userId, holdToken, deltaKrw);
          } else if (deltaKrw < 0) {
            budget = refundHoldSessionBudget(userId, holdToken, -deltaKrw);
          } else {
            budget = consumeHoldSessionBudget(userId, holdToken, 0);
          }
          reservedHoldKrw = 0;
        } else {
          // 예약 없이 들어온 경로(호환성)에서도 예산 차감 유지
          budget = consumeHoldSessionBudget(userId, holdToken, costKrw);
        }

        if (budget) {
          data._billing.hold_remaining_credits = budget.remainingCredits;
        }
      }
    } else {
      refundReservedBudget();
    }

    const content = data.choices?.[0]?.message?.content;
    const isString = typeof content === 'string';
    const contentLen = isString ? content.length : 0;
    let isJson = false;
    if (isString) {
      try {
        JSON.parse(content);
        isJson = true;
      } catch {
        // JSON이 아님 — 클라이언트에서 tryFixJson으로 복구 시도
      }
    }
    console.log(`[analyze] 응답 성공 (model=${model}, content_length=${contentLen}, is_json=${isJson})`);
    if (isString && !isJson) {
      console.warn(`[analyze] 비-JSON 응답 prefix: ${content.slice(0, 200)}`);
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    refundReservedBudget();
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[analyze] 타임아웃 (2분 초과)`);
      return NextResponse.json({ error: 'API request timed out (2 minutes). Try with a smaller text.' }, { status: 504 });
    }
    console.error('[analyze] 오류:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
