/**
 * 구독 관리 모달
 * 탭: 플랜 비교 | 크레딧 구매 | 사용 내역
 */

import { useState, useEffect } from 'react';
import { X, Crown, Zap, Star, ShoppingCart, Check } from 'lucide-react';
import { useBillingSubscription } from '../store';
import { getPlans, getCreditPackages, type ServicePlan, type CreditPackage } from '../services/billing';
import { UsageHistory } from './UsageHistory';
import { ModalOverlay } from './ModalOverlay';

type Tab = 'plans' | 'packages' | 'history';

interface SubscriptionPageProps {
  onClose: () => void;
}

export function SubscriptionPage({ onClose }: SubscriptionPageProps) {
  const subscription = useBillingSubscription();
  const [activeTab, setActiveTab] = useState<Tab>('plans');
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPlans(), getCreditPackages()])
      .then(([p, pkg]) => {
        if (!cancelled) {
          setPlans(p);
          setPackages(pkg);
        }
      })
      .catch((error) => {
        console.error('[billing] SubscriptionPage load error:', error);
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'plans', label: '플랜 비교' },
    { id: 'packages', label: '크레딧 구매' },
    { id: 'history', label: '사용 내역' },
  ];

  const planIcon = (code: string) => {
    switch (code) {
      case 'pro': return <Crown aria-hidden="true" className="w-5 h-5" />;
      case 'basic': return <Zap aria-hidden="true" className="w-5 h-5" />;
      default: return <Star aria-hidden="true" className="w-5 h-5" />;
    }
  };

  const planColor = (code: string) => {
    switch (code) {
      case 'pro': return 'border-purple-300 bg-purple-50';
      case 'basic': return 'border-blue-300 bg-blue-50';
      default: return 'border-gray-300 bg-gray-50';
    }
  };

  return (
    <ModalOverlay onClose={onClose} maxWidth="3xl">
      <div className="max-h-[85vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-800 text-lg">구독 관리</h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X aria-hidden="true" className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-gray-200 px-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-gray-400 py-12">로딩 중...</div>
          ) : loadError ? (
            <div className="text-center text-gray-500 py-12">
              <p>구독 정보를 불러올 수 없습니다.</p>
              <p className="text-sm mt-1">잠시 후 다시 시도해주세요.</p>
            </div>
          ) : activeTab === 'plans' ? (
            /* 플랜 비교 */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plans.map(plan => {
                const isCurrent = subscription?.plan === plan.code;
                return (
                  <div
                    key={plan.id}
                    className={`border-2 rounded-xl p-5 flex flex-col ${
                      isCurrent ? planColor(plan.code) + ' ring-2 ring-blue-500' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      {planIcon(plan.code)}
                      <h3 className="font-bold text-gray-800">{plan.name}</h3>
                      {isCurrent && (
                        <span className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded-full ml-auto">
                          현재
                        </span>
                      )}
                    </div>

                    <div className="mb-4">
                      <span className="text-2xl font-bold text-gray-800">
                        {plan.price_krw === 0 ? '무료' : `${plan.price_krw.toLocaleString()}원`}
                      </span>
                      {plan.price_krw > 0 && (
                        <span className="text-sm text-gray-500"> /월</span>
                      )}
                    </div>

                    <div className="text-sm text-gray-600 mb-4">
                      월 {plan.monthly_credits.toLocaleString()} 크레딧
                    </div>

                    <div className="space-y-2 text-sm flex-1">
                      {plan.features.models === 'all' ? (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>모든 AI 모델 사용 가능</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>{(plan.features.models as string[]).length}개 모델 사용 가능</span>
                        </div>
                      )}
                      {plan.features.byok && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>BYOK (개인 API 키 사용)</span>
                        </div>
                      )}
                      {plan.features.can_purchase_credits && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>추가 크레딧 구매 가능</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-gray-600">
                        <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span>최대 {plan.features.max_file_size_mb}MB 파일</span>
                      </div>
                    </div>

                    {!isCurrent && (
                      <button
                        disabled
                        className="mt-4 w-full py-2 px-4 bg-gray-100 text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed"
                      >
                        준비 중
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : activeTab === 'packages' ? (
            /* 크레딧 구매 */
            <div>
              {!subscription?.features.can_purchase_credits ? (
                <div className="text-center py-12">
                  <ShoppingCart aria-hidden="true" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">크레딧 구매는 Basic 이상 플랜에서 이용할 수 있습니다.</p>
                </div>
              ) : packages.length === 0 ? (
                <div className="text-center text-gray-400 py-12">준비된 상품이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {packages.map(pkg => (
                    <div key={pkg.id} className="border border-gray-200 rounded-xl p-5">
                      <h3 className="font-bold text-gray-800 mb-2">{pkg.name}</h3>
                      <div className="text-2xl font-bold text-blue-600 mb-1">
                        {pkg.credits.toLocaleString()} 크레딧
                      </div>
                      {pkg.bonus_pct > 0 && (
                        <div className="text-xs text-green-600 font-medium mb-3">
                          +{pkg.bonus_pct}% 보너스
                        </div>
                      )}
                      <div className="text-sm text-gray-500 mb-4">
                        {pkg.price_krw.toLocaleString()}원
                      </div>
                      <button
                        disabled
                        className="w-full py-2 px-4 bg-gray-100 text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed"
                      >
                        준비 중
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* 사용 내역 */
            <UsageHistory />
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
