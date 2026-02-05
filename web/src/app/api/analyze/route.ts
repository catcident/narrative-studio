import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_MODEL } from '@/types';
import { checkAnalyzeEligibility } from '@/lib/balanceCache';
import { checkRateLimit } from '@/lib/rateLimit';
import { AUTH_ENABLED, getAuthUserId } from '@/lib/auth';
import { addSessionTokens, getActiveSessionIdByUserId } from '@/lib/analysisSession';
import { CHARS_PER_TOKEN } from '@/lib/modelCosts';

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

    // 서버 측 잔액 확인 (AUTH_ENABLED=true 시에만 활성)
    const balanceError = await checkAnalyzeEligibility();
    if (balanceError) {
      return NextResponse.json({ error: balanceError }, { status: 402 });
    }

    // userId 조회 (rate limit + 세션 추적 공용)
    let userId: string | null = null;
    if (AUTH_ENABLED) {
      userId = await getAuthUserId();
      if (userId) {
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
    }

    // 프롬프트 크기 로깅
    console.log(`[analyze] 모델: ${model}, 프롬프트 크기: ${prompt.length}자`);

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
      return NextResponse.json({ error: 'Analysis API request failed' }, { status: response.status });
    }

    const data = await response.json();

    // 토큰 사용량 결정: usage 필드 우선, 없으면 텍스트 길이에서 추정
    const billing = resolveTokenBilling(data, prompt.length);

    // 서버 측 토큰 누적 (userId 기반 자동 조회, 클라이언트 sessionId 무시)
    if (userId && userId !== 'anonymous') {
      const activeSessionId = getActiveSessionIdByUserId(userId);
      if (activeSessionId && billing) {
        addSessionTokens(activeSessionId, {
          promptTokens: billing.prompt_tokens,
          completionTokens: billing.completion_tokens,
          model,
        });
      }
    }

    // 클라이언트 UI용 billing 정보
    if (billing) {
      data._billing = billing;
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
