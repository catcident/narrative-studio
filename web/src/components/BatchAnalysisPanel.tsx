/**
 * 일괄 분석 큐 패널
 * Pro+ 전용: 개별 파일 큐 상태 표시 + 전체 진행률
 */

import { useMemo } from 'react';
import { useAnalysisQueue, useIsQueueProcessing, useStore } from '../store';
import { useBatchAnalysis } from '../hooks/useBatchAnalysis';
import { CheckCircle, XCircle, Loader, Clock, Trash2, Play, Square, X } from 'lucide-react';
import type { QueueItem } from '../types';

function StatusIcon({ status }: { status: QueueItem['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock className="w-4 h-4 text-gray-400" aria-hidden="true" />;
    case 'processing':
      return <Loader className="w-4 h-4 text-blue-500 animate-spin" aria-hidden="true" />;
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-green-500" aria-hidden="true" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" aria-hidden="true" />;
    case 'cancelled':
      return <X className="w-4 h-4 text-gray-400" aria-hidden="true" />;
  }
}

export function BatchAnalysisPanel() {
  const queue = useAnalysisQueue();
  const isProcessing = useIsQueueProcessing();
  const removeFromQueue = useStore((s) => s.removeFromQueue);
  const clearQueue = useStore((s) => s.clearQueue);
  const { startProcessing, cancelProcessing } = useBatchAnalysis();

  const stats = useMemo(() => {
    let completed = 0;
    let failed = 0;
    let pending = 0;
    let processing = 0;
    for (const item of queue) {
      switch (item.status) {
        case 'completed': completed++; break;
        case 'failed': failed++; break;
        case 'pending': pending++; break;
        case 'processing': processing++; break;
      }
    }
    return { completed, failed, pending, processing, total: queue.length };
  }, [queue]);

  if (queue.length === 0) return null;

  const progressPercent = stats.total > 0
    ? Math.round(((stats.completed + stats.failed) / stats.total) * 100)
    : 0;

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-4 space-y-3"
      role="region"
      aria-label="일괄 분석 큐"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">
          일괄 분석 ({stats.completed + stats.failed}/{stats.total} 완료)
        </h3>
        <div className="flex items-center gap-2">
          {!isProcessing && stats.pending > 0 && (
            <button
              onClick={startProcessing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
              aria-label="일괄 분석 시작"
            >
              <Play className="w-3 h-3" aria-hidden="true" />
              시작
            </button>
          )}
          {isProcessing && (
            <button
              onClick={cancelProcessing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors"
              aria-label="일괄 분석 취소"
            >
              <Square className="w-3 h-3" aria-hidden="true" />
              중지
            </button>
          )}
          {!isProcessing && (
            <button
              onClick={clearQueue}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
              aria-label="큐 비우기"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              비우기
            </button>
          )}
        </div>
      </div>

      {/* 전체 진행률 바 */}
      <div
        className="w-full bg-gray-100 rounded-full h-2"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="전체 진행률"
      >
        <div
          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* 큐 아이템 목록 */}
      <ul className="space-y-1.5 max-h-60 overflow-y-auto" aria-live="polite">
        {queue.map((item) => (
          <li
            key={item.id}
            className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md ${
              item.status === 'processing' ? 'bg-blue-50' :
              item.status === 'completed' ? 'bg-green-50' :
              item.status === 'failed' ? 'bg-red-50' :
              'bg-gray-50'
            }`}
          >
            <StatusIcon status={item.status} />
            <span className="flex-1 truncate text-gray-700">{item.fileName}</span>

            {/* 개별 진행률 */}
            {item.status === 'processing' && item.progressTotal && item.progressTotal > 0 && (
              <span className="text-xs text-blue-500 whitespace-nowrap">
                {item.progressCurrent ?? 0}/{item.progressTotal}
              </span>
            )}

            {item.status === 'failed' && item.error && (
              <span className="text-xs text-red-500 truncate max-w-32" title={item.error}>
                {item.error}
              </span>
            )}

            {item.status === 'completed' && (
              <span className="text-xs text-green-500">완료</span>
            )}

            {item.status === 'cancelled' && (
              <span className="text-xs text-gray-400">취소됨</span>
            )}

            {/* 대기 중인 아이템만 삭제 가능 */}
            {item.status === 'pending' && !isProcessing && (
              <button
                onClick={() => removeFromQueue(item.id)}
                className="text-gray-400 hover:text-red-500 transition-colors"
                aria-label={`${item.fileName} 제거`}
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* 요약 */}
      {stats.failed > 0 && !isProcessing && (
        <p className="text-xs text-red-500">
          {stats.failed}개 파일 분석 실패
        </p>
      )}
    </div>
  );
}
