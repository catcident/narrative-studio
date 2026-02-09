'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';

/* ── 백엔드 응답 타입 ──────────────────────────────────── */

interface PlanFeatures {
  models: string[] | 'all';
  max_file_size_mb: number;
  max_saved_graphs?: number;
  max_chats_per_analysis?: number;
  can_purchase_credits?: boolean;
  byok?: boolean;
  export_formats?: string[];
}

interface BackendPlan {
  code: string;
  name: string;
  price_krw: number;
  monthly_credits: number;
  features: PlanFeatures;
}

/* ── 기능 문구 생성 ─────────────────────────────────────── */

function buildFeatureStrings(f: PlanFeatures): string[] {
  const out: string[] = [];

  if (f.models === 'all') {
    out.push('모든 AI 모델 사용');
  } else if (Array.isArray(f.models)) {
    out.push(`${f.models.length}개 AI 모델 사용`);
  }

  out.push(`최대 ${f.max_file_size_mb}MB 파일`);

  if (f.max_saved_graphs !== undefined) {
    out.push(f.max_saved_graphs === -1 ? '관계도 무제한 저장' : `관계도 ${f.max_saved_graphs}개 저장`);
  }

  if (f.max_chats_per_analysis !== undefined && f.max_chats_per_analysis !== -1) {
    out.push(`분석당 채팅 ${f.max_chats_per_analysis}회`);
  } else if (f.max_chats_per_analysis === -1) {
    out.push('채팅 무제한');
  }

  if (f.export_formats && f.export_formats.length > 0) {
    out.push(`${f.export_formats.map(s => s.toUpperCase()).join(', ')} 내보내기`);
  }

  if (f.can_purchase_credits) out.push('추가 크레딧 구매 가능');
  if (f.byok) out.push('개인 API 키 사용 (BYOK)');

  return out;
}

/* ── 플랜별 스타일 ──────────────────────────────────────── */

function getPlanStyle(code: string) {
  switch (code) {
    case 'pro':
      return { highlighted: true, badge: '인기' };
    default:
      return { highlighted: false, badge: null };
  }
}

/* ── PlanCard ───────────────────────────────────────────── */

function PlanCard({ plan }: { plan: BackendPlan }) {
  const style = getPlanStyle(plan.code);
  const isPaid = plan.price_krw > 0;
  const featureStrings = buildFeatureStrings(plan.features);

  return (
    <div className={`relative rounded-2xl p-8 border transition-all duration-300 ${
      style.highlighted
        ? 'bg-white border-indigo-200 shadow-xl shadow-indigo-500/10 scale-[1.02]'
        : 'bg-white border-gray-200 shadow-sm hover:shadow-md'
    }`}>
      {style.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-full shadow-sm">
            {style.badge}
          </span>
        </div>
      )}

      <div>
        <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
        <div className="mt-4 flex items-baseline gap-1">
          {isPaid ? (
            <>
              <span className="text-3xl font-bold text-gray-900">
                {plan.price_krw.toLocaleString()}
              </span>
              <span className="text-sm text-gray-500">원/월</span>
            </>
          ) : (
            <span className="text-3xl font-bold text-gray-900">무료</span>
          )}
        </div>
        {plan.monthly_credits > 0 && (
          <p className="mt-2 text-sm text-gray-500">
            월 {plan.monthly_credits.toLocaleString()} 크레딧
          </p>
        )}
      </div>

      <ul className="mt-6 space-y-3">
        {featureStrings.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-600">
            <Check aria-hidden="true" className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/login"
        className={`mt-8 block w-full text-center py-3 rounded-xl text-sm font-semibold transition-all ${
          style.highlighted
            ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm hover:shadow-md'
            : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
        }`}
      >
        {isPaid ? '시작하기' : '무료로 시작'}
      </Link>
    </div>
  );
}

/* ── 로딩 플레이스홀더 ──────────────────────────────────── */

function PricingPlaceholder() {
  return (
    <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl p-8 border border-gray-100 animate-pulse">
          <div className="h-5 bg-gray-200 rounded w-20 mb-4" />
          <div className="h-8 bg-gray-200 rounded w-28 mb-6" />
          <div className="space-y-3">
            <div className="h-4 bg-gray-100 rounded w-full" />
            <div className="h-4 bg-gray-100 rounded w-3/4" />
            <div className="h-4 bg-gray-100 rounded w-5/6" />
          </div>
          <div className="h-11 bg-gray-100 rounded-xl mt-8" />
        </div>
      ))}
    </div>
  );
}

/* ── PricingSection ─────────────────────────────────────── */

function isValidPlan(item: unknown): item is BackendPlan {
  if (typeof item !== 'object' || item === null) return false;
  const r = item as Record<string, unknown>;
  return (
    typeof r.code === 'string' &&
    typeof r.name === 'string' &&
    typeof r.price_krw === 'number' &&
    typeof r.monthly_credits === 'number' &&
    typeof r.features === 'object' &&
    r.features !== null
  );
}

export function PricingSection() {
  const [plans, setPlans] = useState<BackendPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    fetch('/api/billing/plans', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load plans');
        return res.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        // DRF 페이지네이션 형식 처리: { results: [...] } 또는 flat array
        const items = (
          typeof data === 'object' && data !== null && 'results' in data && Array.isArray((data as Record<string, unknown>).results)
            ? (data as Record<string, unknown>).results
            : Array.isArray(data) ? data : []
        ) as unknown[];
        setPlans(items.filter(isValidPlan));
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.error('[landing] plans load error:', err);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <section id="pricing" className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16 md:mb-20">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            합리적인 요금제
          </h2>
          <p className="mt-4 text-gray-500 max-w-lg mx-auto">
            무료로 시작하고, 필요에 따라 업그레이드하세요
          </p>
        </div>

        {loading ? (
          <PricingPlaceholder />
        ) : plans.length > 0 ? (
          <div className={`grid gap-6 max-w-5xl mx-auto ${
            plans.length === 1 ? 'max-w-sm' :
            plans.length === 2 ? 'md:grid-cols-2 max-w-2xl' :
            plans.length === 4 ? 'md:grid-cols-2 lg:grid-cols-4' :
            'md:grid-cols-3'
          }`}>
            {plans.map((plan) => (
              <PlanCard key={plan.code} plan={plan} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">요금제 정보를 준비 중입니다</p>
            <Link
              href="/login"
              className="inline-block mt-4 px-6 py-2.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
            >
              먼저 시작해 보기
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
