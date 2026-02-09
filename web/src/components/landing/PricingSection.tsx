'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';

interface Plan {
  code: string;
  name: string;
  price_monthly: number;
  credits_monthly: number;
  features: string[];
  is_default: boolean;
}

function getPlanStyle(code: string) {
  switch (code) {
    case 'pro':
    case 'business':
      return { highlighted: true, badge: '인기' };
    default:
      return { highlighted: false, badge: null };
  }
}

function PlanCard({ plan }: { plan: Plan }) {
  const style = getPlanStyle(plan.code);

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
          {plan.price_monthly > 0 ? (
            <>
              <span className="text-3xl font-bold text-gray-900">
                {plan.price_monthly.toLocaleString()}
              </span>
              <span className="text-sm text-gray-500">원/월</span>
            </>
          ) : (
            <span className="text-3xl font-bold text-gray-900">무료</span>
          )}
        </div>
        {plan.credits_monthly > 0 && (
          <p className="mt-2 text-sm text-gray-500">
            월 {plan.credits_monthly.toLocaleString()} 크레딧
          </p>
        )}
      </div>

      <ul className="mt-6 space-y-3">
        {plan.features.map((feature) => (
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
            ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-500/25'
            : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
        }`}
      >
        {plan.is_default ? '무료로 시작' : '구독하기'}
      </Link>
    </div>
  );
}

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

export function PricingSection() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/billing/plans')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load plans');
        return res.json();
      })
      .then((data: unknown) => {
        if (!cancelled && Array.isArray(data)) {
          setPlans(data as Plan[]);
        }
      })
      .catch((err: unknown) => {
        console.error('[landing] plans load error:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <section id="pricing" className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16 md:mb-20">
          <span className="text-sm font-medium text-indigo-600 tracking-wide uppercase">Pricing</span>
          <h2 className="mt-3 text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            합리적인 요금제
          </h2>
          <p className="mt-4 text-gray-500 max-w-lg mx-auto">
            무료로 시작하고, 필요에 따라 업그레이드하세요
          </p>
        </div>

        {loading ? (
          <PricingPlaceholder />
        ) : plans.length > 0 ? (
          <div className={`grid gap-6 max-w-4xl mx-auto ${
            plans.length === 1 ? 'max-w-sm' :
            plans.length === 2 ? 'md:grid-cols-2 max-w-2xl' :
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
