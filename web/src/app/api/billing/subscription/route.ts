import { NextRequest, NextResponse } from 'next/server';
import { ensureStorygraphSubscription, isConfigBillingBackendError } from '@/lib/billingBackend';
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
    const subscription = await ensureStorygraphSubscription(context.accessToken);
    return NextResponse.json(subscription);
  } catch (err: unknown) {
    if (isConfigBillingBackendError(err)) {
      console.error('[billing] subscription GET config error:', err.message);
      return NextResponse.json({ error: 'Billing configuration error' }, { status: 502 });
    }
    console.error('[billing] subscription GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Billing service error' }, { status: 502 });
  }
}
