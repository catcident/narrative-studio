/**
 * 크레딧 잔액 배지 컴포넌트
 * 헤더에 표시되며, 클릭 시 구독 관리 모달 열기
 */

import { Coins, Key } from 'lucide-react';
import { useBillingSubscription, useByokMode } from '../store';
import { shouldUsePersonalKey, hasApiKey } from '../services/extraction';

interface CreditBadgeProps {
  onClick?: () => void;
  className?: string;
}

export function CreditBadge({ onClick, className = '' }: CreditBadgeProps) {
  const subscription = useBillingSubscription();
  const byokMode = useByokMode();

  if (!subscription) return null;

  const balance = subscription.creditBalance;
  const isLow = balance < 10;
  const isUsingByok = hasApiKey() && shouldUsePersonalKey(byokMode, balance);

  function getColorClass(): string {
    if (isUsingByok) return 'bg-purple-50 text-purple-700 hover:bg-purple-100';
    if (isLow) return 'bg-red-50 text-red-600 hover:bg-red-100';
    return 'bg-amber-50 text-amber-700 hover:bg-amber-100';
  }

  return (
    <button
      onClick={onClick}
      aria-label={isUsingByok ? '개인 키 사용 중 — 구독 관리' : '크레딧 잔액 및 구독 관리'}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${getColorClass()} ${className}`}
    >
      {isUsingByok ? (
        <Key aria-hidden="true" className="w-4 h-4" />
      ) : (
        <Coins aria-hidden="true" className="w-4 h-4" />
      )}
      <span className="font-medium tabular-nums">{balance.toLocaleString()}</span>
      <span className="text-xs opacity-75">{isUsingByok ? '개인 키' : '크레딧'}</span>
    </button>
  );
}
