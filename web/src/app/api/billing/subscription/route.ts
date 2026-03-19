import { NextRequest, NextResponse } from 'next/server';
import { fetchStorygraphSubscription } from '@/lib/billingBackend';
import { resolveBillingContext } from '@/lib/billingContext';
import { getBillingTestSession } from '@/lib/billingTestSessionStore';
import { buildBillingTestSubscription } from '@/lib/billingTestResponses';

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

  if (context.kind !== 'authenticated' || !context.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const subscription = await fetchStorygraphSubscription(context.accessToken);
    return NextResponse.json(subscription);
  } catch (err: unknown) {
    console.error('[billing] subscription GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Billing service error' }, { status: 502 });
  }
}
