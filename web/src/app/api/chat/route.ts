/**
 * 소설 채팅 API 엔드포인트
 * 스트리밍 응답 지원 + 토큰 정보 반환 (과금은 클라이언트 hold/settle 패턴)
 */

import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_MODEL } from '@/types';
import { AUTH_ENABLED, requireAuth } from '@/lib/auth';
import { checkAnalyzeEligibility, isCachedByokEnabled, getCachedPlanCode } from '@/lib/balanceCache';
import { checkRateLimit, getRateLimitForPlan } from '@/lib/rateLimit';
import {
  CHARS_PER_TOKEN,
  resolveTokenBilling,
} from '@/lib/modelCosts';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const ENV_API_KEY = process.env.OPENROUTER_API_KEY || '';

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

      // 토큰 정보만 반환 (과금은 클라이언트 hold/settle 패턴)
      const billing = resolveTokenBilling(data, totalPromptChars, '[chat]');
      if (billing) {
        data._billing = {
          ...billing,
          model,
          byok: isUsingPersonalKey || undefined,
        };
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
            // 스트림 종료 → 토큰 정보만 billing SSE 이벤트로 전송
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

                const billingEvent: Record<string, unknown> = {
                  prompt_tokens: promptTokens,
                  completion_tokens: completionTokens,
                  model,
                  byok: billingByok || undefined,
                };

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
