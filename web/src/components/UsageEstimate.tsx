/**
 * 분석 전 예상 비용 표시 컴포넌트
 * 로컬 계산 (API 호출 없음), 크레딧 중심 표시
 */

import { useMemo } from 'react';
import { Calculator, AlertTriangle, CheckCircle } from 'lucide-react';
import { estimateUsageLocally } from '../services/billing';
import { useCreditBalance } from '../store';
import { useShowTokenDetails } from '../lib/useShowTokenDetails';

interface UsageEstimateProps {
  charCount: number;
  model: string;
}

export function UsageEstimate({ charCount, model }: UsageEstimateProps) {
  const creditBalance = useCreditBalance();
  const showTokenDetails = useShowTokenDetails();

  const estimate = useMemo(
    () => estimateUsageLocally(charCount, model),
    [charCount, model],
  );

  if (estimate.chunks === 0) return null;

  const canAfford = creditBalance !== null
    ? creditBalance >= estimate.estimated_credits
    : true;

  return (
    <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm">
      <div className="flex items-center gap-1.5 text-gray-600 mb-2">
        <Calculator aria-hidden="true" className="w-4 h-4" />
        <span className="font-medium">예상 사용량</span>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-gray-700 font-medium">예상 비용</span>
          <span className={`font-bold ${canAfford ? 'text-blue-600' : 'text-red-600'}`}>
            ~{estimate.estimated_credits.toLocaleString()} 크레딧
          </span>
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>청크 수</span>
          <span>{estimate.chunks}개</span>
        </div>
        {showTokenDetails && (
          <div className="flex justify-between text-xs text-gray-400">
            <span>예상 토큰</span>
            <span>
              ~{estimate.estimated_input_tokens.toLocaleString()} input / ~{estimate.estimated_output_tokens.toLocaleString()} output
            </span>
          </div>
        )}
        {creditBalance !== null && (
          <div className="flex items-center gap-1 text-xs pt-1 border-t border-gray-200">
            {canAfford ? (
              <>
                <CheckCircle aria-hidden="true" className="w-3.5 h-3.5 text-green-500" />
                <span className="text-green-600">
                  분석 가능 (잔액: {creditBalance.toLocaleString()})
                </span>
              </>
            ) : (
              <>
                <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5 text-red-500" />
                <span className="text-red-600">
                  잔액 부족 (잔액: {creditBalance.toLocaleString()})
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
