/**
 * 소설 채팅 API 엔드포인트
 * 스트리밍 응답 지원
 */

import { NextRequest } from 'next/server';

const ENV_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

export async function POST(request: NextRequest) {
  try {
    const { messages, apiKey: userApiKey, model: userModel } = await request.json();

    // 사용자가 제공한 키 우선, 없으면 환경변수 키 사용
    const apiKey = userApiKey || ENV_API_KEY;
    const model = userModel || DEFAULT_MODEL;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API 키가 설정되지 않았습니다.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[chat] 모델: ${model}, 메시지 수: ${messages.length}`);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
        stream: true,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[chat] API 오류: ${response.status} - ${error.slice(0, 500)}`);
      return new Response(
        JSON.stringify({ error: `API 오류: ${response.status}` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 스트리밍 응답 전달
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[chat] 서버 오류:', err);
    return new Response(
      JSON.stringify({ error: '서버 오류가 발생했습니다.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
