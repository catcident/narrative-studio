/**
 * 부분 분석 인디케이터 배너
 * 메인 뷰어 header 아래에 표시 — 중단된 분석을 이어하기 유도
 */

import { AlertTriangle, Play, Trash2, Loader2 } from 'lucide-react';
import type { PartialAnalysisInfo } from '../types';

interface PartialAnalysisBannerProps {
  partialAnalysis: PartialAnalysisInfo;
  onResume: () => void;
  onClear: () => void;
  isResuming: boolean;
  resumeProgress: string;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 0) return '방금 전';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '방금 전';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

export function PartialAnalysisBanner({
  partialAnalysis,
  onResume,
  onClear,
  isResuming,
  resumeProgress,
}: PartialAnalysisBannerProps) {
  const { processedChunks, totalChunks, title, timestamp } = partialAnalysis;
  const percent = totalChunks > 0 ? Math.round((processedChunks / totalChunks) * 100) : 0;

  return (
    <div role="status" className="bg-amber-50 border-b border-amber-200 px-4 py-2.5">
      <div className="flex items-center justify-between gap-4">
        {/* 좌측: 상태 정보 */}
        <div className="flex items-center gap-3 min-w-0">
          {isResuming ? (
            <Loader2 aria-hidden="true" className="w-4 h-4 text-amber-600 animate-spin flex-shrink-0" />
          ) : (
            <AlertTriangle aria-hidden="true" className="w-4 h-4 text-amber-600 flex-shrink-0" />
          )}

          <div className="flex items-center gap-2 text-sm min-w-0">
            {isResuming ? (
              <span className="text-amber-800 font-medium truncate">
                {resumeProgress || '이어하기 진행 중...'}
              </span>
            ) : (
              <>
                <span className="text-amber-800 font-medium truncate">
                  미완료: {title}
                </span>
                <span className="text-amber-600 flex-shrink-0">
                  {processedChunks}/{totalChunks} 청크
                </span>
                <span className="text-amber-400 flex-shrink-0" aria-hidden="true">·</span>
                <span className="text-amber-500 flex-shrink-0">
                  {formatRelativeTime(timestamp)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 우측: 진행률 바 + 액션 */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* 진행률 바 */}
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`분석 진행률 ${percent}%`}
            className="w-24 h-2 bg-amber-200 rounded-full overflow-hidden"
          >
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>

          {isResuming ? (
            <span className="text-xs text-amber-600 font-medium">분석 중...</span>
          ) : (
            <>
              <button
                onClick={onResume}
                className="flex items-center gap-1.5 px-3 py-1 text-sm font-medium text-amber-800 bg-amber-200 hover:bg-amber-300 rounded-md transition-colors"
              >
                <Play aria-hidden="true" className="w-3.5 h-3.5" />
                이어하기
              </button>
              <button
                onClick={onClear}
                aria-label="저장된 분석 진행상황 삭제"
                className="p-1 text-amber-400 hover:text-amber-600 rounded transition-colors"
              >
                <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
