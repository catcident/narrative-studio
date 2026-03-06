import { NextRequest, NextResponse } from 'next/server';
import { resolveBillingContext } from '@/lib/billingContext';
import { getBillingTestSession } from '@/lib/billingTestSessionStore';
import { buildBillingTestBalance } from '@/lib/billingTestResponses';
import { billingGetHandler } from '@/services/billingProxy';

const fallbackGet = billingGetHandler('/credits/balance/?service=storygraph', 'credits/balance GET');

export async function GET(request: NextRequest) {
  const context = await resolveBillingContext(request);
  if ('error' in context) return context.error;

  if (context.kind === 'mock') {
    const session = getBillingTestSession(context.sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Mock billing session expired. Recreate it from /app/internal/billing-test.' },
        { status: 409 },
      );
    }
    return NextResponse.json(buildBillingTestBalance(session));
  }

  return fallbackGet();
}
