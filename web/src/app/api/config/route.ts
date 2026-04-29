import { NextResponse } from 'next/server';
import { getBillingMode } from '@/lib/billingMode';

export async function GET() {
  const hasEnvKey = !!process.env.OPENROUTER_API_KEY;
  const authEnabled = process.env.AUTH_ENABLED !== 'false';
  return NextResponse.json({ hasEnvKey, authEnabled, billingMode: getBillingMode() });
}
