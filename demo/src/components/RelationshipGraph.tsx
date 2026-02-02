/**
 * 인물 관계도 그래프 컴포넌트
 * React Flow를 사용한 하이퍼그래프 시각화
 * 인물 중심 원형 배치 + 연결 없는 노드는 외곽 배치
 */

import { useCallback, useMemo, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  Handle,
  Position,
} from '@xyflow/react';
import type { Node, Edge, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../store';
import type { Entity, HyperEdge, EntityCategory } from '../types';
import { X, Eye, EyeOff, Focus, Filter } from 'lucide-react';

type GraphViewMode = 'full' | 'simple' | 'focused';

// 카테고리별 색상
const CATEGORY_COLORS: Record<EntityCategory, string> = {
  character: '#3b82f6',
  location: '#22c55e',
  organization: '#a855f7',
  item: '#f59e0b',
  creature: '#ef4444',
  event: '#ec4899',
  concept: '#6366f1',
  time_period: '#14b8a6',
  status: '#64748b',
  emotion: '#f43f5e',
};

// 관계 유형별 색상
const RELATION_COLORS: Record<string, string> = {
  '가족': '#8b5cf6',
  '연인': '#ec4899',
  '친구': '#22c55e',
  '적대': '#ef4444',
  '동료': '#3b82f6',
  '주인': '#f59e0b',
  '위치': '#14b8a6',
  '소유': '#f59e0b',
  '관련': '#9ca3af',
  family: '#8b5cf6',
  romantic: '#ec4899',
  friendship: '#22c55e',
  rivalry: '#ef4444',
  mentor: '#3b82f6',
  subordinate: '#64748b',
  belongs_to: '#a855f7',
  owns: '#f59e0b',
  rules: '#dc2626',
  located_at: '#14b8a6',
  occurred_at: '#06b6d4',
  during: '#64748b',
  participates: '#3b82f6',
  causes: '#ef4444',
  transforms: '#f59e0b',
  knows: '#6366f1',
  has_status: '#64748b',
  related_to: '#9ca3af',
};

const RELATION_LABELS: Record<string, string> = {
  family: '가족',
  romantic: '연인',
  friendship: '친구',
  rivalry: '적대',
  mentor: '스승',
  subordinate: '부하',
  belongs_to: '소속',
  owns: '소유',
  rules: '지배',
  located_at: '위치',
  occurred_at: '발생',
  during: '기간',
  participates: '참여',
  causes: '원인',
  transforms: '변화',
  knows: '아는 사이',
  has_status: '상태',
  related_to: '관련',
};

const SENTIMENT_STYLES = {
  positive: { strokeDasharray: 'none' },
  negative: { strokeDasharray: '5,5' },
  neutral: { strokeDasharray: '2,2' },
  complex: { strokeDasharray: '10,5,2,5' },
};

interface EntityWithOpacity extends Entity {
  isPastScene?: boolean;
}

interface EdgeWithOpacity extends HyperEdge {
  isPastScene?: boolean;
}

interface Props {
  entities: EntityWithOpacity[];
  edges: EdgeWithOpacity[];
  onNodeClick?: (entity: Entity) => void;
}

// 작은 원 + 밑에 라벨 커스텀 노드
function SmallDotNode({ data }: NodeProps) {
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
const nodeTypes = {
  smallDot: SmallDotNode,
};

// 선택된 관계 정보를 표시하는 팝업
function EdgeDetailPopup({
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
        >
          <X className="w-4 h-4 text-gray-400" />
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

export function RelationshipGraph({ entities, edges, onNodeClick }: Props) {
  const { selectedEntityId, selectEntity } = useStore();
  const [selectedEdge, setSelectedEdge] = useState<HyperEdge | null>(null);
  const [viewMode, setViewMode] = useState<GraphViewMode>('full');
  const [focusedCharId, setFocusedCharId] = useState<string | null>(null);
  const [minImportance, setMinImportance] = useState<number>(1);  // 최소 중요도 필터

  // 인물 목록 추출
  const characters = useMemo(() =>
    entities.filter(e => e.category === 'character'),
    [entities]
  );

  // 중요도 필터 적용
  const importanceFilteredEntities = useMemo(() => {
    if (minImportance <= 1) return entities;
    // 인물은 항상 표시, 나머지는 중요도 필터 적용
    return entities.filter(e =>
      e.category === 'character' || (e.importance || 5) >= minImportance
    );
  }, [entities, minImportance]);

  const importanceFilteredEdges = useMemo(() => {
    if (minImportance <= 1) return edges;
    const entityIds = new Set(importanceFilteredEntities.map(e => e.id));
    return edges.filter(e => e.entities.every(id => entityIds.has(id)));
  }, [edges, importanceFilteredEntities, minImportance]);

  // 인물 중심 모드: 해당 인물이 직접 연결된 것만 표시
  const { filteredEntities, filteredEdges } = useMemo(() => {
    if (viewMode !== 'focused' || !focusedCharId) {
      return { filteredEntities: importanceFilteredEntities, filteredEdges: importanceFilteredEdges };
    }

    // 포커스된 인물이 직접 연결된 관계만 필터링
    const fEdges = importanceFilteredEdges.filter(e => e.entities.includes(focusedCharId));

    // 해당 관계에 포함된 엔티티만 표시 (포커스된 인물 + 직접 연결된 엔티티들)
    const relatedEntityIds = new Set<string>([focusedCharId]);
    fEdges.forEach(edge => {
      edge.entities.forEach(id => relatedEntityIds.add(id));
    });

    const fEntities = importanceFilteredEntities.filter(e => relatedEntityIds.has(e.id));

    return { filteredEntities: fEntities, filteredEdges: fEdges };
  }, [importanceFilteredEntities, importanceFilteredEdges, viewMode, focusedCharId]);

  // 간소화 모드: 인물만 표시
  const displayEntities = useMemo(() => {
    if (viewMode === 'simple') {
      return filteredEntities.filter(e => e.category === 'character');
    }
    return filteredEntities;
  }, [filteredEntities, viewMode]);

  const displayEdges = useMemo(() => {
    if (viewMode === 'simple') {
      // 인물 간의 관계만 표시
      const charIds = new Set(displayEntities.map(e => e.id));
      return filteredEdges.filter(e =>
        e.entities.every(id => charIds.has(id))
      );
    }
    return filteredEdges;
  }, [filteredEdges, displayEntities, viewMode]);

  if (entities.length === 0) {
    return (
      <div className="w-full h-full bg-gray-50 rounded-xl flex items-center justify-center">
        <p className="text-gray-500">표시할 엔티티가 없습니다</p>
      </div>
    );
  }

  // 노드 생성 - 인물/장소는 특별하게, 나머지는 작게
  const initialNodes = useMemo(() => {
    const chars = displayEntities.filter(e => e.category === 'character');
    const locations = displayEntities.filter(e => e.category === 'location');
    const others = displayEntities.filter(e => e.category !== 'character' && e.category !== 'location');

    const centerX = 400;
    const centerY = 350;

    // 인물 중심 모드: 선택한 인물이 중앙에 위치
    const isFocusedMode = viewMode === 'focused' && focusedCharId;
    const focusedEntity = isFocusedMode ? displayEntities.find(e => e.id === focusedCharId) : null;

    // 원 크기 계산: 노드 수의 2배로 (10개면 20개 기준)
    const getRadius = (count: number, nodeSize: number, minCount: number) => {
      const effectiveCount = Math.max(count, minCount) * 2;
      const spacing = nodeSize + 20; // 노드 크기 + 여백
      return Math.max(120, (effectiveCount * spacing) / (2 * Math.PI));
    };

    // 인물 중심 모드일 때도 동일한 구조: 중앙 → 인물 → 장소 → 기타
    if (isFocusedMode && focusedEntity) {
      const relatedChars = chars.filter(e => e.id !== focusedCharId);

      // 각 레이어별 반지름 (노드 수의 2.5배 기준)
      const charRadius = getRadius(relatedChars.length, 64, 4);
      const locationRadius = charRadius + 90;
      const otherRadius = locationRadius + 80;

      const allPositions: { id: string; x: number; y: number; size: number; layer: number }[] = [];

      // 인물 레이어
      relatedChars.forEach((entity, i) => {
        const angle = (2 * Math.PI * i) / Math.max(relatedChars.length, 1) - Math.PI / 2;
        allPositions.push({
          id: entity.id,
          x: centerX + charRadius * Math.cos(angle),
          y: centerY + charRadius * Math.sin(angle),
          size: 64,
          layer: 1,
        });
      });

      // 장소 레이어
      locations.forEach((entity, i) => {
        const angle = (2 * Math.PI * i) / Math.max(locations.length, 1) + Math.PI / 6;
        allPositions.push({
          id: entity.id,
          x: centerX + locationRadius * Math.cos(angle),
          y: centerY + locationRadius * Math.sin(angle),
          size: 72,
          layer: 2,
        });
      });

      // 기타 레이어
      others.forEach((entity, i) => {
        const angle = (2 * Math.PI * i) / Math.max(others.length, 1) + Math.PI / 4;
        allPositions.push({
          id: entity.id,
          x: centerX + otherRadius * Math.cos(angle),
          y: centerY + otherRadius * Math.sin(angle),
          size: 28,
          layer: 3,
        });
      });

      // 중앙 노드 (포커스된 인물)
      const focusedNode: Node = {
        id: focusedEntity.id,
        type: 'default',
        position: { x: centerX, y: centerY },
        data: { label: focusedEntity.name, entity: focusedEntity },
        style: {
          background: CATEGORY_COLORS[focusedEntity.category],
          color: 'white',
          border: '4px solid #fbbf24',
          borderRadius: '50%',
          width: 80,
          height: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          fontWeight: 600,
          boxShadow: '0 0 30px rgba(251, 191, 36, 0.6)',
        },
      };

      // 노드 생성
      const nodes: Node[] = [focusedNode];

      relatedChars.forEach((entity) => {
        const pos = allPositions.find(p => p.id === entity.id)!;
        const isPast = entity.isPastScene;
        nodes.push({
          id: entity.id,
          type: 'default',
          position: { x: pos.x, y: pos.y },
          data: { label: entity.name, entity },
          style: {
            background: CATEGORY_COLORS[entity.category],
            color: 'white',
            border: selectedEntityId === entity.id ? '3px solid #1e40af' : 'none',
            borderRadius: '50%',
            width: 64,
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 500,
            opacity: isPast ? 0.35 : 1,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          },
        });
      });

      locations.forEach((entity) => {
        const pos = allPositions.find(p => p.id === entity.id)!;
        const isPast = entity.isPastScene;
        nodes.push({
          id: entity.id,
          type: 'default',
          position: { x: pos.x, y: pos.y },
          data: { label: entity.name, entity },
          style: {
            background: CATEGORY_COLORS[entity.category],
            color: 'white',
            borderRadius: '8px',
            width: 72,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            fontWeight: 500,
            opacity: isPast ? 0.35 : 1,
            boxShadow: '0 3px 8px rgba(0,0,0,0.12)',
          },
        });
      });

      others.forEach((entity) => {
        const pos = allPositions.find(p => p.id === entity.id)!;
        const isPast = entity.isPastScene;
        nodes.push({
          id: entity.id,
          type: 'smallDot',
          position: { x: pos.x, y: pos.y },
          data: { label: entity.name, entity, isPast },
        });
      });

      return nodes;
    }

    // 일반 모드 - 원형 배치 (노드 수의 2.5배 기준)
    const charRadius = getRadius(chars.length, 64, 4);
    const locationRadius = charRadius + 90;
    const otherRadius = locationRadius + 80;

    // 초기 위치 설정
    const allPositions: { id: string; x: number; y: number; size: number; layer: number }[] = [];

    chars.forEach((entity, i) => {
      const angle = (2 * Math.PI * i) / chars.length - Math.PI / 2;
      allPositions.push({
        id: entity.id,
        x: centerX + charRadius * Math.cos(angle),
        y: centerY + charRadius * Math.sin(angle),
        size: 64,
        layer: 1,
      });
    });

    locations.forEach((entity, i) => {
      const angle = (2 * Math.PI * i) / locations.length + Math.PI / 6;
      allPositions.push({
        id: entity.id,
        x: centerX + locationRadius * Math.cos(angle),
        y: centerY + locationRadius * Math.sin(angle),
        size: 72,
        layer: 2,
      });
    });

    others.forEach((entity, i) => {
      const angle = (2 * Math.PI * i) / Math.max(others.length, 1) + Math.PI / 4;
      allPositions.push({
        id: entity.id,
        x: centerX + otherRadius * Math.cos(angle),
        y: centerY + otherRadius * Math.sin(angle),
        size: 28,
        layer: 3,
      });
    });

    // 캐릭터 노드
    const charNodes: Node[] = chars.map((entity) => {
      const pos = allPositions.find(p => p.id === entity.id)!;
      const isPast = entity.isPastScene;
      return {
        id: entity.id,
        type: 'default',
        position: { x: pos.x, y: pos.y },
        data: { label: entity.name, entity },
        style: {
          background: CATEGORY_COLORS[entity.category],
          color: 'white',
          border: selectedEntityId === entity.id ? '3px solid #1e40af' : 'none',
          borderRadius: '50%',
          width: 64,
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 500,
          opacity: isPast ? 0.35 : 1,
          boxShadow: selectedEntityId === entity.id
            ? '0 0 20px rgba(59, 130, 246, 0.5)'
            : '0 4px 12px rgba(0,0,0,0.15)',
        },
      };
    });

    // 장소 노드
    const locationNodes: Node[] = locations.map((entity) => {
      const pos = allPositions.find(p => p.id === entity.id)!;
      const isPast = entity.isPastScene;
      return {
        id: entity.id,
        type: 'default',
        position: { x: pos.x, y: pos.y },
        data: { label: entity.name, entity },
        style: {
          background: CATEGORY_COLORS[entity.category],
          color: 'white',
          border: selectedEntityId === entity.id ? '2px solid #166534' : 'none',
          borderRadius: '8px',
          width: 72,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: 500,
          opacity: isPast ? 0.35 : 1,
          boxShadow: selectedEntityId === entity.id
            ? '0 0 15px rgba(34, 197, 94, 0.4)'
            : '0 3px 8px rgba(0,0,0,0.12)',
        },
      };
    });

    // 기타 노드
    const otherNodes: Node[] = others.map((entity) => {
      const pos = allPositions.find(p => p.id === entity.id)!;
      const isPast = entity.isPastScene;
      return {
        id: entity.id,
        type: 'smallDot',
        position: { x: pos.x, y: pos.y },
        data: { label: entity.name, entity, isPast },
      };
    });

    return [...charNodes, ...locationNodes, ...otherNodes];
  }, [displayEntities, selectedEntityId, viewMode, focusedCharId]);

  // 엣지 ID -> 원본 HyperEdge 매핑
  const edgeMap = useMemo(() => {
    const map: Record<string, HyperEdge> = {};
    displayEdges.forEach(edge => {
      map[edge.id] = edge;
    });
    return map;
  }, [displayEdges]);

  // 엣지 생성 - hover 효과 제거로 성능 개선
  const initialEdges = useMemo(() => {
    const result: Edge[] = [];

    displayEdges.forEach((edge) => {
      const color = RELATION_COLORS[edge.type] || '#9ca3af';
      const dashArray = SENTIMENT_STYLES[edge.sentiment || 'neutral'].strokeDasharray;
      const relationLabel = RELATION_LABELS[edge.type] || edge.type;
      const isPast = (edge as EdgeWithOpacity).isPastScene;

      for (let i = 0; i < edge.entities.length; i++) {
        for (let j = i + 1; j < edge.entities.length; j++) {
          result.push({
            id: `${edge.id}-${i}-${j}`,
            source: edge.entities[i],
            target: edge.entities[j],
            type: 'default',
            animated: false, // 애니메이션 비활성화로 성능 개선
            style: {
              stroke: color,
              strokeWidth: Math.min((edge.strength || 5) / 3, 3),
              strokeDasharray: dashArray,
              cursor: 'pointer',
              opacity: isPast ? 0.25 : 0.7,
            },
            label: i === 0 && j === 1 ? relationLabel : undefined,
            labelStyle: {
              fontSize: 9,
              fill: '#666',
              fontWeight: 400,
              opacity: isPast ? 0.25 : 1,
            },
            labelBgStyle: {
              fill: 'white',
              fillOpacity: isPast ? 0.5 : 0.9,
            },
            data: {
              originalEdge: edge,
            },
          });
        }
      }
    });

    return result;
  }, [displayEdges, viewMode]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 노드 업데이트 (위치 변경 없이 스타일만)
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const handleNodeClick = useCallback((_: any, node: Node) => {
    const entity = node.data.entity as Entity;
    selectEntity(entity.id);
    onNodeClick?.(entity);
  }, [selectEntity, onNodeClick]);

  const handleEdgeClick = useCallback((_: any, edge: Edge) => {
    const originalEdgeId = edge.id.split('-')[0] + '-' + edge.id.split('-')[1];
    const originalEdge = edgeMap[originalEdgeId] || (edge.data?.originalEdge as HyperEdge);
    if (originalEdge) {
      if (selectedEdge?.id === originalEdge.id) {
        setSelectedEdge(null);
      } else {
        setSelectedEdge(originalEdge);
      }
    }
  }, [edgeMap, selectedEdge]);

  const handlePaneClick = useCallback(() => {
    setSelectedEdge(null);
  }, []);

  const getCharColor = (index: number) => {
    const colors = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#14b8a6', '#6366f1', '#f43f5e'];
    return colors[index % colors.length];
  };

  return (
    <div className="w-full h-full bg-gray-50 rounded-xl overflow-hidden relative">
      {/* 뷰 모드 컨트롤 */}
      <div className="absolute top-3 left-3 z-10 bg-white rounded-lg shadow-lg p-2">
        <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => { setViewMode('full'); setFocusedCharId(null); }}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
              viewMode === 'full'
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title="전체 보기"
          >
            <Eye className="w-3 h-3" />
            전체
          </button>
          <button
            onClick={() => { setViewMode('simple'); setFocusedCharId(null); }}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
              viewMode === 'simple'
                ? 'bg-green-100 text-green-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title="간소화 (인물만)"
          >
            <EyeOff className="w-3 h-3" />
            간소화
          </button>
          <button
            onClick={() => setViewMode('focused')}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
              viewMode === 'focused'
                ? 'bg-purple-100 text-purple-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title="인물 중심"
          >
            <Focus className="w-3 h-3" />
            인물 중심
          </button>
        </div>

        {/* 인물 중심 모드: 인물 선택 */}
        {viewMode === 'focused' && (
          <div className="border-t border-gray-100 pt-2">
            <div className="text-[10px] text-gray-400 mb-1">관점 인물 선택:</div>
            <div className="flex flex-wrap gap-1 max-w-[200px]">
              {characters.map((char, i) => (
                <button
                  key={char.id}
                  onClick={() => setFocusedCharId(focusedCharId === char.id ? null : char.id)}
                  className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${
                    focusedCharId === char.id
                      ? 'text-white shadow'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  style={focusedCharId === char.id ? { backgroundColor: getCharColor(i) } : undefined}
                >
                  {char.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 중요도 필터 */}
        {viewMode === 'full' && (
          <div className="border-t border-gray-100 pt-2 mt-2">
            <div className="flex items-center gap-2">
              <Filter className="w-3 h-3 text-gray-400" />
              <span className="text-[10px] text-gray-400">중요도</span>
              <input
                type="range"
                min="1"
                max="10"
                value={minImportance}
                onChange={(e) => setMinImportance(Number(e.target.value))}
                className="w-16 h-1 accent-blue-500"
              />
              <span className="text-[10px] text-gray-600 font-medium w-4">{minImportance}</span>
            </div>
            {minImportance > 1 && (
              <div className="text-[9px] text-gray-400 mt-1">
                {displayEntities.length}/{entities.length} 표시
              </div>
            )}
          </div>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        connectionMode={ConnectionMode.Loose}
        defaultViewport={{ x: 0, y: 0, zoom: 1.2 }}
        minZoom={0.3}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', -apple-system, sans-serif" }}
      >
        <Background color="#e5e7eb" gap={20} />
        <Controls className="bg-white rounded-lg shadow-lg" />
        {displayEntities.length <= 100 && (
          <MiniMap
            nodeColor={(node) => {
              const entity = node.data?.entity as Entity;
              return entity ? CATEGORY_COLORS[entity.category] : '#ccc';
            }}
            className="bg-white rounded-lg shadow-lg"
          />
        )}
      </ReactFlow>

      {selectedEdge && (
        <EdgeDetailPopup
          edge={selectedEdge}
          entities={entities}
          onClose={() => setSelectedEdge(null)}
        />
      )}
    </div>
  );
}

// 범례 컴포넌트
export function GraphLegend() {
  const categories: [EntityCategory, string][] = [
    ['character', '인물'],
    ['location', '장소'],
    ['organization', '조직'],
    ['item', '아이템'],
    ['event', '사건'],
    ['time_period', '시간'],
  ];

  return (
    <div className="flex flex-wrap gap-3 p-3 bg-white rounded-lg shadow-sm">
      {categories.map(([cat, label]) => (
        <div key={cat} className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-full"
            style={{ background: CATEGORY_COLORS[cat] }}
          />
          <span className="text-xs text-gray-600">{label}</span>
        </div>
      ))}
    </div>
  );
}
