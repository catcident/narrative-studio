import { NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import type { LegalFooterMeta } from '@/types/legalMeta';

const CATCIDENT_API_URL = process.env.CATCIDENT_API_URL || 'https://catcident.com';
const PROXY_TIMEOUT_MS = 10000;

const FALLBACK_META: LegalFooterMeta = {
  schema_version: 2,
  company: {
    name: '고양이의만행 주식회사',
    registration_number: '704-87-03148',
    representative: '이레이다',
    address: '서울특별시 관악구 인헌1다길 49, 201호',
    phone: '010-7977-8051',
    email: 'support@catcident.com',
    fax: '',
    ecommerce_registration_number: '',
    reporting_authority: '',
    extra_disclosure: '',
    updated_at: null,
  },
  links: {
    terms: 'https://catcident.com/ko/legal/terms/',
    privacy: 'https://catcident.com/ko/legal/privacy/',
    marketing: 'https://catcident.com/ko/legal/marketing/',
    business_info: 'https://catcident.com/ko/legal/terms/#business-info',
  },
};

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
      return NextResponse.json(FALLBACK_META, {
        headers: { 'X-Fallback': 'true' },
      });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      console.error('[legal-meta] invalid JSON from upstream');
      return NextResponse.json(FALLBACK_META, {
        headers: { 'X-Fallback': 'true' },
      });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error('[legal-meta] proxy error:', err instanceof Error ? err.message : err);
    return NextResponse.json(FALLBACK_META, {
      headers: { 'X-Fallback': 'true' },
    });
  }
}
