'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LegalFooterMeta } from '@/types/legalMeta';

type FetchState = 'loading' | 'ready' | 'error';

export function Footer() {
  const [meta, setMeta] = useState<LegalFooterMeta | null>(null);
  const [state, setState] = useState<FetchState>('loading');

  useEffect(() => {
    let cancelled = false;

    const fetchLegalMeta = async () => {
      try {
        const response = await fetch('/api/legal-meta');
        if (!response.ok) {
          throw new Error(`Failed to load legal meta: ${response.status}`);
        }

        const data = (await response.json()) as LegalFooterMeta;
        if (cancelled) return;

        setMeta(data);
        setState('ready');
      } catch (error: unknown) {
        if (cancelled) return;
        console.error('[footer] legal meta fetch failed:', error instanceof Error ? error.message : error);
        setState('error');
      }
    };

    fetchLegalMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  const legalLinks = useMemo(() => {
    if (!meta) return [];
    return [
      { label: '이용약관', href: meta.links.terms },
      { label: '개인정보처리방침', href: meta.links.privacy },
      { label: '사업자정보', href: meta.links.business_info },
    ];
  }, [meta]);

  const hasSummary = Boolean(
    meta?.company.name &&
      meta?.company.representative &&
      meta?.company.registration_number,
  );

  return (
    <footer className="mt-auto w-full py-16 px-6">
      <div className="max-w-5xl mx-auto flex flex-col items-center gap-3">
        <a
          href="https://catcident.com"
          target="_blank"
          rel="noopener"
          className="text-sm font-semibold text-gray-400 hover:text-gray-600 tracking-tight transition-colors"
        >
          고양이의 만행
        </a>

        {state === 'ready' && hasSummary && meta && (
          <p className="text-xs text-gray-300 text-center break-keep">
            상호: {meta.company.name}
            <span className="mx-1">|</span>
            대표자: {meta.company.representative}
            <span className="mx-1">|</span>
            사업자등록번호: {meta.company.registration_number}
          </p>
        )}

        {state === 'ready' && legalLinks.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-gray-300">
            {legalLinks.map((link, index) => (
              <span key={link.label} className="flex items-center gap-3">
                {index > 0 && (
                  <span aria-hidden="true" className="text-gray-200">
                    ·
                  </span>
                )}
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener"
                  className="hover:text-gray-500 transition-colors"
                >
                  {link.label}
                </a>
              </span>
            ))}
          </div>
        )}

        {state === 'error' && (
          <p className="text-xs text-gray-300">법적 고지 정보를 불러오지 못했습니다.</p>
        )}

        <p className="text-[11px] text-gray-300">&copy; {new Date().getFullYear()} 고양이의 만행</p>
      </div>
    </footer>
  );
}
