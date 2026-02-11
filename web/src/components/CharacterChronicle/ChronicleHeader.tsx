import React from 'react';
import { Clock, X, ZoomIn, ZoomOut, Search } from 'lucide-react';
import { AiGeneratedBadge } from '../AiGeneratedBadge';

interface ChronicleHeaderProps {
  characterCount: number;
  totalSceneCount: number;
  showJumpInput: boolean;
  setShowJumpInput: (show: boolean) => void;
  jumpValue: string;
  setJumpValue: (value: string) => void;
  handleJumpSubmit: () => void;
  pageStart: number;
  pageEnd: number;
  zoomIndex: number;
  zoomLevel: number;
  zoomLevelsLength: number;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  selectedCharId: string | null;
  setSelectedCharId: (id: string | null) => void;
}

export function ChronicleHeader({
  characterCount,
  totalSceneCount,
  showJumpInput,
  setShowJumpInput,
  jumpValue,
  setJumpValue,
  handleJumpSubmit,
  pageStart,
  pageEnd,
  zoomIndex,
  zoomLevel,
  zoomLevelsLength,
  handleZoomIn,
  handleZoomOut,
  selectedCharId,
  setSelectedCharId,
}: ChronicleHeaderProps) {
  return (
    <div className="p-3 bg-white border-b border-gray-200 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-gray-500" aria-hidden="true" />
        <span className="text-sm font-medium text-gray-700">캐릭터 연대기</span>
        <AiGeneratedBadge />
        <span className="text-xs text-gray-400">
          {characterCount}명 · {totalSceneCount}개 장면
        </span>
      </div>
      <div className="flex items-center gap-2">
        {/* 장면 점프 */}
        {showJumpInput ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={totalSceneCount}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJumpSubmit()}
              placeholder={`1-${totalSceneCount}`}
              className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button
              onClick={handleJumpSubmit}
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              이동
            </button>
            <button
              onClick={() => { setShowJumpInput(false); setJumpValue(''); }}
              className="p-1 text-gray-400 hover:text-gray-600"
              aria-label="닫기"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowJumpInput(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="장면으로 이동"
          >
            <Search className="w-3 h-3" aria-hidden="true" />
            장면 이동
          </button>
        )}

        {/* 현재 페이지 위치 */}
        <div className="flex items-center gap-1 border-l border-gray-200 pl-2">
          <span className="text-xs text-gray-600">
            {pageStart + 1}-{pageEnd} / {totalSceneCount}
          </span>
        </div>

        {/* 줌 컨트롤 */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg px-1 py-0.5">
          <button
            onClick={handleZoomOut}
            disabled={zoomIndex === 0}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="축소"
            aria-label="축소"
          >
            <ZoomOut className="w-4 h-4 text-gray-600" aria-hidden="true" />
          </button>
          <span className="text-xs text-gray-600 min-w-[40px] text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            disabled={zoomIndex === zoomLevelsLength - 1}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="확대"
            aria-label="확대"
          >
            <ZoomIn className="w-4 h-4 text-gray-600" aria-hidden="true" />
          </button>
        </div>
        {selectedCharId && (
          <button
            onClick={() => setSelectedCharId(null)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-3 h-3" aria-hidden="true" />
            선택 해제
          </button>
        )}
      </div>
    </div>
  );
}
