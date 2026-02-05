/**
 * 크레딧 사용 내역 테이블
 */

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getUsageHistory, type TransactionsResponse } from '../services/billing';
import type { CreditTransaction } from '../types';

const TX_TYPE_COLORS: Record<string, string> = {
  MONTHLY_GRANT: 'text-green-600',
  PURCHASE: 'text-green-600',
  REFUND: 'text-green-600',
  ADMIN_ADJUST: 'text-blue-600',
  USAGE: 'text-red-600',
  EXPIRY: 'text-gray-500',
};

export function UsageHistory() {
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getUsageHistory(page).then(result => {
      if (cancelled) return;
      if (!result.ok) {
        setError(true);
      } else {
        setData(result.data);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [page]);

  if (loading) {
    return <div className="text-center text-gray-400 py-8">로딩 중...</div>;
  }

  if (error || !data) {
    return <div className="text-center text-red-400 py-8">사용 내역을 불러올 수 없습니다.</div>;
  }

  if (data.results.length === 0) {
    return <div className="text-center text-gray-400 py-8">사용 내역이 없습니다.</div>;
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-gray-500">
            <th className="text-left py-2 font-medium">일시</th>
            <th className="text-left py-2 font-medium">유형</th>
            <th className="text-left py-2 font-medium">설명</th>
            <th className="text-right py-2 font-medium">금액</th>
            <th className="text-right py-2 font-medium">잔액</th>
          </tr>
        </thead>
        <tbody>
          {data.results.map((tx: CreditTransaction) => {
            const isPositive = tx.amount > 0;
            const color = TX_TYPE_COLORS[tx.tx_type] || 'text-gray-600';
            return (
              <tr key={tx.id} className="border-b border-gray-100">
                <td className="py-2 text-gray-500">
                  {new Date(tx.created_at).toLocaleDateString('ko-KR', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className={`py-2 ${color}`}>
                  {tx.tx_type_display}
                </td>
                <td className="py-2 text-gray-700 max-w-48 truncate">
                  {tx.description}
                </td>
                <td className={`py-2 text-right font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                  {isPositive ? '+' : ''}{tx.amount}
                </td>
                <td className="py-2 text-right text-gray-600">
                  {tx.balance_after.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 페이지네이션 */}
      {(data.previous || data.next) && (
        <div className="flex items-center justify-center gap-4 mt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={!data.previous}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors disabled:text-gray-300 disabled:cursor-not-allowed text-gray-600 hover:bg-gray-100"
          >
            <ChevronLeft aria-hidden="true" className="w-4 h-4" />
            이전
          </button>
          <span className="text-sm text-gray-500">
            {page} 페이지
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!data.next}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors disabled:text-gray-300 disabled:cursor-not-allowed text-gray-600 hover:bg-gray-100"
          >
            다음
            <ChevronRight aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
