/**
 * 구독 관리 모달
 * 탭: 플랜 비교 | 크레딧 구매 | 사용 내역 | API 키
 */

import { useState, useEffect, useMemo } from 'react';
import { X, Crown, Zap, Star, ShoppingCart, Check, Key, Loader2, Trash2, ExternalLink, RefreshCw, Info } from 'lucide-react';
import { useBillingSubscription, useByokEnabled, useByokMode, useStore } from '../store';
import { getPlans, getCreditPackages, type ServicePlan, type CreditPackage } from '../services/billing';
import { hasApiKey, getApiKey, setApiKey, removeApiKey, validateApiKey } from '../services/extraction';
import type { ByokMode } from '../services/extraction';
import { UsageHistory } from './UsageHistory';
import { ModalOverlay } from './ModalOverlay';

type Tab = 'plans' | 'packages' | 'history' | 'apikey';
type BillingPeriod = 'monthly' | 'annual';

const ANNUAL_DISCOUNT = 0.17; // 17% 할인

const AUTO_RELOAD_THRESHOLDS = [50, 100, 200] as const;

interface SubscriptionPageProps {
  onClose: () => void;
}

export function SubscriptionPage({ onClose }: SubscriptionPageProps) {
  const subscription = useBillingSubscription();
  const byokEnabled = useByokEnabled();
  const byokMode = useByokMode();
  const setByokMode = useStore((s) => s.setByokMode);
  const [activeTab, setActiveTab] = useState<Tab>('plans');
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');

  // 자동 리로드 상태 (UI만 — 백엔드 미구현)
  const [autoReloadThreshold, setAutoReloadThreshold] = useState<number>(100);
  const [autoReloadPackageIdx, setAutoReloadPackageIdx] = useState<number>(0);

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
    Promise.all([getPlans(), getCreditPackages()])
      .then(([plansResult, packagesResult]) => {
        if (cancelled) return;
        if (plansResult.ok) setPlans(plansResult.data);
        if (packagesResult.ok) setPackages(packagesResult.data);
        if (!plansResult.ok || !packagesResult.ok) setLoadError(true);
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

  const planIcon = (code: string) => {
    switch (code) {
      case 'business': return <Crown aria-hidden="true" className="w-5 h-5" />;
      case 'pro': return <Crown aria-hidden="true" className="w-5 h-5" />;
      case 'basic': return <Zap aria-hidden="true" className="w-5 h-5" />;
      default: return <Star aria-hidden="true" className="w-5 h-5" />;
    }
  };

  const planColor = (code: string) => {
    switch (code) {
      case 'business': return 'border-amber-300 bg-amber-50';
      case 'pro': return 'border-purple-300 bg-purple-50';
      case 'basic': return 'border-blue-300 bg-blue-50';
      default: return 'border-gray-300 bg-gray-50';
    }
  };

  const billingBaseUrl = 'https://catcident.com/ko/billing';
  const returnUrlParam = useMemo(() => encodeURIComponent(window.location.origin + '/app'), []);

  function getPlanCardStyle(code: string, isCurrent: boolean, isPopular: boolean): string {
    if (isCurrent) return planColor(code) + ' ring-2 ring-blue-500';
    if (isPopular) return 'border-purple-400 shadow-lg shadow-purple-100 bg-purple-50/30';
    return 'border-gray-200';
  }

  const getDisplayPrice = (monthlyPrice: number): { price: number; original?: number } => {
    if (billingPeriod === 'annual' && monthlyPrice > 0) {
      const annual = Math.round(monthlyPrice * (1 - ANNUAL_DISCOUNT));
      return { price: annual, original: monthlyPrice };
    }
    return { price: monthlyPrice };
  };

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
          {/* 테스트 모드 배너 */}
          <div role="status" className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
            <Info aria-hidden="true" className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">현재 결제 시스템은 테스트 모드로 운영 중입니다</p>
              <p className="text-xs text-amber-600 mt-0.5">
                실제 결제가 이루어지지 않습니다. 정식 오픈 시 안내드리겠습니다.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-12">로딩 중...</div>
          ) : loadError ? (
            <div className="text-center text-gray-500 py-12">
              <p>구독 정보를 불러올 수 없습니다.</p>
              <p className="text-sm mt-1">잠시 후 다시 시도해주세요.</p>
            </div>
          ) : activeTab === 'plans' ? (
            /* 플랜 비교 */
            <div>
              {/* C1: 결제 주기 토글 */}
              <div className="flex items-center justify-center gap-3 mb-6">
                <span className={`text-sm ${billingPeriod === 'monthly' ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>
                  월간
                </span>
                <button
                  onClick={() => setBillingPeriod(billingPeriod === 'monthly' ? 'annual' : 'monthly')}
                  className="relative"
                  aria-label={billingPeriod === 'monthly' ? '연간 결제로 전환' : '월간 결제로 전환'}
                  role="switch"
                  aria-checked={billingPeriod === 'annual'}
                >
                  <div className={`w-10 h-5 rounded-full relative transition-colors ${billingPeriod === 'annual' ? 'bg-purple-600' : 'bg-gray-300'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${billingPeriod === 'annual' ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                </button>
                <span className={`text-sm ${billingPeriod === 'annual' ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>
                  연간
                </span>
                {billingPeriod === 'annual' && (
                  <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                    17% 할인
                  </span>
                )}
              </div>

              {!plans.some(p => p.code === subscription?.plan) && subscription?.planName && (
                <div role="status" className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                  현재 플랜: <span className="font-medium">{subscription.planName}</span>
                </div>
              )}

              <div className={`grid grid-cols-1 gap-4 ${plans.length <= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-4'}`}>
                {plans.map(plan => {
                  const isCurrent = subscription?.plan === plan.code;
                  const isPopular = plan.code === 'pro';
                  const { price, original } = getDisplayPrice(plan.price_krw);
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

                      <div className="flex items-center gap-2 mb-3">
                        {planIcon(plan.code)}
                        <h3 className="font-bold text-gray-800">{plan.name}</h3>
                        {isCurrent && (
                          <span className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded-full ml-auto whitespace-nowrap">
                            현재
                          </span>
                        )}
                      </div>

                      <div className="mb-4">
                        {price === 0 ? (
                          <span className="text-2xl font-bold text-gray-800">무료</span>
                        ) : (
                          <div>
                            {original && (
                              <span className="text-sm text-gray-400 line-through mr-2">
                                {original.toLocaleString()}원
                              </span>
                            )}
                            <span className="text-2xl font-bold text-gray-800">
                              {price.toLocaleString()}원
                            </span>
                            <span className="text-sm text-gray-500"> /월</span>
                          </div>
                        )}
                      </div>

                      <div className="text-sm text-gray-600 mb-4">
                        <span>월 {plan.monthly_credits.toLocaleString()} 크레딧</span>
                        {plan.monthly_credits > 0 && price > 0 && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            {Math.round(price / plan.monthly_credits * 10) / 10}원/cr
                          </div>
                        )}
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
                        <div className="flex items-center gap-2 text-gray-600">
                          <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span>최대 {plan.features.max_file_size_mb}MB 파일</span>
                        </div>
                        {plan.features.max_saved_graphs !== undefined && (
                          <div className="flex items-center gap-2 text-gray-600">
                            <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                            <span>저장 {plan.features.max_saved_graphs === -1 ? '무제한' : `${plan.features.max_saved_graphs.toLocaleString()}개`}</span>
                          </div>
                        )}
                        {plan.features.max_chats_per_analysis !== undefined && plan.features.max_chats_per_analysis !== -1 && (
                          <div className="flex items-center gap-2 text-gray-600">
                            <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                            <span>분석당 채팅 {plan.features.max_chats_per_analysis}회</span>
                          </div>
                        )}
                        {plan.features.max_chats_per_analysis === -1 && (
                          <div className="flex items-center gap-2 text-gray-600">
                            <Check aria-hidden="true" className="w-4 h-4 text-green-500 flex-shrink-0" />
                            <span>채팅 횟수 무제한</span>
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
                      </div>

                      {!isCurrent && plan.price_krw > 0 && (
                        <button
                          onClick={() => window.open(
                            `${billingBaseUrl}/subscribe/?plan=${plan.code}&return_url=${returnUrlParam}`,
                            '_blank',
                            'noopener'
                          )}
                          className="mt-4 w-full py-2 px-4 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                          {subscription?.plan === 'free' ? '구독 시작' : '플랜 변경'}
                        </button>
                      )}
                    </div>
                  );
                })}

              </div>
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
                      <div key={pkg.id} className="border border-gray-200 rounded-xl p-5 flex flex-col">
                        <h3 className="font-bold text-gray-800 mb-2">{pkg.name}</h3>
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
                          onClick={() => window.open(
                            `${billingBaseUrl}/checkout/?package=${pkg.id}&return_url=${returnUrlParam}`,
                            '_blank',
                            'noopener'
                          )}
                          className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          구매하기
                        </button>
                      </div>
                  ))}
                </div>
              )}

              {/* C2: 자동 리로드 설정 (확장) */}
              {subscription?.features.can_purchase_credits && (
                <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <RefreshCw aria-hidden="true" className="w-4 h-4 text-gray-500" />
                    <h4 className="text-sm font-medium text-gray-700">자동 리로드</h4>
                    <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-500 rounded-full">준비 중</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-4">
                    잔액이 임계값 이하로 떨어지면 자동으로 크레딧을 충전합니다. 자동 리로드 시 +10% 보너스가 적용됩니다.
                  </p>

                  {/* 임계값 선택 */}
                  <div className="mb-3">
                    <label className="text-xs text-gray-500 block mb-1.5">충전 임계값</label>
                    <div className="flex gap-2">
                      {AUTO_RELOAD_THRESHOLDS.map(threshold => (
                        <button
                          key={threshold}
                          onClick={() => setAutoReloadThreshold(threshold)}
                          disabled
                          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-not-allowed ${
                            autoReloadThreshold === threshold
                              ? 'border-blue-300 bg-blue-50 text-blue-700'
                              : 'border-gray-200 bg-white text-gray-400'
                          }`}
                        >
                          {threshold}cr 이하
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 패키지 선택 */}
                  {packages.length > 0 && (
                    <div className="mb-3">
                      <label className="text-xs text-gray-500 block mb-1.5">충전 패키지</label>
                      <div className="flex gap-2">
                        {packages.map((pkg, idx) => {
                          const bonusCredits = Math.round(pkg.credits * 0.1);
                          return (
                            <button
                              key={pkg.id}
                              onClick={() => setAutoReloadPackageIdx(idx)}
                              disabled
                              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-not-allowed ${
                                autoReloadPackageIdx === idx
                                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                                  : 'border-gray-200 bg-white text-gray-400'
                              }`}
                            >
                              {pkg.name} (+{bonusCredits}cr)
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <button
                    disabled
                    className="w-full py-2 px-4 bg-gray-100 text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed"
                  >
                    자동 리로드 설정 (준비 중)
                  </button>
                </div>
              )}
            </div>
          ) : activeTab === 'history' ? (
            /* 사용 내역 */
            <UsageHistory />
          ) : activeTab === 'apikey' ? (
            /* API 키 관리 */
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

              {/* 현재 키 상태 */}
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

              {/* 키 입력/변경 */}
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

              {/* BYOK 모드 선택 */}
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

              {/* 안내 */}
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
          ) : null}
        </div>
      </div>
    </ModalOverlay>
  );
}
