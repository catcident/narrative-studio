import { NextRequest, NextResponse } from 'next/server';

const ENV_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

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
          model: model,
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

    // usage 데이터를 _billing 필드로 클라이언트에 전달
    if (data.usage) {
      data._billing = {
        prompt_tokens: data.usage.prompt_tokens || 0,
        completion_tokens: data.usage.completion_tokens || 0,
      };
    }

    console.log(`[analyze] 응답 성공`);
    return NextResponse.json(data);
  } catch (err) {
    const error = err as Error;
    if (error.name === 'AbortError') {
      console.error(`[analyze] 타임아웃 (2분 초과)`);
      return NextResponse.json({ error: 'API request timed out (2 minutes). Try with a smaller text.' }, { status: 504 });
    }
    console.error(`[analyze] 오류: ${error.message}`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
