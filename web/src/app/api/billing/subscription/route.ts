import { NextRequest, NextResponse } from 'next/server';
import { resolveBillingContext } from '@/lib/billingContext';
import { getBillingTestSession } from '@/lib/billingTestSessionStore';
import { buildBillingTestSubscription } from '@/lib/billingTestResponses';
import { billingGetHandler } from '@/services/billingProxy';

const fallbackGet = billingGetHandler('/subscription/?service=storygraph', 'subscription GET');

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
    return NextResponse.json(buildBillingTestSubscription(session));
  }

  return fallbackGet();
}
