/**
 * 채팅에서 언급된 엔티티 패널
 * 간결한 미니 관계도 + 엔티티 목록
 */

import { useMemo, useState, useCallback } from 'react';
import { User, MapPin, Building, Sword, Clock, Zap, Info, Heart, MessageCircle, X } from 'lucide-react';
import {
  ReactFlow,
  Background,
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

  // 미니 그래프용 노드/엣지 생성 - 가로로 넓게
  const { initialNodes, initialEdges } = useMemo(() => {
    if (mentionedEntities.length === 0) {
      return { initialNodes: [], initialEdges: [] };
    }

    // 배치 영역
    const width = 480;
    const height = 200;
    const centerX = width / 2;
    const centerY = height / 2;

    // 노드 수에 따라 배치 방식 결정
    const count = mentionedEntities.length;

    const initialNodes: Node[] = mentionedEntities.map((entity, index) => {
      let x: number, y: number;

      if (count === 1) {
        x = centerX;
        y = centerY;
      } else if (count === 2) {
        x = index === 0 ? centerX - 120 : centerX + 120;
        y = centerY;
      } else if (count <= 4) {
        // 가로 일렬
        const spacing = width / (count + 1);
        x = spacing * (index + 1);
        y = centerY;
      } else {
        // 타원형 배치
        const angle = (2 * Math.PI * index) / count - Math.PI / 2;
        const radiusX = 180;
        const radiusY = 70;
        x = centerX + radiusX * Math.cos(angle);
        y = centerY + radiusY * Math.sin(angle);
      }

      const color = CATEGORY_COLORS[entity.category] || '#6b7280';

      return {
        id: entity.id,
        position: { x: x - 20, y: y - 20 },
        data: { label: entity.name.slice(0, 4), entity },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: color,
          color: '#fff',
          border: `2px solid ${color}`,
          borderRadius: '50%',
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: 600,
          padding: '2px',
          cursor: 'pointer',
        },
      };
    });

    const initialEdges: Edge[] = relevantEdges.slice(0, 20).map((edge, index) => {
      const [source, target] = edge.entities;
      return {
        id: `edge-${index}`,
        source,
        target,
        style: {
          stroke: edge.sentiment === 'positive' ? '#22c55e' :
                  edge.sentiment === 'negative' ? '#ef4444' : '#94a3b8',
          strokeWidth: 1.5,
        },
        data: { edge },
      };
    });

    return { initialNodes, initialEdges };
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
    setTooltip({
      type: 'node',
      x: event.clientX,
      y: event.clientY,
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
      <div className="h-full flex items-center justify-center bg-white text-gray-400 p-4">
        <div className="text-center">
          <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">채팅에서 질문하면</p>
          <p className="text-xs">답변에 등장한 항목이 표시됩니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* 헤더 */}
      <div className="px-3 py-2 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-gray-700">언급된 항목</span>
          </div>
          <span className="text-xs text-gray-400">
            {mentionedEntities.length}개 · {relevantEdges.length}관계
          </span>
        </div>
      </div>

      {/* 미니 관계도 - 적당한 높이 */}
      {mentionedEntities.length >= 2 && (
        <div className="flex-shrink-0 h-[220px] border-b border-gray-100 bg-gray-50/50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            nodesDraggable={true}
            nodesConnectable={false}
            panOnDrag={true}
            zoomOnScroll={false}
            zoomOnPinch={false}
            minZoom={0.8}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#e5e7eb" gap={24} size={1} />
          </ReactFlow>
        </div>
      )}

      {/* 엔티티 목록 */}
      <div className="flex-1 overflow-y-auto">
        {mentionedEntities.map(entity => {
          const color = CATEGORY_COLORS[entity.category] || '#6b7280';
          const Icon = CATEGORY_ICONS[entity.category] || Info;
          return (
            <button
              key={entity.id}
              onClick={() => selectEntity(entity.id)}
              className="w-full px-3 py-2 hover:bg-blue-50 border-b border-gray-100 text-left flex items-center gap-2 transition-colors"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white flex-shrink-0"
                style={{ backgroundColor: color }}
              >
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-800 text-sm truncate">{entity.name}</div>
                <div className="text-xs text-gray-400 truncate">
                  {CATEGORY_LABELS[entity.category]}
                  {entity.description && ` · ${entity.description.slice(0, 30)}...`}
                </div>
              </div>
            </button>
          );
        })}

        {/* 관계 목록 */}
        {relevantEdges.length > 0 && (
          <div className="border-t border-gray-200">
            <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-500">
              관계 ({relevantEdges.length})
            </div>
            {relevantEdges.slice(0, 10).map((edge, idx) => {
              const entityNames = edge.entities
                .map(id => knowledgeGraph?.entities[id]?.name || id)
                .join(' ↔ ');
              return (
                <div
                  key={idx}
                  className="px-3 py-2 border-b border-gray-100 text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      edge.sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                      edge.sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {edge.type}
                    </span>
                    <span className="text-gray-600 truncate">{entityNames}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 툴팁 */}
      {tooltip && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-2.5 max-w-[260px] text-sm"
          style={{
            left: Math.min(tooltip.x - 130, window.innerWidth - 280),
            top: tooltip.y + 10,
          }}
        >
          <button
            onClick={() => setTooltip(null)}
            className="absolute top-1.5 right-1.5 text-gray-400 hover:text-gray-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {tooltip.type === 'node' ? (
            <div>
              <div className="font-medium text-gray-800 pr-4">{(tooltip.data as Entity).name}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {CATEGORY_LABELS[(tooltip.data as Entity).category]}
              </div>
              {(tooltip.data as Entity).description && (
                <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">
                  {(tooltip.data as Entity).description}
                </p>
              )}
              <button
                onClick={() => {
                  selectEntity((tooltip.data as Entity).id);
                  setTooltip(null);
                }}
                className="w-full mt-2 px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded transition-colors"
              >
                상세 보기
              </button>
            </div>
          ) : (
            <div>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                (tooltip.data as HyperEdge).sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                (tooltip.data as HyperEdge).sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {(tooltip.data as HyperEdge).type}
              </span>
              <div className="text-xs text-gray-700 mt-1.5">
                {(tooltip.data as HyperEdge).entities
                  .map(id => knowledgeGraph?.entities[id]?.name || id)
                  .join(' ↔ ')}
              </div>
              {(tooltip.data as HyperEdge).statement && (
                <p className="text-xs text-gray-500 mt-1 line-clamp-3">
                  {(tooltip.data as HyperEdge).statement}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
