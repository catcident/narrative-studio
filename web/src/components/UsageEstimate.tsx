/**
 * 분석 전 예상 비용 표시 컴포넌트
 */

import { useEffect, useState } from 'react';
import { Calculator, AlertTriangle, CheckCircle } from 'lucide-react';
import { estimateCredits, type UsageEstimate as UsageEstimateType } from '../services/billing';
import { useCreditBalance } from '../store';

interface UsageEstimateProps {
  charCount: number;
  model: string;
}

export function UsageEstimate({ charCount, model }: UsageEstimateProps) {
  const [estimate, setEstimate] = useState<UsageEstimateType | null>(null);
  const [loading, setLoading] = useState(false);
  const creditBalance = useCreditBalance();

  useEffect(() => {
    if (charCount <= 0 || !model) {
      setEstimate(null);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      const result = await estimateCredits(charCount, model);
      setEstimate(result);
      setLoading(false);
    }, 300); // debounce

    return () => clearTimeout(timer);
  }, [charCount, model]);

  if (!estimate && !loading) return null;

  const canAfford = creditBalance !== null && estimate
    ? creditBalance >= estimate.estimated_credits
    : true;

  return (
    <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm">
      <div className="flex items-center gap-1.5 text-gray-600 mb-2">
        <Calculator aria-hidden="true" className="w-4 h-4" />
        <span className="font-medium">예상 사용량</span>
      </div>

      {loading ? (
        <div className="text-gray-400 text-xs">계산 중...</div>
      ) : estimate ? (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>예상 토큰</span>
            <span>
              ~{estimate.estimated_input_tokens.toLocaleString()} input / ~{estimate.estimated_output_tokens.toLocaleString()} output
            </span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>청크 수</span>
            <span>{estimate.chunks}개</span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-gray-200">
            <span className="text-gray-700 font-medium">예상 비용</span>
            <span className={`font-bold ${canAfford ? 'text-blue-600' : 'text-red-600'}`}>
              ~{estimate.estimated_credits} 크레딧
            </span>
          </div>
          {creditBalance !== null && (
            <div className="flex items-center gap-1 text-xs pt-1">
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
      ) : null}
    </div>
  );
}
