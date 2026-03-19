'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { buildPlanFeatureStrings, getPublicPricingCatalog, type ServicePlan } from '../../services/billing';
import { useScrollReveal } from './useScrollReveal';

/* ── 플랜별 스타일 ──────────────────────────────────────── */

interface PlanStyle {
  highlighted: boolean;
  badge: string | null;
}

function getPlanStyle(code: string): PlanStyle {
  switch (code) {
    case 'pro':
      return { highlighted: true, badge: '인기' };
    default:
      return { highlighted: false, badge: null };
  }
}

/* ── 플랜 수에 따른 그리드 레이아웃 ──────────────────────── */

function getGridLayoutClass(planCount: number): string {
  switch (planCount) {
    case 1:
      return 'max-w-sm';
    case 2:
      return 'md:grid-cols-2 max-w-3xl';
    case 4:
      return 'md:grid-cols-2 lg:grid-cols-4 max-w-6xl';
    default:
      return 'md:grid-cols-3 max-w-6xl';
  }
}

/* ── PlanCard ───────────────────────────────────────────── */

function PlanCard({ plan }: { plan: ServicePlan }) {
  const style = getPlanStyle(plan.code);
  const isPaid = plan.price_krw > 0;
  const featureStrings = buildPlanFeatureStrings(plan.features);

  return (
    <div className={`relative rounded-2xl p-8 border transition-all duration-300 flex flex-col h-full ${
      style.highlighted
        ? 'bg-white border-2 border-indigo-300 shadow-2xl shadow-indigo-500/15 scale-[1.02]'
        : 'bg-white border-gray-200 shadow-sm hover:shadow-md'
    }`}>
      {style.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
          <span className="px-4 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-full shadow-md">
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

      <ul className="mt-6 space-y-3 flex-1">
        {featureStrings.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-600">
            <Check aria-hidden="true" className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

    </div>
  );
}

/* ── 로딩 플레이스홀더 ──────────────────────────────────── */

function PricingPlaceholder() {
  return (
    <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl p-8 border border-gray-100 animate-pulse">
          <div className="h-5 bg-gray-200 rounded w-20 mb-4" />
          <div className="h-8 bg-gray-200 rounded w-28 mb-6" />
          <div className="space-y-3">
            <div className="h-4 bg-gray-100 rounded w-full" />
            <div className="h-4 bg-gray-100 rounded w-3/4" />
            <div className="h-4 bg-gray-100 rounded w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── PricingSection ─────────────────────────────────────── */

export function PricingSection() {
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const { ref, isVisible } = useScrollReveal();

  useEffect(() => {
    let cancelled = false;

    getPublicPricingCatalog()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setPlans(result.data.plans);
        }
      })
      .catch((err: unknown) => {
        console.error('[landing] plans load error:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="pricing" className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6" ref={ref}>
        <div
          className="text-center mb-16 md:mb-20"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
            transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
          }}
        >
          <span className="text-xs font-semibold text-indigo-500 tracking-widest uppercase mb-3 block">
            PRICING
          </span>
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
          <>
          <div className={`grid gap-6 mx-auto ${getGridLayoutClass(plans.length)}`}>
            {plans.map((plan, i) => (
              <div
                key={plan.code}
                style={{
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
                  transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
                  transitionDelay: `${0.1 + i * 0.1}s`,
                }}
              >
                <PlanCard plan={plan} />
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl hover:from-indigo-600 hover:to-violet-700 shadow-sm hover:shadow-md transition-all"
            >
              무료로 시작하기
              <ArrowRight aria-hidden="true" className="w-4 h-4" />
            </Link>
          </div>
          </>
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
