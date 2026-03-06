/**
 * 잔액 알림 배너
 * 월 크레딧 대비 75%/90%/100% 소진 시 표시
 */

import { useState } from 'react';
import { Info, AlertTriangle, AlertCircle, X, Key } from 'lucide-react';
import { useBillingSubscription, useByokMode } from '../store';
import { getBalanceAlertLevel, isBillingTestSubscription, type BalanceAlertLevel } from '../services/billing';
import { shouldUsePersonalKey, hasApiKey } from '../services/extraction';

interface BalanceAlertBannerProps {
  onShowSubscription: () => void;
}

const ALERT_CONFIG: Record<Exclude<BalanceAlertLevel, 'none'>, {
  bg: string;
  border: string;
  text: string;
  icon: typeof Info;
  ctaColor: string;
}> = {
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    icon: Info,
    ctaColor: 'text-blue-600 hover:text-blue-700 bg-blue-100 hover:bg-blue-200',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: AlertTriangle,
    ctaColor: 'text-amber-700 hover:text-amber-800 bg-amber-100 hover:bg-amber-200',
  },
  critical: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    icon: AlertCircle,
    ctaColor: 'text-red-700 hover:text-red-800 bg-red-100 hover:bg-red-200',
  },
};

function getMessage(
  level: Exclude<BalanceAlertLevel, 'none'>,
  balance: number,
  isUsingByok: boolean,
): string {
  if (level === 'critical' && isUsingByok) {
    return '크레딧 소진 — 개인 키로 분석 중';
  }
  switch (level) {
    case 'info':
      return `잔여 ${balance.toLocaleString()}cr — 이번 달 분석 계획을 세워보세요`;
    case 'warning':
      return `잔여 ${balance.toLocaleString()}cr — 패키지로 크레딧을 추가하세요`;
    case 'critical':
      return '크레딧 소진 — 플랜 업그레이드 또는 패키지 구매';
  }
}

export function BalanceAlertBanner({ onShowSubscription }: BalanceAlertBannerProps) {
  const subscription = useBillingSubscription();
  const byokMode = useByokMode();
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    const stored = new Set<string>();
    for (const level of ['info', 'warning', 'critical'] as const) {
      if (sessionStorage.getItem(`balance_alert_dismissed_${level}`)) {
        stored.add(level);
      }
    }
    return stored;
  });

  if (!subscription) return null;

  const level = getBalanceAlertLevel(subscription.creditBalance, subscription.monthlyCredits);
  if (level === 'none') return null;
  if (dismissed.has(level)) return null;

  const config = ALERT_CONFIG[level];
  const Icon = config.icon;
  const isUsingByok = !isBillingTestSubscription(subscription) && hasApiKey() && shouldUsePersonalKey(byokMode, subscription.creditBalance);
  const message = getMessage(level, subscription.creditBalance, isUsingByok);

  const handleDismiss = () => {
    sessionStorage.setItem(`balance_alert_dismissed_${level}`, '1');
    setDismissed((prev) => new Set(prev).add(level));
  };

  return (
    <div role="status" className={`${config.bg} border-b ${config.border} px-4 py-2.5`}>
      <div className="flex items-center justify-between gap-4">
        {/* 좌측: 상태 */}
        <div className="flex items-center gap-3 min-w-0">
          {isUsingByok && level === 'critical' ? (
            <Key aria-hidden="true" className="w-4 h-4 text-purple-600 flex-shrink-0" />
          ) : (
            <Icon aria-hidden="true" className={`w-4 h-4 ${config.text} flex-shrink-0`} />
          )}
          <span className={`text-sm font-medium ${config.text} truncate`}>
            {message}
          </span>
        </div>

        {/* 우측: CTA + 닫기 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onShowSubscription}
            className={`${level === 'info' ? 'text-sm font-medium underline underline-offset-2' : 'px-3 py-1 text-sm font-medium rounded-md'} transition-colors ${config.ctaColor}`}
          >
            {level === 'info' ? '플랜 보기' : level === 'warning' ? '크레딧 추가' : '업그레이드'}
          </button>
          <button
            onClick={handleDismiss}
            aria-label="알림 닫기"
            className={`p-1 rounded transition-colors ${config.text} opacity-50 hover:opacity-75`}
          >
            <X aria-hidden="true" className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
