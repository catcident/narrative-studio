import { NextResponse } from 'next/server';
import { fetchStorygraphPublicPricing } from '@/lib/billingBackend';
import { getBillingMode } from '@/lib/billingMode';

export async function GET() {
  try {
    const data = await fetchStorygraphPublicPricing();
    return NextResponse.json({ ...data, billing_mode: getBillingMode() });
  } catch (err: unknown) {
    console.error('[billing] public-pricing GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Billing service error' }, { status: 502 });
  }
}
