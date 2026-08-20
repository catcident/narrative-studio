import { NextResponse } from 'next/server';
import { isAiEnabled } from '@/lib/aiAvailability';
import { connectMongo, isMongoTransactionRuntimeConfigured } from '@/lib/mongo';
import {
  isWithdrawalRuntimeConfigured,
  isWithdrawalSubjectRuntimeConfigured,
} from '@/lib/withdrawalConfig';

export async function GET() {
  const aiEnabled = isAiEnabled();
  const hasEnvKey = aiEnabled && !!process.env.OPENROUTER_API_KEY;
  const authEnabled = process.env.AUTH_ENABLED !== 'false';
  let persistentWritesReady = isWithdrawalSubjectRuntimeConfigured()
    && isMongoTransactionRuntimeConfigured();
  if (persistentWritesReady) {
    try {
      await connectMongo();
    } catch (error: unknown) {
      console.error('[config] MongoDB readiness check failed:', error instanceof Error ? error.message : error);
      persistentWritesReady = false;
    }
  }
  const serviceReady = persistentWritesReady
    && (!authEnabled || isWithdrawalRuntimeConfigured());
  return NextResponse.json(
    { aiEnabled, hasEnvKey, authEnabled, serviceReady },
    { status: serviceReady ? 200 : 503 },
  );
}
