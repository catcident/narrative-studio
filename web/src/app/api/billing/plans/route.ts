/**
 * 요금제 목록 — 공개 엔드포인트 (인증 불필요)
 * 랜딩 페이지 PricingSection에서 비로그인 사용자도 조회해야 하므로
 * billingGetHandler (requireAuth 포함) 대신 직접 프록시
 */
import { NextResponse } from 'next/server';
import { proxyToCatcident } from '@/services/billingProxy';

export async function GET() {
  try {
    const response = await proxyToCatcident('/plans/?service=storygraph', undefined);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error('[billing] plans public GET upstream error:', response.status, errorBody);
      return NextResponse.json(
        { error: 'Billing service error' },
        { status: response.status >= 500 ? 502 : response.status },
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return NextResponse.json({ error: 'Invalid response from billing service' }, { status: 502 });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error('[billing] plans public GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
