import { NextResponse } from 'next/server';
import { getCachedClientModels } from '@/lib/modelCache';
import { aiDisabledResponse, isAiEnabled } from '@/lib/aiAvailability';

export async function GET() {
  if (!isAiEnabled()) return aiDisabledResponse();

  try {
    const models = await getCachedClientModels();
    return NextResponse.json({ models });
  } catch (err: unknown) {
    console.error('[models] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load models' }, { status: 500 });
  }
}
