/**
 * catcident-backend billing API 프록시 유틸리티 (서버 사이드)
 *
 * 사용 패턴:
 *   - proxyToCatcident(): 저수준 fetch 래퍼 (커스텀 로직 필요 시)
 *   - billingGetHandler(): GET 라우트 핸들러 (대부분의 GET 라우트에 사용)
 *   - billingPostHandler(): POST 라우트 핸들러 (estimate, deduct 등)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

const CATCIDENT_API_URL = process.env.CATCIDENT_API_URL || 'https://catcident.com';
const CATCIDENT_SERVICE_KEY = process.env.CATCIDENT_SERVICE_KEY || '';

interface ProxyOptions {
  method?: string;
  body?: string | null;
}

export async function proxyToCatcident(
  path: string,
  accessToken: string | undefined,
  options: ProxyOptions = {}
): Promise<Response> {
  const { method = 'GET', body = null } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  if (CATCIDENT_SERVICE_KEY) {
    headers['X-Service-Key'] = CATCIDENT_SERVICE_KEY;
  }

  const url = `${CATCIDENT_API_URL}/api/v1/billing${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? body : undefined,
      signal: AbortSignal.timeout(15000),
    });

    return response;
  } catch (error) {
    console.error(`[billing] Proxy error: ${path}`, error);
    throw error;
  }
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
      let data;
      try { data = await response.json(); }
      catch { return NextResponse.json({ error: 'Invalid response from billing service' }, { status: 502 }); }
      return NextResponse.json(data, { status: response.status });
    } catch (error) {
      console.error(`[billing] ${logLabel} error:`, error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}

/**
 * POST 프록시 라우트 핸들러 팩토리
 * estimate, deduct 등 POST 라우트에서 공통으로 사용
 */
export function billingPostHandler(billingPath: string, logLabel: string) {
  return async function POST(request: NextRequest) {
    try {
      const authResult = await requireAuth();
      if ('error' in authResult) return authResult.error;

      const body = await request.text();
      const response = await proxyToCatcident(billingPath, authResult.accessToken, { method: 'POST', body });
      let data;
      try { data = await response.json(); }
      catch { return NextResponse.json({ error: 'Invalid response from billing service' }, { status: 502 }); }
      return NextResponse.json(data, { status: response.status });
    } catch (error) {
      console.error(`[billing] ${logLabel} error:`, error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}
