import { NextRequest, NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { aiDisabledResponse, isAiEnabled } from '@/lib/aiAvailability';

// IP 기반 간단 Rate Limit (분당 10회)
const ipRequests = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = ipRequests.get(ip) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return true;
  recent.push(now);
  ipRequests.set(ip, recent);
  // 간단한 정리: 200 IP 초과 시 오래된 엔트리 삭제
  if (ipRequests.size > 200) {
    for (const [key, ts] of ipRequests) {
      if (ts.every(t => now - t > RATE_LIMIT_WINDOW_MS)) ipRequests.delete(key);
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  if (!isAiEnabled()) return aiDisabledResponse();

  // IP 기반 Rate Limit
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (checkIpRateLimit(ip)) {
    return NextResponse.json(
      { valid: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 },
    );
  }

  try {
    const { apiKey } = await request.json();

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json({ valid: false, error: 'API 키를 입력해주세요.' });
    }

    if (!apiKey.startsWith('sk-or-')) {
      return NextResponse.json({ valid: false, error: 'OpenRouter API 키는 sk-or-로 시작해야 합니다.' });
    }

    // OpenRouter /api/v1/models로 키 유효성 확인
    const response = await fetchWithTimeout(
      'https://openrouter.ai/api/v1/models',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      },
      10000,
    );

    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({ valid: false, error: '유효하지 않은 API 키입니다.' });
    }

    if (response.ok) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ valid: false, error: `API 검증 실패 (${response.status})` });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ valid: false, error: 'API 키 검증 시간 초과' });
    }
    console.error('[validate-key] 오류:', err instanceof Error ? err.message : err);
    return NextResponse.json({ valid: false, error: '키 검증 중 오류가 발생했습니다.' });
  }
}
