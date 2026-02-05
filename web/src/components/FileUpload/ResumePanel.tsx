/**
 * 이어하기, 추가 분석, 중복 파일명 대화상자, 에러 표시 컴포넌트
 */

import { Plus, RotateCcw, Play, Trash2, AlertCircle } from 'lucide-react';
import type { ExtractionProgress } from '../../services/extraction';
import type { NovelKnowledgeGraph } from '../../types';

interface ResumePanelProps {
  knowledgeGraph: NovelKnowledgeGraph | null;
  localLoading: boolean;
  savedProgress: ExtractionProgress | null;
  handleResume: () => void;
  handleClearProgress: () => void;
  handleAddChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  duplicateFileName: string | null;
  newFileName: string;
  setNewFileName: (v: string) => void;
  handleConfirmNewFileName: () => void;
  handleCancelDuplicate: () => void;
  error: string | null;
}

export function ResumePanel({
  knowledgeGraph,
  localLoading,
  savedProgress,
  handleResume,
  handleClearProgress,
  handleAddChange,
  duplicateFileName,
  newFileName,
  setNewFileName,
  handleConfirmNewFileName,
  handleCancelDuplicate,
  error,
}: ResumePanelProps) {
  return (
    <>
      {/* 추가 분석 버튼 (기존 결과가 있을 때만) */}
      {knowledgeGraph && !localLoading && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Plus aria-hidden="true" className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-blue-800">추가 분석</p>
              <p className="text-sm text-blue-700 mt-1">
                현재 "{knowledgeGraph.metadata.title}"에 새 파일을 추가할 수 있습니다
              </p>
              <div className="flex gap-2 mt-3">
                <label className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors cursor-pointer">
                  <Plus aria-hidden="true" className="w-4 h-4" />
                  파일 추가
                  <input
                    type="file"
                    accept=".txt,.pdf,.md,text/plain,text/markdown,application/pdf"
                    onChange={handleAddChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 이어하기 UI */}
      {savedProgress && !localLoading && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3">
            <RotateCcw aria-hidden="true" className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-800">이전 분석 발견</p>
              <p className="text-sm text-amber-700 mt-1">
                "{savedProgress.title}" - {savedProgress.processedChunks}/{savedProgress.totalChunks} 청크 완료
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleResume}
                  className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 transition-colors"
                >
                  <Play aria-hidden="true" className="w-4 h-4" />
                  이어하기
                </button>
                <button
                  onClick={handleClearProgress}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition-colors"
                >
                  <Trash2 aria-hidden="true" className="w-4 h-4" />
                  삭제
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 중복 파일명 경고 모달 */}
      {duplicateFileName && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={(e) => e.key === 'Escape' && handleCancelDuplicate()}>
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle aria-hidden="true" className="w-6 h-6 text-amber-500 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-gray-900">중복 파일명</h3>
                <p className="text-sm text-gray-600 mt-1">
                  "{duplicateFileName}" 파일이 이미 존재합니다.
                </p>
                <p className="text-sm text-gray-600">
                  새로운 파일명을 입력해주세요.
                </p>
              </div>
            </div>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="새 파일명 입력"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmNewFileName();
                if (e.key === 'Escape') handleCancelDuplicate();
              }}
            />
            {error && (
              <p className="text-sm text-red-600 mb-3">{error}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelDuplicate}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                취소
              </button>
              <button
                onClick={handleConfirmNewFileName}
                disabled={!newFileName.trim()}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 에러 메시지 */}
      {error && !duplicateFileName && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertCircle aria-hidden="true" className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">오류 발생</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}
    </>
  );
}
