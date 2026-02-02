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
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../store';
import type { Entity, HyperEdge, EntityCategory } from '../types';
import { X, Eye, EyeOff, Focus } from 'lucide-react';

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

interface Props {
  entities: Entity[];
  edges: HyperEdge[];
  onNodeClick?: (entity: Entity) => void;
}

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
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<GraphViewMode>('full');
  const [focusedCharId, setFocusedCharId] = useState<string | null>(null);

  // 인물 목록 추출
  const characters = useMemo(() =>
    entities.filter(e => e.category === 'character'),
    [entities]
  );

  // 인물 중심 모드: 필터링된 엔티티와 엣지
  const { filteredEntities, filteredEdges } = useMemo(() => {
    if (viewMode !== 'focused' || !focusedCharId) {
      return { filteredEntities: entities, filteredEdges: edges };
    }

    // 포커스된 인물과 관련된 엔티티 찾기
    const relatedEntityIds = new Set<string>([focusedCharId]);
    edges.forEach(edge => {
      if (edge.entities.includes(focusedCharId)) {
        edge.entities.forEach(id => relatedEntityIds.add(id));
      }
    });

    const fEntities = entities.filter(e => relatedEntityIds.has(e.id));
    const fEdges = edges.filter(e => e.entities.includes(focusedCharId));

    return { filteredEntities: fEntities, filteredEdges: fEdges };
  }, [entities, edges, viewMode, focusedCharId]);

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

  // 연결된 엔티티 ID 집합 계산 (useMemo로 캐싱)
  const connectedEntityIds = useMemo(() => {
    const connected = new Set<string>();
    displayEdges.forEach(edge => {
      edge.entities.forEach(id => connected.add(id));
    });
    return connected;
  }, [displayEdges]);

  // 노드 생성 - selectedEntityId만 의존, hoveredNodeId 제거
  const initialNodes = useMemo(() => {
    const chars = displayEntities.filter(e => e.category === 'character');
    const others = displayEntities.filter(e => e.category !== 'character');

    // 연결된 것과 연결 안된 것 분리
    const connectedOthers = others.filter(e => connectedEntityIds.has(e.id));
    const disconnectedOthers = others.filter(e => !connectedEntityIds.has(e.id));

    const centerX = 400;
    const centerY = 300;

    // 캐릭터를 원형으로 배치 (내부 원)
    const charNodes: Node[] = chars.map((entity, i) => {
      const angle = (2 * Math.PI * i) / chars.length - Math.PI / 2;
      const radius = 200;
      return {
        id: entity.id,
        type: 'default',
        position: {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        },
        data: {
          label: entity.name,
          entity,
        },
        style: {
          background: CATEGORY_COLORS[entity.category],
          color: 'white',
          border: selectedEntityId === entity.id ? '3px solid #1e40af' : 'none',
          borderRadius: '50%',
          width: 80,
          height: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 600,
          boxShadow: selectedEntityId === entity.id
            ? '0 0 20px rgba(59, 130, 246, 0.5)'
            : '0 2px 8px rgba(0,0,0,0.1)',
        },
      };
    });

    // 연결된 기타 엔티티는 중간 원에 배치
    const connectedOtherNodes: Node[] = connectedOthers.map((entity, i) => {
      const angle = (2 * Math.PI * i) / connectedOthers.length;
      const radius = 380;
      return {
        id: entity.id,
        type: 'default',
        position: {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        },
        data: {
          label: entity.name,
          entity,
        },
        style: {
          background: CATEGORY_COLORS[entity.category],
          color: 'white',
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '11px',
          fontWeight: 500,
          border: selectedEntityId === entity.id ? '2px solid #1e40af' : 'none',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        },
      };
    });

    // 연결 없는 엔티티는 외곽 원에 배치 (더 작고 흐리게)
    const disconnectedOtherNodes: Node[] = disconnectedOthers.map((entity, i) => {
      const angle = (2 * Math.PI * i) / disconnectedOthers.length + Math.PI / 4;
      const radius = 520;
      return {
        id: entity.id,
        type: 'default',
        position: {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        },
        data: {
          label: entity.name,
          entity,
        },
        style: {
          background: CATEGORY_COLORS[entity.category],
          color: 'white',
          borderRadius: '6px',
          padding: '6px 10px',
          fontSize: '10px',
          fontWeight: 500,
          opacity: 0.6,
          border: selectedEntityId === entity.id ? '2px solid #1e40af' : 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        },
      };
    });

    return [...charNodes, ...connectedOtherNodes, ...disconnectedOtherNodes];
  }, [displayEntities, selectedEntityId, connectedEntityIds]);

  // 엣지 ID -> 원본 HyperEdge 매핑
  const edgeMap = useMemo(() => {
    const map: Record<string, HyperEdge> = {};
    displayEdges.forEach(edge => {
      map[edge.id] = edge;
    });
    return map;
  }, [displayEdges]);

  // 엣지 생성 - hoveredEdgeId 의존하지만 노드 위치에는 영향 없음
  const initialEdges = useMemo(() => {
    const result: Edge[] = [];

    displayEdges.forEach((edge) => {
      const color = RELATION_COLORS[edge.type] || '#9ca3af';
      const dashArray = SENTIMENT_STYLES[edge.sentiment || 'neutral'].strokeDasharray;
      const isHovered = hoveredEdgeId?.startsWith(edge.id);
      const relationLabel = RELATION_LABELS[edge.type] || edge.type;

      for (let i = 0; i < edge.entities.length; i++) {
        for (let j = i + 1; j < edge.entities.length; j++) {
          result.push({
            id: `${edge.id}-${i}-${j}`,
            source: edge.entities[i],
            target: edge.entities[j],
            type: 'default',
            animated: edge.sentiment === 'positive',
            style: {
              stroke: isHovered ? '#3b82f6' : color,
              strokeWidth: isHovered ? 4 : Math.min((edge.strength || 5) / 3, 4),
              strokeDasharray: dashArray,
              cursor: 'pointer',
            },
            label: i === 0 && j === 1 ? relationLabel : undefined,
            labelStyle: {
              fontSize: isHovered ? 12 : 10,
              fill: isHovered ? '#1d4ed8' : '#666',
              fontWeight: isHovered ? 600 : 400,
            },
            labelBgStyle: {
              fill: 'white',
              fillOpacity: 0.9,
            },
            data: {
              originalEdge: edge,
            },
          });
        }
      }
    });

    return result;
  }, [displayEdges, hoveredEdgeId, viewMode]);

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

  const handleEdgeMouseEnter = useCallback((_: any, edge: Edge) => {
    setHoveredEdgeId(edge.id);
  }, []);

  const handleEdgeMouseLeave = useCallback(() => {
    setHoveredEdgeId(null);
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
      </div>

      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        onPaneClick={handlePaneClick}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background color="#e5e7eb" gap={20} />
        <Controls className="bg-white rounded-lg shadow-lg" />
        <MiniMap
          nodeColor={(node) => {
            const entity = node.data?.entity as Entity;
            return entity ? CATEGORY_COLORS[entity.category] : '#ccc';
          }}
          className="bg-white rounded-lg shadow-lg"
        />
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
