import { NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import type { LegalFooterMeta } from '@/types/legalMeta';

const CATCIDENT_API_URL = process.env.CATCIDENT_API_URL || 'http://caddy:8081';
const CATCIDENT_PUBLIC_API_URL = process.env.CATCIDENT_PUBLIC_API_URL || 'https://catcident.com';
const PROXY_TIMEOUT_MS = 10000;

const FALLBACK_META: LegalFooterMeta = {
  schema_version: 2,
  company: {
    name: '고양이의만행 주식회사',
    registration_number: '704-87-03148',
    representative: '이레이다',
    address: '서울특별시 관악구 인헌1다길 49, 201호(봉천동)',
    phone: '010-7977-8051',
    email: 'info@catcident.com',
    fax: '',
    ecommerce_registration_number: '제2026-서울관악-0511호',
    reporting_authority: '서울특별시 관악구청',
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
  const primary = CATCIDENT_API_URL.replace(/\/+$/, '');
  const fallback = CATCIDENT_PUBLIC_API_URL.replace(/\/+$/, '');
  const baseUrls = primary === fallback ? [primary] : [primary, fallback];

  for (let index = 0; index < baseUrls.length; index += 1) {
    const url = `${baseUrls[index]}/api/v1/legal/public/footer-meta/?lang=ko`;
    const isFallback = index > 0;

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
        if (!isFallback && response.status >= 500 && baseUrls.length > 1) continue;
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
      if (!isFallback && baseUrls.length > 1) {
        console.error('[legal-meta] primary proxy error; retrying public fallback', err instanceof Error ? err.message : err);
        continue;
      }
      console.error('[legal-meta] proxy error:', err instanceof Error ? err.message : err);
      return NextResponse.json(FALLBACK_META, {
        headers: { 'X-Fallback': 'true' },
      });
    }
  }

  return NextResponse.json(FALLBACK_META, {
    headers: { 'X-Fallback': 'true' },
  });
}
