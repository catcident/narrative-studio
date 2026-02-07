/**
 * 채팅에서 언급된 엔티티 패널
 * force-graph(Canvas 기반)로 미니 관계도 표시
 */

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { User, MapPin, Building, Sword, Clock, Zap, Info, Heart, MessageCircle, X } from 'lucide-react';
import { useStore } from '../store';
import type { EntityCategory, Entity, HyperEdge } from '../types';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../constants';

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

// 감정별 엣지 색상
const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#22c55e',
  negative: '#ef4444',
  neutral: '#6b7280',
};

// force-graph-2d 노드/링크 타입 (라이브러리가 x/y 좌표를 런타임에 추가)
interface GraphNode {
  id: string;
  name: string;
  category: EntityCategory;
  color: string;
  entity: Entity;
  x: number;
  y: number;
}

interface GraphLink {
  source: GraphNode;
  target: GraphNode;
  label: string;
  sentiment: string;
  edge: HyperEdge;
}

// 툴팁 정보 타입
interface TooltipInfo {
  type: 'node' | 'edge';
  x: number;
  y: number;
  data: Entity | HyperEdge;
}

export function ChatMentionedPanel() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const chatMentionedEntities = useStore((s) => s.chatMentionedEntities);
  const selectEntity = useStore((s) => s.selectEntity);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- force-graph-2d 인스턴스 타입 미제공
  const graphRef = useRef<any>(null);

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

  // force-graph 초기화
  const updateGraph = useCallback(async () => {
    if (!containerRef.current || mentionedEntities.length < 2) return;

    // 동적 import (force-graph는 CSR only)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- force-graph-2d 동적 import, 타입 미제공
    const ForceGraph = (await import('force-graph')).default as any;

    // 노드 데이터 변환
    const graphNodes = mentionedEntities.map(entity => ({
      id: entity.id,
      name: entity.name,
      category: entity.category,
      color: CATEGORY_COLORS[entity.category] || '#6b7280',
      entity,
    }));

    // 유효한 노드 ID Set
    const nodeIdSet = new Set(graphNodes.map(n => n.id));

    // 엣지 데이터 변환
    const graphEdges = relevantEdges
      .filter(edge => edge.entities.length >= 2 && edge.entities.every(id => nodeIdSet.has(id)))
      .slice(0, 20)
      .map(edge => ({
        source: edge.entities[0],
        target: edge.entities[1],
        label: edge.type,
        sentiment: edge.sentiment || 'neutral',
        edge,
      }));

    const graphData = { nodes: graphNodes, links: graphEdges };

    // 기존 그래프 제거
    if (graphRef.current) {
      graphRef.current._destructor?.();
      containerRef.current.innerHTML = '';
    }

    // 컨테이너 크기
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // 새 그래프 생성
    graphRef.current = ForceGraph()(containerRef.current)
      .graphData(graphData)
      .width(width)
      .height(height)
      .nodeCanvasObject((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const radius = 10;

        // 노드 원
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 라벨 (이름) - Pretendard 폰트 사용
        const label = node.name.length > 6 ? node.name.slice(0, 6) + '…' : node.name;
        const fontSize = Math.max(10 / globalScale, 5);
        ctx.font = `500 ${fontSize}px Pretendard, -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#374151';
        ctx.fillText(label, node.x, node.y + radius + 3);
      })
      .nodeCanvasObjectMode(() => 'replace')
      .nodePointerAreaPaint((node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 14, 0, 2 * Math.PI);
        ctx.fill();
      })
      .linkCanvasObject((link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const start = link.source;
        const end = link.target;
        if (typeof start.x !== 'number' || typeof end.x !== 'number') return;

        // 엣지 선
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = SENTIMENT_COLORS[link.sentiment] || SENTIMENT_COLORS.neutral;
        ctx.lineWidth = 2;
        ctx.stroke();

        // 엣지 라벨 - Pretendard 폰트 사용
        if (link.label) {
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;
          const fontSize = Math.max(8 / globalScale, 4);
          ctx.font = `500 ${fontSize}px Pretendard, -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const textWidth = ctx.measureText(link.label).width;
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillRect(midX - textWidth/2 - 2, midY - fontSize/2 - 1, textWidth + 4, fontSize + 2);
          ctx.fillStyle = SENTIMENT_COLORS[link.sentiment] || '#6b7280';
          ctx.fillText(link.label, midX, midY);
        }
      })
      .linkCanvasObjectMode(() => 'replace')
      .backgroundColor('#fafafa')
      .onNodeHover((node: GraphNode | null) => {
        if (node && graphRef.current && typeof node.x === 'number') {
          const screenCoords = graphRef.current.graph2ScreenCoords(node.x, node.y);
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect && screenCoords) {
            setTooltip({
              type: 'node',
              x: rect.left + screenCoords.x + 20,
              y: rect.top + screenCoords.y,
              data: node.entity,
            });
          }
        } else {
          setTooltip(null);
        }
        if (containerRef.current) {
          containerRef.current.style.cursor = node ? 'pointer' : 'default';
        }
      })
      .onLinkHover((link: GraphLink | null) => {
        if (link && graphRef.current && link.source && typeof link.source.x === 'number') {
          const midX = (link.source.x + link.target.x) / 2;
          const midY = (link.source.y + link.target.y) / 2;
          const screenCoords = graphRef.current.graph2ScreenCoords(midX, midY);
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect && screenCoords) {
            setTooltip({
              type: 'edge',
              x: rect.left + screenCoords.x + 20,
              y: rect.top + screenCoords.y,
              data: link.edge,
            });
          }
        } else if (!link) {
          setTooltip(null);
        }
      })
      .onNodeClick((node: GraphNode | null) => {
        if (node?.entity) {
          selectEntity(node.entity.id);
        }
      });

    // Force 조정 - 더 퍼지게
    graphRef.current.d3Force('charge').strength(-200);
    graphRef.current.d3Force('link').distance(60);
    graphRef.current.d3Force('center', null);

    // 초기 줌 조정 - 더 작게 시작
    setTimeout(() => {
      graphRef.current?.zoomToFit(400, 60);
    }, 600);
  }, [mentionedEntities, relevantEdges, selectEntity]);

  // 그래프 업데이트
  useEffect(() => {
    updateGraph();
    return () => {
      if (graphRef.current) {
        graphRef.current._destructor?.();
      }
    };
  }, [updateGraph]);

  // 리사이즈 처리
  useEffect(() => {
    const handleResize = () => {
      if (graphRef.current && containerRef.current) {
        graphRef.current.width(containerRef.current.clientWidth);
        graphRef.current.height(containerRef.current.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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

      {/* 미니 관계도 - force-graph (Canvas) */}
      {mentionedEntities.length >= 2 && (
        <div
          ref={containerRef}
          className="flex-shrink-0 h-[600px] border-b border-gray-100"
        />
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
          className="fixed z-50 bg-slate-800 text-white rounded-lg shadow-lg p-2.5 max-w-[260px] text-sm pointer-events-none"
          style={{
            left: Math.min(tooltip.x, window.innerWidth - 280),
            top: tooltip.y,
          }}
        >
          {tooltip.type === 'node' ? (
            <div>
              <div className="font-medium">{(tooltip.data as Entity).name}</div>
              <div className="text-xs text-slate-300 mt-0.5">
                {CATEGORY_LABELS[(tooltip.data as Entity).category]}
              </div>
              {(tooltip.data as Entity).description && (
                <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">
                  {(tooltip.data as Entity).description}
                </p>
              )}
            </div>
          ) : (
            <div>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                (tooltip.data as HyperEdge).sentiment === 'positive' ? 'bg-green-600 text-white' :
                (tooltip.data as HyperEdge).sentiment === 'negative' ? 'bg-red-600 text-white' :
                'bg-gray-600 text-white'
              }`}>
                {(tooltip.data as HyperEdge).type}
              </span>
              <div className="text-xs text-slate-300 mt-1.5">
                {(tooltip.data as HyperEdge).entities
                  .map(id => knowledgeGraph?.entities[id]?.name || id)
                  .join(' ↔ ')}
              </div>
              {(tooltip.data as HyperEdge).statement && (
                <p className="text-xs text-slate-400 mt-1 line-clamp-3">
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
