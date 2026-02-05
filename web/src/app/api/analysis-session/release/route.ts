import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';
import { getAnalysisSession, deleteAnalysisSession } from '@/lib/analysisSession';
import { invalidateBalanceCache } from '@/lib/balanceCache';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { session_id } = body as { session_id?: string };

    if (!session_id) {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    }

    const session = getAnalysisSession(session_id, authResult.userId);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 404 });
    }

    const releaseBody = JSON.stringify({
      service: 'storygraph',
      hold_token: session.holdToken,
    });

    const response = await proxyToCatcident('/credits/release/', authResult.accessToken, {
      method: 'POST',
      body: releaseBody,
    });

    deleteAnalysisSession(session_id);
    invalidateBalanceCache(authResult.userId);

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      return NextResponse.json({ error: 'Billing service error' }, { status });
    }

    const result = await response.json();
    console.log(`[billing] analysis session released: session=${session_id}`);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[billing] analysis-session release error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
