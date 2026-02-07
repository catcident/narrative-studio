/**
 * 관계도 그래프 서브 컴포넌트
 * SmallDotNode, RelationshipItem, SceneInfoPopup, EdgeDetailPopup
 */

import { useState } from 'react';
import {
  Handle,
  Position,
} from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { Entity, HyperEdge } from '../../types';
import { X } from 'lucide-react';
import { CATEGORY_COLORS, RELATION_COLORS, RELATION_LABELS } from '../../constants';

// --- Shared types ---

export type GraphViewMode = 'full' | 'simple' | 'focused';

export interface EntityWithOpacity extends Entity {
  isPastScene?: boolean;
}

export interface EdgeWithOpacity extends HyperEdge {
  isPastScene?: boolean;
}

export interface Scene {
  sceneId: string;
  time?: string;
  location?: string;
  summary?: string;
  mood?: string;
  events?: string[];
  charactersPresent?: string[];
  activeEdges?: string[];
}

export interface Props {
  entities: EntityWithOpacity[];
  edges: EdgeWithOpacity[];
  onNodeClick?: (entity: Entity) => void;
  selectedScene?: Scene | null;
  sceneIndex?: number;
  onShowSubscription?: () => void;
}

// --- Sub-components ---

// 작은 원 + 밑에 라벨 커스텀 노드
export function SmallDotNode({ data }: NodeProps) {
  const entity = data.entity as Entity;
  const isPast = data.isPast as boolean;
  const color = CATEGORY_COLORS[entity?.category] || '#9ca3af';

  return (
    <div className="flex flex-col items-center" style={{ opacity: isPast ? 0.35 : 1 }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: color,
          border: '2px solid white',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        }}
      />
      <div
        style={{
          marginTop: 6,
          fontSize: 10,
          color: '#6b7280',
          fontWeight: 400,
          whiteSpace: 'nowrap',
        }}
      >
        {entity?.name || ''}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

// 커스텀 노드 타입
export const nodeTypes = {
  smallDot: SmallDotNode,
};

// 관계 항목 (호버/클릭 시 상세 보기)
export function RelationshipItem({
  edge,
  entities,
  isExpanded,
  onToggle,
}: {
  edge: HyperEdge;
  entities: Entity[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const relationLabel = RELATION_LABELS[edge.type] || edge.type;
  const color = RELATION_COLORS[edge.type] || '#9ca3af';

  // 대상 엔티티 이름
  const targetNames = edge.entities
    .map(id => entities.find(e => e.id === id)?.name || id)
    .join(', ');

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 클릭 가능한 관계 항목 */}
      <button
        onClick={onToggle}
        className={`w-full text-left px-2 py-1.5 rounded-lg transition-all text-xs ${
          isExpanded
            ? 'bg-white shadow-sm border border-gray-200'
            : 'hover:bg-white/60'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
            style={{ backgroundColor: color }}
          >
            {relationLabel}
          </span>
          <span className="text-gray-500">→</span>
          <span className="text-gray-700 font-medium truncate">{targetNames}</span>
        </div>

        {/* 설명 미리보기 */}
        {edge.statement && !isExpanded && (
          <p className="mt-0.5 text-[10px] text-gray-400 truncate pl-1">
            {edge.statement}
          </p>
        )}
      </button>

      {/* 확장된 상세 내용 */}
      {isExpanded && edge.statement && (
        <div className="mt-1 mx-1 p-2 bg-blue-50 rounded-lg border border-blue-100">
          <p className="text-xs text-gray-700 leading-relaxed">{edge.statement}</p>
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
            </div>
          )}
        </div>
      )}

      {/* 호버 시 툴팁 (확장 안 된 상태에서만) */}
      {isHovered && !isExpanded && edge.statement && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 p-2 bg-gray-800 text-white text-[10px] rounded-lg shadow-lg max-w-xs">
          <p className="leading-relaxed">{edge.statement}</p>
          <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-800 rotate-45" />
        </div>
      )}
    </div>
  );
}

// 장면 정보 팝업 (관계 목록 포함)
export function SceneInfoPopup({
  scene,
  sceneIndex,
  edges,
  entities,
  onClose,
}: {
  scene: Scene;
  sceneIndex: number;
  edges: HyperEdge[];
  entities: Entity[];
  onClose: () => void;
}) {
  const [expandedEdgeId, setExpandedEdgeId] = useState<string | null>(null);

  // 이 장면의 관계만 필터링
  const sceneEdges = edges.filter(e =>
    e.scenes?.includes(scene.sceneId) ||
    scene.activeEdges?.includes(e.id)
  );

  return (
    <div className="absolute top-3 right-3 z-50 w-72 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold">장면 {sceneIndex}</div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-blue-100">
              {scene.location && <span>{scene.location}</span>}
              {scene.time && scene.location && <span>·</span>}
              {scene.time && <span>{scene.time}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 장면 요약 */}
      {scene.summary && (
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">
            {scene.summary}
          </p>
        </div>
      )}

      {/* 관계 목록 */}
      <div className="px-3 py-2 max-h-64 overflow-y-auto">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
          이 장면의 관계 ({sceneEdges.length})
        </div>

        {sceneEdges.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">
            이 장면에 관계 정보가 없습니다
          </p>
        ) : (
          <div className="space-y-1">
            {sceneEdges.map((edge) => (
              <RelationshipItem
                key={edge.id}
                edge={edge}
                entities={entities}
                isExpanded={expandedEdgeId === edge.id}
                onToggle={() => setExpandedEdgeId(
                  expandedEdgeId === edge.id ? null : edge.id
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* 분위기/이벤트 */}
      {(scene.mood || (scene.events && scene.events.length > 0)) && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <div className="flex flex-wrap gap-1">
            {scene.mood && (
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] rounded">
                {scene.mood}
              </span>
            )}
            {scene.events?.map((event, i) => (
              <span key={i} className="px-2 py-0.5 bg-gray-200 text-gray-600 text-[10px] rounded">
                {event}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 선택된 관계 정보를 표시하는 팝업
export function EdgeDetailPopup({
  edge,
  entities,
  onClose
}: {
  edge: HyperEdge;
  entities: Entity[];
  onClose: () => void;
}) {
  const relationLabel = RELATION_LABELS[edge.type] || edge.type;
  const entityNames = edge.entities
    .map(id => entities.find(e => e.id === id)?.name || id)
    .join(' ↔ ');

  return (
    <div className="absolute bottom-4 left-4 right-4 z-50 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 max-w-md">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span
            className="text-xs font-bold px-2 py-1 rounded"
            style={{
              backgroundColor: (RELATION_COLORS[edge.type] || '#9ca3af') + '20',
              color: RELATION_COLORS[edge.type] || '#666'
            }}
          >
            {relationLabel}
          </span>
          {edge.sentiment && (
            <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
              edge.sentiment === 'positive' ? 'bg-green-100 text-green-700' :
              edge.sentiment === 'negative' ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {edge.sentiment === 'positive' ? '긍정' :
               edge.sentiment === 'negative' ? '부정' : '중립'}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="닫기"
        >
          <X className="w-4 h-4 text-gray-400" aria-hidden="true" />
        </button>
      </div>

      <div className="text-sm font-medium text-gray-800 mb-2">
        {entityNames}
      </div>

      {edge.statement && (
        <p className="text-sm text-gray-600 leading-relaxed mb-3">
          {edge.statement}
        </p>
      )}

      <div className="flex items-center gap-4 text-xs text-gray-400">
        {edge.strength && (
          <div className="flex items-center gap-1">
            <span>강도:</span>
            <div className="flex gap-0.5">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-2 rounded-sm ${
                    i < edge.strength! ? 'bg-blue-400' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
          </div>
        )}
        {edge.scenes && edge.scenes.length > 0 && (
          <span>장면: {edge.scenes.join(', ')}</span>
        )}
      </div>
    </div>
  );
}
