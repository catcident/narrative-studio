/**
 * 인물 관계도 그래프 컴포넌트
 * force-graph를 사용한 Canvas 기반 시각화
 * d3-force로 자동 배치 + 드래그 지원
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import type { Entity, HyperEdge, EntityCategory } from '../types';
import { X, Eye, EyeOff, Filter } from 'lucide-react';

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
  '소속': '#a855f7',
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

type ViewMode = 'full' | 'simple';

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

// 툴팁 데이터
interface TooltipData {
  x: number;
  y: number;
  entity: Entity;
}

// 선택된 엣지 정보
interface SelectedEdgeData {
  edge: HyperEdge;
  entities: Entity[];
}

export function RelationshipGraph({ entities, edges, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const { selectedEntityId, selectEntity } = useStore();

  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdgeData | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('full');
  const [minImportance, setMinImportance] = useState<number>(1);

  // 필터링된 엔티티
  const filteredEntities = viewMode === 'simple'
    ? entities.filter(e => e.category === 'character')
    : minImportance > 1
      ? entities.filter(e => e.category === 'character' || (e.importance || 5) >= minImportance)
      : entities;

  // 필터링된 엣지
  const filteredEdges = (() => {
    const entityIds = new Set(filteredEntities.map(e => e.id));
    return edges.filter(e => e.entities.every(id => entityIds.has(id)));
  })();

  // 그래프 업데이트
  const updateGraph = useCallback(async () => {
    if (!containerRef.current || filteredEntities.length === 0) return;

    // 동적 import
    const ForceGraph = (await import('force-graph')).default as any;

    // 노드 데이터
    const graphNodes = filteredEntities.map(entity => ({
      id: entity.id,
      name: entity.name,
      category: entity.category,
      importance: entity.importance || 5,
      description: entity.description,
      isPast: entity.isPastScene,
      color: CATEGORY_COLORS[entity.category] || '#9ca3af',
    }));

    // 엣지 데이터 (하이퍼엣지를 페어로 분해)
    const graphLinks: any[] = [];
    filteredEdges.forEach(edge => {
      for (let i = 0; i < edge.entities.length; i++) {
        for (let j = i + 1; j < edge.entities.length; j++) {
          graphLinks.push({
            source: edge.entities[i],
            target: edge.entities[j],
            type: edge.type,
            color: RELATION_COLORS[edge.type] || '#9ca3af',
            strength: edge.strength || 5,
            edgeData: edge,
          });
        }
      }
    });

    const graphData = { nodes: graphNodes, links: graphLinks };

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
      .nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const isCharacter = node.category === 'character';
        const isLocation = node.category === 'location';
        const isSelected = selectedEntityId === node.id;

        // 크기 계산 (중요도 기반)
        const baseSize = isCharacter ? 12 : isLocation ? 10 : 6;
        const size = baseSize + (node.importance - 5) * 0.5;

        ctx.globalAlpha = node.isPast ? 0.4 : 1;

        // 선택된 노드 하이라이트
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, size + 4, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
          ctx.fill();
        }

        // 노드 그리기
        if (isLocation) {
          // 장소: 둥근 사각형
          const w = size * 2;
          const h = size * 1.2;
          ctx.beginPath();
          ctx.roundRect(node.x - w/2, node.y - h/2, w, h, 3);
          ctx.fillStyle = node.color;
          ctx.fill();
        } else {
          // 기본: 원
          ctx.beginPath();
          ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
          ctx.fillStyle = node.color;
          ctx.fill();
        }

        // 테두리
        ctx.strokeStyle = isSelected ? '#1e40af' : 'rgba(255,255,255,0.8)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();

        ctx.globalAlpha = 1;

        // 라벨 (인물, 장소만)
        if (isCharacter || isLocation) {
          const fontSize = Math.max(10 / globalScale, 4);
          ctx.font = `${isCharacter ? 'bold ' : ''}${fontSize}px 'Pretendard', sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = node.isPast ? '#9ca3af' : '#374151';
          ctx.fillText(node.name, node.x, node.y + size + 2);
        }
      })
      .nodeCanvasObjectMode(() => 'replace')
      .nodePointerAreaPaint((node: any, color: string, ctx: CanvasRenderingContext2D) => {
        const size = node.category === 'character' ? 16 : 12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.fill();
      })
      .linkCanvasObject((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const start = link.source;
        const end = link.target;
        if (typeof start.x !== 'number' || typeof end.x !== 'number') return;

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = link.color;
        ctx.lineWidth = Math.min(link.strength / 3, 2);
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // 엣지 라벨 (줌인 했을 때만)
        if (globalScale > 0.8 && link.type) {
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;
          const fontSize = Math.max(8 / globalScale, 4);
          ctx.font = `${fontSize}px 'Pretendard', sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const text = link.type;
          const textWidth = ctx.measureText(text).width;
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(midX - textWidth/2 - 2, midY - fontSize/2 - 1, textWidth + 4, fontSize + 2);
          ctx.fillStyle = link.color;
          ctx.fillText(text, midX, midY);
        }
      })
      .linkCanvasObjectMode(() => 'replace')
      .backgroundColor('#f9fafb')
      .onNodeHover((node: any) => {
        if (node && graphRef.current && typeof node.x === 'number') {
          const screenCoords = graphRef.current.graph2ScreenCoords(node.x, node.y);
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect && screenCoords) {
            const entity = filteredEntities.find(e => e.id === node.id);
            if (entity) {
              setTooltip({
                x: rect.left + screenCoords.x + 15,
                y: rect.top + screenCoords.y - 10,
                entity,
              });
            }
          }
        } else {
          setTooltip(null);
        }
        if (containerRef.current) {
          containerRef.current.style.cursor = node ? 'pointer' : 'default';
        }
      })
      .onNodeClick((node: any) => {
        selectEntity(node.id);
        const entity = filteredEntities.find(e => e.id === node.id);
        if (entity) {
          onNodeClick?.(entity);
        }
      })
      .onLinkClick((link: any) => {
        if (link.edgeData) {
          const relatedEntities = link.edgeData.entities
            .map((id: string) => entities.find(e => e.id === id))
            .filter(Boolean) as Entity[];
          setSelectedEdge({ edge: link.edgeData, entities: relatedEntities });
        }
      })
      .onBackgroundClick(() => {
        setSelectedEdge(null);
      });

    // Force 설정
    graphRef.current.d3Force('charge').strength(-150);
    graphRef.current.d3Force('link')
      .distance((link: any) => {
        const srcCat = link.source?.category;
        const tgtCat = link.target?.category;
        // 인물-인물: 가깝게
        if (srcCat === 'character' && tgtCat === 'character') return 80;
        // 인물-장소: 중간
        if (srcCat === 'character' || tgtCat === 'character') return 100;
        // 기타
        return 60;
      })
      .strength(0.5);

    // 초기 줌
    setTimeout(() => {
      graphRef.current?.zoomToFit(400, 50);
    }, 500);

  }, [filteredEntities, filteredEdges, selectedEntityId, onNodeClick, selectEntity, entities]);

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

  if (entities.length === 0) {
    return (
      <div className="w-full h-full bg-gray-50 rounded-xl flex items-center justify-center">
        <p className="text-gray-500">표시할 엔티티가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-gray-50 rounded-xl overflow-hidden">
      {/* 컨트롤 패널 */}
      <div className="absolute top-3 left-3 z-10 bg-white rounded-lg shadow-lg p-2">
        <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => setViewMode('full')}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
              viewMode === 'full'
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Eye className="w-3 h-3" />
            전체
          </button>
          <button
            onClick={() => setViewMode('simple')}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
              viewMode === 'simple'
                ? 'bg-green-100 text-green-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <EyeOff className="w-3 h-3" />
            인물만
          </button>
        </div>

        {viewMode === 'full' && (
          <div className="border-t border-gray-100 pt-2">
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
                {filteredEntities.length}/{entities.length} 표시
              </div>
            )}
          </div>
        )}
      </div>

      {/* 통계 */}
      <div className="absolute top-3 right-3 z-10 bg-white/95 px-3 py-2 rounded-lg shadow-sm text-xs">
        <span className="text-gray-500">노드: </span>
        <span className="font-bold text-blue-600">{filteredEntities.length}</span>
        <span className="text-gray-300 mx-2">|</span>
        <span className="text-gray-500">관계: </span>
        <span className="font-bold text-blue-600">{filteredEdges.length}</span>
      </div>

      {/* 그래프 컨테이너 */}
      <div ref={containerRef} className="w-full h-full" />

      {/* 호버 툴팁 */}
      {tooltip && (
        <div
          className="fixed bg-slate-800 text-white px-3 py-2 rounded-lg shadow-lg text-xs z-50 max-w-xs pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-bold text-sm mb-1">{tooltip.entity.name}</div>
          <div className="text-slate-300 mb-1">
            <span className="text-slate-400">유형:</span> {tooltip.entity.category}
          </div>
          {tooltip.entity.description && (
            <div className="text-slate-300 text-[11px] leading-tight mt-1 border-t border-slate-600 pt-1">
              {tooltip.entity.description.slice(0, 100)}
              {tooltip.entity.description.length > 100 ? '...' : ''}
            </div>
          )}
        </div>
      )}

      {/* 선택된 관계 정보 */}
      {selectedEdge && (
        <div className="absolute bottom-4 left-4 right-4 z-10 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 max-w-md">
          <div className="flex items-start justify-between mb-3">
            <div>
              <span
                className="text-xs font-bold px-2 py-1 rounded"
                style={{
                  backgroundColor: (RELATION_COLORS[selectedEdge.edge.type] || '#9ca3af') + '20',
                  color: RELATION_COLORS[selectedEdge.edge.type] || '#666'
                }}
              >
                {selectedEdge.edge.type}
              </span>
              {selectedEdge.edge.sentiment && (
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                  selectedEdge.edge.sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                  selectedEdge.edge.sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {selectedEdge.edge.sentiment === 'positive' ? '긍정' :
                   selectedEdge.edge.sentiment === 'negative' ? '부정' : '중립'}
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedEdge(null)}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          <div className="text-sm font-medium text-gray-800 mb-2">
            {selectedEdge.entities.map(e => e.name).join(' ↔ ')}
          </div>

          {selectedEdge.edge.statement && (
            <p className="text-sm text-gray-600 leading-relaxed">
              {selectedEdge.edge.statement}
            </p>
          )}
        </div>
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
