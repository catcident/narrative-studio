import React, { useState } from 'react';
import type { HyperEdge } from '../../types';
import { RELATION_LABELS } from '../../constants';

// 관계 항목 컴포넌트 (호버/클릭 가능)
export function RelationshipItemWithTooltip({
  edge,
  charId,
  entities,
  colors,
}: {
  edge: HyperEdge;
  charId: string;
  entities: Record<string, any>;
  colors: { bg: string; border: string; text: string };
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // 관계 상대방 이름 추출 (현재 캐릭터 제외)
  const partnerNames = edge.entities
    .filter(id => id !== charId)
    .map(id => entities[id]?.name || id)
    .join(', ');

  const relationLabel = RELATION_LABELS[edge.type] || edge.type;

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        className={`w-full text-left text-sm leading-relaxed border-l-2 pl-2 transition-all rounded-r cursor-pointer ${
          isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'
        }`}
        style={{ borderColor: colors.border }}
      >
        {/* 관계 유형 + 상대방 */}
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="inline-block px-1.5 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: colors.bg,
              color: colors.text,
            }}
          >
            {relationLabel}
          </span>
          {partnerNames && (
            <span className="text-xs font-medium text-gray-800">
              → {partnerNames}
            </span>
          )}
          <span className={`ml-auto text-[10px] text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </div>
        {/* 설명 미리보기 (축소 시) */}
        {edge.statement && !isExpanded && (
          <p className="text-gray-500 text-[10px] leading-relaxed truncate">
            {edge.statement}
          </p>
        )}
      </button>

      {/* 확장된 상세 내용 */}
      {isExpanded && (
        <div className="mt-1 p-2 bg-blue-50 rounded border border-blue-100 ml-2">
          {/* 원문 인용 (있으면 먼저 표시) */}
          {edge.quote && (
            <div className="mb-2 p-2 bg-amber-50 border-l-2 border-amber-400 rounded-r">
              <p className="text-xs text-amber-900 leading-relaxed italic">"{edge.quote}"</p>
              <span className="text-[10px] text-amber-600 mt-1 block">원문</span>
            </div>
          )}
          {/* 설명 */}
          {edge.statement && (
            <p className="text-xs text-gray-700 leading-relaxed">{edge.statement}</p>
          )}
          {edge.strength && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400">
              <span>강도:</span>
              <div className="flex gap-0.5">
                {[...Array(10)].map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 h-1.5 rounded-sm ${
                      i < edge.strength! ? 'bg-blue-400' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
              <span>{edge.strength}/10</span>
            </div>
          )}
        </div>
      )}

      {/* 호버 툴팁 (확장 안 됐을 때만) */}
      {isHovered && !isExpanded && (edge.statement || edge.quote) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 p-2 bg-gray-800 text-white text-[10px] rounded-lg shadow-lg">
          {edge.quote && (
            <p className="leading-relaxed italic text-amber-200 mb-1">"{edge.quote}"</p>
          )}
          {edge.statement && (
            <p className="leading-relaxed">{edge.statement}</p>
          )}
          {edge.strength && (
            <div className="mt-1 text-gray-300">강도: {edge.strength}/10</div>
          )}
          <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-800 rotate-45" />
        </div>
      )}
    </div>
  );
}
