/**
 * catcident-backend billing API 프록시 유틸리티 (서버 사이드)
 *
 * 사용 패턴:
 *   - proxyToCatcident(): 저수준 fetch 래퍼 (커스텀 로직 필요 시)
 *   - billingGetHandler(): GET 라우트 핸들러 (대부분의 GET 라우트에 사용)
 *   - billingPostHandler(): POST 라우트 핸들러 (deduct 등)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const CATCIDENT_API_URL = process.env.CATCIDENT_API_URL || 'http://caddy:8081';
const CATCIDENT_PUBLIC_API_URL = process.env.CATCIDENT_PUBLIC_API_URL || 'https://catcident.com';
const CATCIDENT_SERVICE_KEY = process.env.CATCIDENT_SERVICE_KEY || '';
const PROXY_TIMEOUT_MS = 15000;

interface ProxyOptions {
  method?: string;
  body?: string | null;
}

function uniqueBaseUrls(method: string): string[] {
  const primary = CATCIDENT_API_URL.replace(/\/+$/, '');
  const fallback = CATCIDENT_PUBLIC_API_URL.replace(/\/+$/, '');
  if (method !== 'GET' || primary === fallback) return [primary];
  return [primary, fallback];
}

export async function proxyToCatcident(
  path: string,
  accessToken: string | undefined,
  options: ProxyOptions = {}
): Promise<Response> {
  const { method = 'GET', body = null } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // 내부 Docker 통신 시 Django SECURE_SSL_REDIRECT 우회
    // (원본 요청은 HTTPS → Caddy → storygraph 경유이므로 사실을 전달)
    'X-Forwarded-Proto': 'https',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  if (CATCIDENT_SERVICE_KEY) {
    headers['X-Service-Key'] = CATCIDENT_SERVICE_KEY;
  }

  const baseUrls = uniqueBaseUrls(method);

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = baseUrls[index];
    const url = `${baseUrl}/api/v1/billing${path}`;
    const isFallback = index > 0;

    try {
      const response = await fetchWithTimeout(url, {
        method,
        headers,
        body: method !== 'GET' ? body : undefined,
      }, PROXY_TIMEOUT_MS);

      if (method === 'GET' && response.status >= 500 && !isFallback && baseUrls.length > 1) {
        console.error(`[billing] Primary upstream error ${response.status}: ${path}; retrying public fallback`);
        continue;
      }

      return response;
    } catch (err: unknown) {
      if (!isFallback && baseUrls.length > 1) {
        console.error(`[billing] Primary proxy error: ${path}; retrying public fallback`, err instanceof Error ? err.message : err);
        continue;
      }
      console.error(`[billing] Proxy error: ${path}`, err instanceof Error ? err.message : err);
      throw err;
    }
  }

  throw new Error(`Billing proxy failed without a response: ${path}`);
}

/** 업스트림 응답을 처리하여 NextResponse 반환 (에러 차단 + JSON 파싱) */
async function handleUpstreamResponse(response: Response, logLabel: string): Promise<NextResponse> {
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error(`[billing] ${logLabel} upstream error ${response.status}:`, errorBody);
    return NextResponse.json(
      { error: 'Billing service error' },
      { status: response.status >= 500 ? 502 : response.status }
    );
  }

  let data;
  try { data = await response.json(); }
  catch { return NextResponse.json({ error: 'Invalid response from billing service' }, { status: 502 }); }
  return NextResponse.json(data);
}

/**
 * GET 프록시 라우트 핸들러 팩토리
 * 대부분의 billing GET 라우트에서 공통으로 사용
 */
export function billingGetHandler(billingPath: string, logLabel: string) {
  return async function GET() {
    try {
      const authResult = await requireAuth();
      if ('error' in authResult) return authResult.error;

      const response = await proxyToCatcident(billingPath, authResult.accessToken);
      return handleUpstreamResponse(response, logLabel);
    } catch (err: unknown) {
      console.error(`[billing] ${logLabel} error:`, err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}

/** POST body 허용 필드 화이트리스트 */
const ALLOWED_POST_FIELDS: Record<string, string[]> = {
  '/credits/deduct/': ['amount', 'description', 'metadata', 'idempotency_key'],
  '/credits/hold/': ['amount', 'metadata'],
  '/credits/settle/': ['hold_token', 'actual_amount', 'description', 'metadata', 'idempotency_key'],
  '/credits/release/': ['hold_token'],
};

/**
 * POST 프록시 라우트 핸들러 팩토리
 * - 허용 필드만 화이트리스트로 추출
 * - service 필드를 서버에서 강제 주입
 * - 업스트림 에러 응답 차단
 */
export function billingPostHandler(billingPath: string, logLabel: string) {
  return async function POST(request: NextRequest) {
    try {
      const authResult = await requireAuth();
      if ('error' in authResult) return authResult.error;

      // body 파싱 + 화이트리스트 필터링
      let rawBody: Record<string, unknown>;
      try {
        rawBody = await request.json();
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      const allowedFields = ALLOWED_POST_FIELDS[billingPath];
      const filtered: Record<string, unknown> = { service: 'storygraph' };
      if (allowedFields) {
        for (const field of allowedFields) {
          if (rawBody[field] !== undefined) {
            filtered[field] = rawBody[field];
          }
        }
      } else {
        // 알 수 없는 경로: service만 강제, 나머지는 통과 (fail-open 설계)
        // 새 라우트 추가 시 ALLOWED_POST_FIELDS에 화이트리스트 등록 필요
        Object.assign(filtered, rawBody, { service: 'storygraph' });
      }

      const body = JSON.stringify(filtered);
      const response = await proxyToCatcident(billingPath, authResult.accessToken, { method: 'POST', body });
      return handleUpstreamResponse(response, logLabel);
    } catch (err: unknown) {
      console.error(`[billing] ${logLabel} error:`, err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}
