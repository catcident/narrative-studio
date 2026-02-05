/**
 * 채팅에서 언급된 엔티티 패널
 * 채팅 답변에서 언급된 인물/엔티티 목록 + 미니 관계도
 */

import { useMemo } from 'react';
import { User, MapPin, Building, Sword, Clock, Zap, Info, Heart, MessageCircle } from 'lucide-react';
import {
  ReactFlow,
  Background,
  Node,
  Edge,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../store';
import type { EntityCategory, Entity, HyperEdge } from '../types';

// 카테고리 아이콘
const CATEGORY_ICONS: Record<EntityCategory, any> = {
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

const CATEGORY_BG_CLASSES: Record<EntityCategory, string> = {
  character: 'bg-blue-500',
  location: 'bg-green-500',
  organization: 'bg-purple-500',
  item: 'bg-amber-500',
  creature: 'bg-red-500',
  event: 'bg-pink-500',
  concept: 'bg-indigo-500',
  time_period: 'bg-teal-500',
  status: 'bg-slate-500',
  emotion: 'bg-rose-500',
};

export function ChatMentionedPanel() {
  const { knowledgeGraph, chatMentionedEntities, selectEntity } = useStore();

  // 언급된 엔티티 목록 가져오기
  const mentionedEntities: Entity[] = chatMentionedEntities
    .map(id => knowledgeGraph?.entities[id])
    .filter((e): e is Entity => !!e);

  // 언급된 엔티티들 간의 관계만 필터링
  const relevantEdges: HyperEdge[] = useMemo(() => {
    if (!knowledgeGraph) return [];
    const mentionedIds = new Set(chatMentionedEntities);
    return Object.values(knowledgeGraph.hyperedges).filter(edge =>
      // 엣지의 모든 엔티티가 언급된 엔티티에 포함되어야 함
      edge.entities.every(id => mentionedIds.has(id))
    );
  }, [knowledgeGraph, chatMentionedEntities]);

  // 미니 그래프용 노드/엣지 생성
  const { nodes, edges } = useMemo(() => {
    if (mentionedEntities.length === 0) return { nodes: [], edges: [] };

    // 원형 배치
    const centerX = 150;
    const centerY = 120;
    const radius = Math.min(100, 40 + mentionedEntities.length * 15);

    const nodes: Node[] = mentionedEntities.map((entity, index) => {
      const angle = (2 * Math.PI * index) / mentionedEntities.length - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      const colors = CATEGORY_COLORS[entity.category] || CATEGORY_COLORS.concept;

      return {
        id: entity.id,
        position: { x, y },
        data: { label: entity.name },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: colors.bg,
          color: colors.text,
          border: `2px solid ${colors.border}`,
          borderRadius: '50%',
          width: 60,
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 'bold',
          textAlign: 'center' as const,
          padding: '4px',
          cursor: 'pointer',
        },
      };
    });

    const edges: Edge[] = relevantEdges.map((edge, index) => {
      const [source, target] = edge.entities;
      return {
        id: `edge-${index}`,
        source,
        target,
        label: edge.type,
        labelStyle: { fontSize: '9px', fill: '#666' },
        style: {
          stroke: edge.sentiment === 'positive' ? '#22c55e' :
                  edge.sentiment === 'negative' ? '#ef4444' : '#94a3b8',
          strokeWidth: 2,
        },
        animated: edge.sentiment === 'positive',
      };
    });

    return { nodes, edges };
  }, [mentionedEntities, relevantEdges]);

  // 카테고리별로 그룹화
  const groupedEntities = mentionedEntities.reduce((acc, entity) => {
    const category = entity.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(entity);
    return acc;
  }, {} as Record<EntityCategory, Entity[]>);

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
    <div className="h-full flex flex-col bg-white">
      {/* 헤더 */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-semibold text-gray-800">
            답변에서 언급된 항목
          </h2>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {mentionedEntities.length}개 엔티티 · {relevantEdges.length}개 관계
        </p>
      </div>

      {/* 미니 관계도 */}
      {mentionedEntities.length >= 2 && (
        <div className="flex-shrink-0 h-64 border-b border-gray-200 bg-gray-50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            onNodeClick={(_, node) => selectEntity(node.id)}
          >
            <Background color="#e5e7eb" gap={16} />
          </ReactFlow>
        </div>
      )}

      {/* 엔티티 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.entries(groupedEntities).map(([category, entities]) => {
          const Icon = CATEGORY_ICONS[category as EntityCategory] || Info;
          const label = CATEGORY_LABELS[category as EntityCategory] || category;
          const bgClass = CATEGORY_BG_CLASSES[category as EntityCategory] || 'bg-gray-500';

          return (
            <div key={category}>
              {/* 카테고리 헤더 */}
              <div className="flex items-center gap-2 mb-3">
                <div className={`p-1.5 rounded ${bgClass} text-white`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-sm font-semibold text-gray-700">
                  {label} ({entities.length})
                </span>
              </div>

              {/* 엔티티 목록 */}
              <div className="space-y-2">
                {entities.map(entity => (
                  <button
                    key={entity.id}
                    onClick={() => selectEntity(entity.id)}
                    className="w-full p-4 bg-gray-50 hover:bg-blue-50 rounded-xl border border-gray-200 hover:border-blue-300 transition-all text-left shadow-sm hover:shadow"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800 text-base">{entity.name}</span>
                      {entity.aliases && entity.aliases.length > 0 && (
                        <span className="text-sm text-gray-400">
                          ({entity.aliases[0]})
                        </span>
                      )}
                    </div>
                    {entity.description && (
                      <p className="text-sm text-gray-600 mt-2 line-clamp-2 leading-relaxed">
                        {entity.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* 관계 목록 */}
        {relevantEdges.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded bg-gray-600 text-white">
                <Info className="w-4 h-4" />
              </div>
              <span className="text-sm font-semibold text-gray-700">
                관계 ({relevantEdges.length})
              </span>
            </div>
            <div className="space-y-2">
              {relevantEdges.map((edge, idx) => {
                const entityNames = edge.entities
                  .map(id => knowledgeGraph?.entities[id]?.name || id)
                  .join(' ↔ ');
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border ${
                      edge.sentiment === 'positive' ? 'bg-green-50 border-green-200' :
                      edge.sentiment === 'negative' ? 'bg-red-50 border-red-200' :
                      'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        edge.sentiment === 'positive' ? 'bg-green-200 text-green-800' :
                        edge.sentiment === 'negative' ? 'bg-red-200 text-red-800' :
                        'bg-gray-200 text-gray-700'
                      }`}>
                        {edge.type}
                      </span>
                      <span className="text-gray-700 font-medium">{entityNames}</span>
                    </div>
                    {edge.statement && (
                      <p className="text-sm text-gray-600 mt-2">{edge.statement}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
