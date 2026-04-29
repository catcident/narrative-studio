/**
 * 구독 관리 모달
 * 탭: 플랜 비교 | 크레딧 구매 | 사용 내역 | API 키
 */

import { useState, useEffect, useMemo } from 'react';
import { X, Crown, Zap, Star, ShoppingCart, Check, Key, Loader2, Trash2, ExternalLink, Info } from 'lucide-react';
import { useBillingSubscription, useByokEnabled, useByokMode, useStore } from '../store';
import {
  getPublicPricingCatalog,
  buildPlanFeatureStrings,
  type BillingMode,
  type ServicePlan,
  type CreditPackage,
  type PaymentRouteSummary,
} from '../services/billing';
import { hasApiKey, getApiKey, setApiKey, removeApiKey, validateApiKey } from '../services/extraction';
import type { ByokMode } from '../services/extraction';
import { UsageHistory } from './UsageHistory';
import { ModalOverlay } from './ModalOverlay';

type Tab = 'plans' | 'packages' | 'history' | 'apikey';

interface SubscriptionPageProps {
  onClose: () => void;
}

function normalizeBillingMode(value: unknown): BillingMode | null {
  return value === 'live' || value === 'test' ? value : null;
}

function hasPaymentRouteField(item: ServicePlan | CreditPackage): boolean {
  return Object.prototype.hasOwnProperty.call(item, 'payment_route');
}

function isTestRoute(route: PaymentRouteSummary | null | undefined): boolean {
  return route?.enabled === true && (route.is_test || route.mode === 'sandbox');
}

function isUnavailableRoute(route: PaymentRouteSummary | null | undefined): boolean {
  return !!route && !route.enabled;
}

function routeBadge(route: PaymentRouteSummary | null | undefined): { label: string; className: string } | null {
  if (!route) return null;
  if (!route.enabled) {
    return {
      label: route.mode === 'missing' ? '결제 설정 필요' : '결제 불가',
      className: 'bg-gray-100 text-gray-600 border-gray-200',
    };
  }
  if (isTestRoute(route)) {
    return {
      label: '테스트 결제',
      className: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  return {
    label: '실결제',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
}

export function SubscriptionPage({ onClose }: SubscriptionPageProps) {
  const subscription = useBillingSubscription();
  const byokEnabled = useByokEnabled();
  const byokMode = useByokMode();
  const setByokMode = useStore((s) => s.setByokMode);
  const [activeTab, setActiveTab] = useState<Tab>('plans');
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [billingMode, setBillingMode] = useState<BillingMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // API 키 탭 상태
  const [hasLocalKey, setHasLocalKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keyValidating, setKeyValidating] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySuccess, setKeySuccess] = useState(false);

  useEffect(() => {
    setHasLocalKey(hasApiKey());
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPublicPricingCatalog()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setPlans(result.data.plans);
          setPackages(result.data.topup_packages);
          const mode = normalizeBillingMode(result.data.billing_mode);
          if (mode) setBillingMode(mode);
        } else {
          setLoadError(true);
        }
      })
      .catch((err: unknown) => {
        console.error('[billing] SubscriptionPage load error:', err);
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
    ...(byokEnabled ? [{ id: 'apikey' as Tab, label: 'API 키' }] : []),
  ];

  const handleSaveKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) return;
    setKeyValidating(true);
    setKeyError(null);
    setKeySuccess(false);
    try {
      const result = await validateApiKey(key);
      if (result.valid) {
        setApiKey(key);
        setHasLocalKey(true);
        setApiKeyInput('');
        setKeySuccess(true);
        setKeyError(null);
        setTimeout(() => setKeySuccess(false), 3000);
      } else {
        setKeyError(result.error || '유효하지 않은 API 키입니다.');
      }
    } finally {
      setKeyValidating(false);
    }
  };

  const handleRemoveKey = () => {
    removeApiKey();
    setHasLocalKey(false);
    setApiKeyInput('');
    setKeyError(null);
  };

  const maskedKey = useMemo(() => {
    if (!hasLocalKey) return null;
    const key = getApiKey();
    if (!key) return null;
    if (key.length <= 10) return '••••••••••';
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  }, [hasLocalKey]);

  function planIcon(code: string) {
    switch (code) {
      case 'business':
      case 'pro': return <Crown aria-hidden="true" className="w-5 h-5" />;
      case 'basic': return <Zap aria-hidden="true" className="w-5 h-5" />;
      default: return <Star aria-hidden="true" className="w-5 h-5" />;
    }
  }

  function planColor(code: string): string {
    switch (code) {
      case 'business': return 'border-amber-300 bg-amber-50';
      case 'pro': return 'border-purple-300 bg-purple-50';
      case 'basic': return 'border-blue-300 bg-blue-50';
      default: return 'border-gray-300 bg-gray-50';
    }
  }

  const billingBaseUrl = 'https://catcident.com/ko/billing';
  const returnUrlParam = useMemo(() => encodeURIComponent(window.location.origin + '/app'), []);
  const hasBackendPaymentRouteInfo = useMemo(
    () => plans.some(hasPaymentRouteField) || packages.some(hasPaymentRouteField),
    [plans, packages],
  );
  const hasPlanTestRoute = useMemo(
    () => plans.some((plan) => plan.price_krw > 0 && isTestRoute(plan.payment_route)),
    [plans],
  );
  const hasPackageTestRoute = useMemo(
    () => packages.some((pkg) => isTestRoute(pkg.payment_route)),
    [packages],
  );
  const showLegacyTestModeBanner = !hasBackendPaymentRouteInfo && billingMode === 'test';
  const showTestModeBanner =
    showLegacyTestModeBanner ||
    (activeTab === 'plans' && hasPlanTestRoute) ||
    (activeTab === 'packages' && hasPackageTestRoute);
  const testModeBannerTitle = (() => {
    if (showLegacyTestModeBanner) return '현재 결제 시스템은 테스트 모드로 운영 중입니다';
    if (activeTab === 'packages') return '일부 크레딧 상품은 테스트 결제로 진행됩니다';
    return '일부 구독 플랜은 테스트 결제로 진행됩니다';
  })();
  const testModeBannerDescription = showLegacyTestModeBanner
    ? '실제 결제가 이루어지지 않습니다. 정식 오픈 시 안내드리겠습니다.'
    : '테스트 라우팅이 적용된 항목은 실제 결제가 이루어지지 않습니다.';

  function getPlanCardStyle(code: string, isCurrent: boolean, isPopular: boolean): string {
    if (isCurrent) return planColor(code) + ' ring-2 ring-blue-500';
    if (isPopular) return 'border-purple-400 shadow-lg shadow-purple-100 bg-purple-50/30';
    return 'border-gray-200';
  }

  function renderTabContent() {
    if (loading) {
      return <div className="text-center text-gray-400 py-12">로딩 중...</div>;
    }
    if (loadError) {
      return (
        <div className="text-center text-gray-500 py-12">
          <p>구독 정보를 불러올 수 없습니다.</p>
          <p className="text-sm mt-1">잠시 후 다시 시도해주세요.</p>
        </div>
      );
    }
    switch (activeTab) {
      case 'plans':
        return (
          <div>
            {!plans.some(p => p.code === subscription?.plan) && subscription?.planName && (
              <div role="status" className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                현재 플랜: <span className="font-medium">{subscription.planName}</span>
              </div>
            )}

            <div className={`grid grid-cols-1 gap-4 ${plans.length <= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-4'}`}>
              {plans.map(plan => {
                const isCurrent = subscription?.plan === plan.code;
                const isPopular = plan.code === 'pro';
                const badge = routeBadge(plan.payment_route);
                const isPaymentUnavailable = isUnavailableRoute(plan.payment_route);
                return (
                  <div
                    key={plan.id}
                    className={`border-2 rounded-xl p-4 flex flex-col relative ${getPlanCardStyle(plan.code, isCurrent, isPopular)}`}
                  >
                    {isPopular && !isCurrent && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs px-3 py-0.5 bg-purple-600 text-white rounded-full whitespace-nowrap">
                        가장 인기
                      </span>
                    )}

                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      {planIcon(plan.code)}
                      <h3 className="font-bold text-gray-800">{plan.name}</h3>
                      <div className="ml-auto flex flex-wrap justify-end gap-1">
                        {isCurrent && (
                          <span className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded-full whitespace-nowrap">
                            현재
                          </span>
                        )}
                        {badge && (
                          <span className={`text-xs px-2 py-0.5 border rounded-full whitespace-nowrap ${badge.className}`}>
                            {badge.label}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mb-4">
                      {plan.price_krw === 0 ? (
                        <span className="text-2xl font-bold text-gray-800">무료</span>
                      ) : (
                        <div>
                          <span className="text-2xl font-bold text-gray-800">
                            {plan.price_krw.toLocaleString()}원
                          </span>
                          <span className="text-sm text-gray-500"> /월</span>
                        </div>
                      )}
                    </div>

                    <div className="text-sm text-gray-600 mb-4">
                      <span>월 {plan.monthly_credits.toLocaleString()} 크레딧</span>
                      {plan.monthly_credits > 0 && plan.price_krw > 0 && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {Math.round(plan.price_krw / plan.monthly_credits * 10) / 10}원/cr
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 text-sm flex-1">
                      {buildPlanFeatureStrings(plan.features).map((feature) => (
                        <div key={feature} className="flex items-center gap-2 text-gray-600">
                          <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>

                    {!isCurrent && plan.price_krw > 0 && (
                      <button
                        disabled={isPaymentUnavailable}
                        onClick={() => window.open(
                          `${billingBaseUrl}/services/storygraph/subscribe/?plan=${plan.code}&return_url=${returnUrlParam}`,
                          '_blank',
                          'noopener'
                        )}
                        className={`mt-4 w-full py-2 px-4 text-white text-sm font-medium rounded-lg transition-colors ${
                          isPaymentUnavailable
                            ? 'bg-gray-300 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                      >
                        {isPaymentUnavailable ? '현재 결제 불가' : subscription?.plan === 'free' ? '구독 시작' : '플랜 변경'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'packages':
        if (!subscription?.features.can_purchase_credits) {
          return (
            <div className="text-center py-12">
              <ShoppingCart aria-hidden="true" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">크레딧 구매는 Basic 이상 플랜에서 이용할 수 있습니다.</p>
            </div>
          );
        }
        if (packages.length === 0) {
          return <div className="text-center text-gray-400 py-12">준비된 상품이 없습니다.</div>;
        }
        return (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {packages.map(pkg => {
                const badge = routeBadge(pkg.payment_route);
                const isPaymentUnavailable = isUnavailableRoute(pkg.payment_route);
                return (
                  <div key={pkg.id} className="border border-gray-200 rounded-xl p-5 flex flex-col">
                    <div className="flex items-start gap-2 mb-2">
                      <h3 className="font-bold text-gray-800">{pkg.name}</h3>
                      {badge && (
                        <span className={`ml-auto text-xs px-2 py-0.5 border rounded-full whitespace-nowrap ${badge.className}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <div className="text-3xl font-bold text-blue-600 mb-1 tabular-nums">
                      {pkg.credits.toLocaleString()} 크레딧
                    </div>
                    {pkg.bonus_pct > 0 && (
                      <div className="text-xs text-green-600 font-medium mb-1">
                        +{pkg.bonus_pct}% 보너스
                      </div>
                    )}
                    <div className="text-sm text-gray-500 mb-1">
                      {pkg.price_krw.toLocaleString()}원
                      <span className="text-xs text-gray-400 ml-1">
                        ({Math.round(pkg.price_krw / pkg.credits * 10) / 10}원/cr)
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-auto pt-4">만료 없음</div>
                    <button
                      disabled={isPaymentUnavailable}
                      onClick={() => window.open(
                        `${billingBaseUrl}/credits/checkout/?package=${pkg.id}&return_url=${returnUrlParam}`,
                        '_blank',
                        'noopener'
                      )}
                      className={`w-full py-2 px-4 text-white rounded-lg text-sm font-medium transition-colors ${
                        isPaymentUnavailable
                          ? 'bg-gray-300 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      {isPaymentUnavailable ? '현재 결제 불가' : '구매하기'}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-gray-400 text-center">
              유상 크레딧 사용 시 사용분에 대한 환불이 제한됩니다.
            </p>
          </>
        );

      case 'history':
        return <UsageHistory />;

      case 'apikey':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="font-medium text-gray-800 mb-2 flex items-center gap-2">
                <Key aria-hidden="true" className="w-5 h-5 text-gray-600" />
                개인 API 키
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                개인 OpenRouter API 키를 사용하면 크레딧이 차감되지 않고, OpenRouter에 직접 과금됩니다.
              </p>
            </div>

            {hasLocalKey && maskedKey && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-800">현재 키</p>
                    <p className="text-sm text-green-600 font-mono mt-1">{maskedKey}</p>
                  </div>
                  <button
                    onClick={handleRemoveKey}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                  >
                    <Trash2 aria-hidden="true" className="w-4 h-4" />
                    삭제
                  </button>
                </div>
              </div>
            )}

            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-sm font-medium text-gray-700 mb-3">
                {hasLocalKey ? 'API 키 변경' : 'API 키 등록'}
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-or-..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  disabled={keyValidating}
                />
                <button
                  onClick={handleSaveKey}
                  disabled={keyValidating || !apiKeyInput.trim()}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {keyValidating && <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />}
                  {keyValidating ? '검증 중...' : '저장'}
                </button>
              </div>
              {keyError && (
                <p className="text-xs text-red-600 mt-2">{keyError}</p>
              )}
              {keySuccess && (
                <p className="text-xs text-green-600 mt-2">API 키가 저장되었습니다.</p>
              )}
            </div>

            {hasLocalKey && (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-sm font-medium text-gray-700 mb-3">API 키 사용 모드</p>
                <div className="space-y-2">
                  {([
                    { mode: 'credit-first' as ByokMode, label: '크레딧 우선 (소진 시 개인 키로 전환)', recommended: true },
                    { mode: 'always-byok' as ByokMode, label: '항상 개인 키 사용' },
                  ]).map(({ mode, label, recommended }) => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="byokMode"
                        checked={byokMode === mode}
                        onChange={() => setByokMode(mode)}
                        className="text-blue-600"
                      />
                      <span className="text-sm text-gray-700">
                        {label}
                        {recommended && <span className="text-xs text-blue-500 ml-1">(추천)</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="text-sm text-gray-500 space-y-2">
              <p>개인 키 사용 시 크레딧이 차감되지 않습니다. OpenRouter에 직접 과금됩니다.</p>
              <p>키를 삭제하면 서버 키 모드로 복귀하며, 이후 분석부터 크레딧이 정상 차감됩니다.</p>
              <a
                href="https://openrouter.ai/settings/keys"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
              >
                <ExternalLink aria-hidden="true" className="w-3.5 h-3.5" />
                OpenRouter 키 관리 페이지
              </a>
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <ModalOverlay onClose={onClose} maxWidth="5xl">
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
          {showTestModeBanner && (
            <div role="status" className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
              <Info aria-hidden="true" className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">{testModeBannerTitle}</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  {testModeBannerDescription}
                </p>
              </div>
            </div>
          )}

          {renderTabContent()}
        </div>
      </div>
    </ModalOverlay>
  );
}
