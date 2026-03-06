import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveBillingContext } from '@/lib/billingContext';
import { buildBillingTestTransactions } from '@/lib/billingTestResponses';
import { proxyToCatcident } from '@/services/billingProxy';

export async function GET(request: NextRequest) {
  try {
    const context = await resolveBillingContext(request);
    if ('error' in context) return context.error;

    if (context.kind === 'mock') {
      return NextResponse.json(buildBillingTestTransactions());
    }

    let accessToken = context.kind === 'authenticated' ? context.accessToken : undefined;
    if (context.kind === 'none') {
      const authResult = await requireAuth();
      if ('error' in authResult) return authResult.error;
      accessToken = authResult.accessToken;
    }

    const { searchParams } = new URL(request.url);
    const pageRaw = searchParams.get('page') || '1';
    const pageNum = parseInt(pageRaw, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > 10000) {
      return NextResponse.json({ error: 'Invalid page parameter' }, { status: 400 });
    }
    const response = await proxyToCatcident(
      `/credits/transactions/?service=storygraph&page=${pageNum}`,
      accessToken
    );
    const data = await response.json().catch(() => ({ error: 'Invalid response from billing service' }));
    return NextResponse.json(data, { status: response.status });
  } catch (err: unknown) {
    console.error('[billing] credits/transactions GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
