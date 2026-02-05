/**
 * 채팅에서 언급된 엔티티 패널
 * 채팅 답변에서 언급된 인물/엔티티 목록 + 인터랙티브 관계도
 */

import { useMemo, useState, useCallback } from 'react';
import { User, MapPin, Building, Sword, Clock, Zap, Info, Heart, MessageCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import {
  ReactFlow,
  Background,
  Controls,
  Node,
  Edge,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../store';
import type { EntityCategory, Entity, HyperEdge } from '../types';

// 카테고리 아이콘
const CATEGORY_ICONS: Record<EntityCategory, React.ComponentType<{ className?: string }>> = {
  character: User,
  location: MapPin,
  organization: Building,
  item: Sword,
  creature: Zap,
  event: Clock,
  concept: Info,
  time_period: Clock,
  status: Info,
  emotion: Heart,
};

const CATEGORY_LABELS: Record<EntityCategory, string> = {
  character: '인물',
  location: '장소',
  organization: '조직',
  item: '아이템',
  creature: '생물',
  event: '사건',
  concept: '개념',
  time_period: '시간',
  status: '상태',
  emotion: '감정',
};

const CATEGORY_COLORS: Record<EntityCategory, { bg: string; border: string; text: string }> = {
  character: { bg: '#3b82f6', border: '#2563eb', text: '#ffffff' },
  location: { bg: '#22c55e', border: '#16a34a', text: '#ffffff' },
  organization: { bg: '#a855f7', border: '#9333ea', text: '#ffffff' },
  item: { bg: '#f59e0b', border: '#d97706', text: '#ffffff' },
  creature: { bg: '#ef4444', border: '#dc2626', text: '#ffffff' },
  event: { bg: '#ec4899', border: '#db2777', text: '#ffffff' },
  concept: { bg: '#6366f1', border: '#4f46e5', text: '#ffffff' },
  time_period: { bg: '#14b8a6', border: '#0d9488', text: '#ffffff' },
  status: { bg: '#64748b', border: '#475569', text: '#ffffff' },
  emotion: { bg: '#f43f5e', border: '#e11d48', text: '#ffffff' },
};

// 툴팁 정보 타입
interface TooltipInfo {
  type: 'node' | 'edge';
  x: number;
  y: number;
  data: Entity | HyperEdge;
}

export function ChatMentionedPanel() {
  const { knowledgeGraph, chatMentionedEntities, selectEntity } = useStore();
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [showEntityList, setShowEntityList] = useState(true);

  // 언급된 엔티티 목록 가져오기
  const mentionedEntities: Entity[] = useMemo(() => {
    return chatMentionedEntities
      .map(id => knowledgeGraph?.entities[id])
      .filter((e): e is Entity => !!e);
  }, [knowledgeGraph, chatMentionedEntities]);

  // 언급된 엔티티들 간의 관계만 필터링
  const relevantEdges: HyperEdge[] = useMemo(() => {
    if (!knowledgeGraph) return [];
    const mentionedIds = new Set(chatMentionedEntities);
    return Object.values(knowledgeGraph.hyperedges).filter(edge =>
      edge.entities.every(id => mentionedIds.has(id))
    );
  }, [knowledgeGraph, chatMentionedEntities]);

  // 미니 그래프용 노드/엣지 생성
  const { initialNodes, initialEdges, edgeDataMap } = useMemo(() => {
    if (mentionedEntities.length === 0) {
      return { initialNodes: [], initialEdges: [], edgeDataMap: new Map<string, HyperEdge>() };
    }

    // 원형 배치 - 더 넓게
    const centerX = 200;
    const centerY = 150;
    const radius = Math.min(120, 50 + mentionedEntities.length * 20);

    const initialNodes: Node[] = mentionedEntities.map((entity, index) => {
      const angle = (2 * Math.PI * index) / mentionedEntities.length - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      const colors = CATEGORY_COLORS[entity.category] || CATEGORY_COLORS.concept;

      return {
        id: entity.id,
        position: { x, y },
        data: {
          label: entity.name,
          entity,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: colors.bg,
          color: colors.text,
          border: `3px solid ${colors.border}`,
          borderRadius: '50%',
          width: 70,
          height: 70,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 'bold',
          textAlign: 'center' as const,
          padding: '6px',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        },
      };
    });

    const edgeDataMap = new Map<string, HyperEdge>();
    const initialEdges: Edge[] = relevantEdges.map((edge, index) => {
      const [source, target] = edge.entities;
      const edgeId = `edge-${index}`;
      edgeDataMap.set(edgeId, edge);

      return {
        id: edgeId,
        source,
        target,
        label: edge.type,
        labelStyle: {
          fontSize: '11px',
          fill: '#374151',
          fontWeight: 500,
        },
        labelBgStyle: {
          fill: '#ffffff',
          fillOpacity: 0.9,
        },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          stroke: edge.sentiment === 'positive' ? '#22c55e' :
                  edge.sentiment === 'negative' ? '#ef4444' : '#6b7280',
          strokeWidth: 3,
          cursor: 'pointer',
        },
        animated: edge.sentiment === 'positive',
        data: { edge },
      };
    });

    return { initialNodes, initialEdges, edgeDataMap };
  }, [mentionedEntities, relevantEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 노드/엣지 변경 시 업데이트
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // 노드 클릭 핸들러
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    const entity = node.data.entity as Entity;
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setTooltip({
      type: 'node',
      x: rect.left + rect.width / 2,
      y: rect.top,
      data: entity,
    });
  }, []);

  // 엣지 클릭 핸들러
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    const edgeData = edge.data?.edge as HyperEdge;
    if (edgeData) {
      setTooltip({
        type: 'edge',
        x: event.clientX,
        y: event.clientY,
        data: edgeData,
      });
    }
  }, []);

  // 배경 클릭 시 툴팁 닫기
  const onPaneClick = useCallback(() => {
    setTooltip(null);
  }, []);

  if (mentionedEntities.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-white text-gray-400 p-6">
        <div className="text-center">
          <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-base font-medium mb-1">채팅에서 질문하면</p>
          <p className="text-sm">답변에 등장한 인물/엔티티가</p>
          <p className="text-sm">여기에 표시됩니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* 헤더 */}
      <div className="p-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-500" />
          <h2 className="text-base font-semibold text-gray-800">
            답변에서 언급된 항목
          </h2>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {mentionedEntities.length}개 엔티티 · {relevantEdges.length}개 관계
        </p>
      </div>

      {/* 인터랙티브 관계도 */}
      <div className="flex-1 min-h-[300px] border-b border-gray-200 bg-gray-50">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
          panOnDrag={true}
          zoomOnScroll={true}
          zoomOnPinch={true}
          minZoom={0.5}
          maxZoom={2}
        >
          <Background color="#d1d5db" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* 엔티티 목록 (접기/펼치기) */}
      <div className="flex-shrink-0">
        <button
          onClick={() => setShowEntityList(!showEntityList)}
          className="w-full px-3 py-2 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 flex items-center justify-between text-sm font-medium text-gray-700"
        >
          <span>엔티티 목록</span>
          {showEntityList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showEntityList && (
          <div className="max-h-[200px] overflow-y-auto p-3 space-y-2">
            {mentionedEntities.map(entity => {
              const colors = CATEGORY_COLORS[entity.category] || CATEGORY_COLORS.concept;
              const Icon = CATEGORY_ICONS[entity.category] || Info;
              return (
                <button
                  key={entity.id}
                  onClick={() => selectEntity(entity.id)}
                  className="w-full p-2 bg-white hover:bg-blue-50 rounded-lg border border-gray-200 hover:border-blue-300 transition-all text-left flex items-center gap-2"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white flex-shrink-0"
                    style={{ backgroundColor: colors.bg }}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 text-sm truncate">{entity.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {CATEGORY_LABELS[entity.category]} · 클릭하여 상세보기
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 툴팁 */}
      {tooltip && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 p-3 max-w-[300px]"
          style={{
            left: Math.min(tooltip.x, window.innerWidth - 320),
            top: tooltip.y + 10,
          }}
        >
          <button
            onClick={() => setTooltip(null)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>

          {tooltip.type === 'node' ? (
            // 엔티티 툴팁
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                  style={{ backgroundColor: CATEGORY_COLORS[(tooltip.data as Entity).category]?.bg || '#6b7280' }}
                >
                  {(() => {
                    const Icon = CATEGORY_ICONS[(tooltip.data as Entity).category] || Info;
                    return <Icon className="w-4 h-4" />;
                  })()}
                </div>
                <div>
                  <div className="font-semibold text-gray-800">{(tooltip.data as Entity).name}</div>
                  <div className="text-xs text-gray-500">
                    {CATEGORY_LABELS[(tooltip.data as Entity).category]}
                  </div>
                </div>
              </div>
              {(tooltip.data as Entity).description && (
                <p className="text-sm text-gray-600 mb-2">{(tooltip.data as Entity).description}</p>
              )}
              <button
                onClick={() => {
                  selectEntity((tooltip.data as Entity).id);
                  setTooltip(null);
                }}
                className="w-full mt-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors"
              >
                상세 보기
              </button>
            </div>
          ) : (
            // 관계 툴팁
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  (tooltip.data as HyperEdge).sentiment === 'positive' ? 'bg-green-100 text-green-800' :
                  (tooltip.data as HyperEdge).sentiment === 'negative' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {(tooltip.data as HyperEdge).type}
                </span>
              </div>
              <div className="text-sm font-medium text-gray-800 mb-1">
                {(tooltip.data as HyperEdge).entities
                  .map(id => knowledgeGraph?.entities[id]?.name || id)
                  .join(' ↔ ')}
              </div>
              {(tooltip.data as HyperEdge).statement && (
                <p className="text-sm text-gray-600">{(tooltip.data as HyperEdge).statement}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
