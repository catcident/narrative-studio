import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = 'google/gemini-2.0-flash-lite-001';

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
  try {
    if (!API_KEY) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    const { prompt } = await request.json();

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error: `API error: ${response.status} - ${error}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
