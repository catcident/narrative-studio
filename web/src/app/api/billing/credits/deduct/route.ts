import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;

    const body = await request.text();
    const response = await proxyToCatcident(
      '/credits/deduct/',
      authResult.accessToken,
      { method: 'POST', body }
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[billing] credits/deduct POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
