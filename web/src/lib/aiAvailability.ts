import 'server-only';

import { NextResponse } from 'next/server';

export function isAiEnabled(): boolean {
  return process.env.AI_ENABLED === 'true';
}

export function aiDisabledResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'AI features are currently disabled.',
      error_code: 'ai_disabled',
    },
    { status: 404 },
  );
}
