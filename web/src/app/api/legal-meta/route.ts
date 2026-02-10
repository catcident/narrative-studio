import { NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const CATCIDENT_API_URL = process.env.CATCIDENT_API_URL || 'https://catcident.com';
const PROXY_TIMEOUT_MS = 10000;

export async function GET() {
  const url = `${CATCIDENT_API_URL}/api/v1/legal/public/footer-meta/?lang=ko`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https',
        },
      },
      PROXY_TIMEOUT_MS,
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error('[legal-meta] upstream error:', response.status, errorBody);
      return NextResponse.json(
        { error: 'Legal meta service error' },
        { status: response.status >= 500 ? 502 : response.status },
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid response from legal meta service' },
        { status: 502 },
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error('[legal-meta] proxy error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
