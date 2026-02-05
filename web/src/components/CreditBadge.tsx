/**
 * 크레딧 잔액 배지 컴포넌트
 * 헤더에 표시되며, 클릭 시 구독 관리 모달 열기
 */

import { Coins } from 'lucide-react';
import { useBillingSubscription } from '../store';

interface CreditBadgeProps {
  onClick?: () => void;
  className?: string;
}

export function CreditBadge({ onClick, className = '' }: CreditBadgeProps) {
  const subscription = useBillingSubscription();

  if (!subscription) return null;

  const balance = subscription.creditBalance;
  const isLow = balance < 10;

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
        isLow
          ? 'bg-red-50 text-red-600 hover:bg-red-100'
          : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
      } ${className}`}
    >
      <Coins aria-hidden="true" className="w-4 h-4" />
      <span className="font-medium">{balance.toLocaleString()}</span>
      <span className="text-xs opacity-75">크레딧</span>
    </button>
  );
}
