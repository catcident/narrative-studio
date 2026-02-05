/**
 * 분석 완료 후 사용량 요약 모달
 */

import { X, FileCheck } from 'lucide-react';
import { useStore, useCreditBalance } from '../store';
import { calculateCreditsFromTokens } from '../services/billing';
import { useShowTokenDetails } from '../lib/useShowTokenDetails';

export function UsageSummary() {
  const { currentUsage, showUsageSummary, setShowUsageSummary } = useStore();
  const creditBalance = useCreditBalance();
  const showTokenDetails = useShowTokenDetails();

  if (!showUsageSummary) return null;

  const totalChunks = currentUsage.chunks.length;
  const totalTokens = currentUsage.totalPromptTokens + currentUsage.totalCompletionTokens;

  // 실제 토큰에서 크레딧 역산
  const model = currentUsage.chunks[0]?.model ?? '';
  const creditsUsed = calculateCreditsFromTokens(
    currentUsage.totalPromptTokens,
    currentUsage.totalCompletionTokens,
    model,
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <FileCheck aria-hidden="true" className="w-5 h-5 text-green-600" />
            <h2 className="font-bold text-gray-800">분석 완료</h2>
          </div>
          <button
            onClick={() => setShowUsageSummary(false)}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X aria-hidden="true" className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* 내용 */}
        <div className="p-6 space-y-4">
          <div className="space-y-3">
            {creditsUsed > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">사용 크레딧</span>
                <span className="font-bold text-blue-600">~{creditsUsed.toLocaleString()} 크레딧</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">총 청크</span>
              <span className="font-medium text-gray-800">{totalChunks}개</span>
            </div>
            {showTokenDetails && totalTokens > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">사용 토큰</span>
                <span className="text-gray-400">
                  {totalTokens.toLocaleString()} ({currentUsage.totalPromptTokens.toLocaleString()} in + {currentUsage.totalCompletionTokens.toLocaleString()} out)
                </span>
              </div>
            )}
            {creditBalance !== null && (
              <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                <span className="text-gray-500">잔여 크레딧</span>
                <span className="font-medium text-gray-800">{creditBalance.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* 푸터 */}
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={() => setShowUsageSummary(false)}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
