import { NextResponse } from 'next/server';
import { getCachedModels } from '@/lib/modelCache';

export async function GET() {
  try {
    const models = await getCachedModels();
    return NextResponse.json({ models });
  } catch (err: unknown) {
    console.error('[models] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load models' }, { status: 500 });
  }
}
