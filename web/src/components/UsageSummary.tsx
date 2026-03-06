/**
 * 분석 완료 후 사용량 요약 모달
 */

import { X, FileCheck, Key } from 'lucide-react';
import { useStore, useCreditBalance, useModels, useByokEnabled, useSettledCredits } from '../store';
import { calculateSessionCreditsFromChunks, isBillingTestSubscription } from '../services/billing';
import { hasApiKey } from '../services/extraction';
import { useShowTokenDetails } from '../lib/useShowTokenDetails';
import { ModalOverlay } from './ModalOverlay';

export function UsageSummary() {
  const currentUsage = useStore((s) => s.currentUsage);
  const showUsageSummary = useStore((s) => s.showUsageSummary);
  const setShowUsageSummary = useStore((s) => s.setShowUsageSummary);
  const subscription = useStore((s) => s.subscription);
  const creditBalance = useCreditBalance();
  const showTokenDetails = useShowTokenDetails();
  const allModels = useModels();
  const byokEnabled = useByokEnabled();
  const settledCredits = useSettledCredits();
  const isUsingPersonalKey = !isBillingTestSubscription(subscription) && byokEnabled && hasApiKey();

  if (!showUsageSummary) return null;

  const totalChunks = new Set(currentUsage.chunks.map(c => c.chunkIndex)).size;
  const totalTokens = currentUsage.totalPromptTokens + currentUsage.totalCompletionTokens;

  // 서버 정산값(settledCredits) 우선, 없으면 클라이언트 근사치 폴백
  const creditsUsed = settledCredits ?? calculateSessionCreditsFromChunks(currentUsage.chunks, allModels);

  return (
    <ModalOverlay onClose={() => setShowUsageSummary(false)} maxWidth="md">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <FileCheck aria-hidden="true" className="w-5 h-5 text-green-600" />
            <h2 className="font-bold text-gray-800">분석 완료</h2>
          </div>
          <button
            onClick={() => setShowUsageSummary(false)}
            aria-label="닫기"
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X aria-hidden="true" className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* 내용 */}
        <div className="p-5 space-y-3">
          <div className="space-y-3">
            {isUsingPersonalKey && (
              <div className="flex items-center gap-1.5 text-sm text-purple-700">
                <Key aria-hidden="true" className="w-4 h-4" />
                <span>크레딧 차감 없음 — 개인 API 키 사용</span>
              </div>
            )}
            {!isUsingPersonalKey && creditsUsed > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">사용 크레딧</span>
                <span className="text-base font-bold text-blue-600">{creditsUsed.toLocaleString()} 크레딧</span>
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
            {creditBalance !== null && !isUsingPersonalKey && (
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
    </ModalOverlay>
  );
}
