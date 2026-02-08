/**
 * 인물 관계도 그래프 컴포넌트
 * React Flow를 사용한 하이퍼그래프 시각화
 * 인물 중심 원형 배치 + 연결 없는 노드는 외곽 배치
 */

import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
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
import { useStore, useExportFormats } from '../../store';
import type { Entity, HyperEdge, EntityCategory } from '../../types';
import { getCharacters, getEntitiesByCategory } from '../../services/knowledgeGraphQueries';
import { Eye, EyeOff, Filter, PanelLeftOpen, PanelLeftClose, Image, FileText, Crown, FileDown } from 'lucide-react';
import { exportGraphAsPng, exportGraphAsSvg, captureGraphAsPngDataUrl } from '../../services/graphExport';
import { EntitySelector } from '../EntitySelector';
import { CATEGORY_COLORS, RELATION_COLORS, RELATION_LABELS, SENTIMENT_STROKE_STYLES, CHARACTER_COLORS } from '../../constants';
import {
  nodeTypes,
  SceneInfoPopup,
  EdgeDetailPopup,
} from './GraphNodes';
import type {
  GraphViewMode,
  EntityWithOpacity,
  EdgeWithOpacity,
  Props,
} from './GraphNodes';

// 이미지 내보내기 패널 (ReactFlow 트리 내부에서 사용)
function GraphExportPanel({
  nodes,
  onShowSubscription,
}: {
  nodes: Node[];
  onShowSubscription?: () => void;
}) {
  const exportFormats = useExportFormats();
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const title = knowledgeGraph?.metadata?.title;
  const [isExporting, setIsExporting] = useState(false);
  const canPng = exportFormats.includes('png');
  const canSvg = exportFormats.includes('svg');
  const canPdf = exportFormats.includes('pdf');
  const canExportAny = canPng || canSvg || canPdf;

  const filename = title?.replace(/[^a-zA-Z0-9가-힣]/g, '_') || 'knowledge-graph';

  const handleExportPng = async () => {
    if (!canPng) {
      onShowSubscription?.();
      return;
    }
    setIsExporting(true);
    try {
      await exportGraphAsPng(nodes, `${filename}.png`);
    } catch (err: unknown) {
      console.error('[export] PNG export failed:', err instanceof Error ? err.message : err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSvg = async () => {
    if (!canSvg) {
      onShowSubscription?.();
      return;
    }
    setIsExporting(true);
    try {
      await exportGraphAsSvg(nodes, `${filename}.svg`);
    } catch (err: unknown) {
      console.error('[export] SVG export failed:', err instanceof Error ? err.message : err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!canPdf) {
      onShowSubscription?.();
      return;
    }
    if (!knowledgeGraph) return;
    setIsExporting(true);
    try {
      const graphImage = await captureGraphAsPngDataUrl(nodes);
      const { exportPdfReport } = await import('../../services/pdfReport');
      await exportPdfReport(knowledgeGraph, graphImage);
    } catch (err: unknown) {
      console.error('[export] PDF export failed:', err instanceof Error ? err.message : err);
    } finally {
      setIsExporting(false);
    }
  };

  if (!canExportAny) {
    return (
      <button
        onClick={() => onShowSubscription?.()}
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
        aria-label="업그레이드하여 내보내기"
      >
        <Crown className="w-3.5 h-3.5" aria-hidden="true" />
        <span>내보내기</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {canPng && (
        <button
          onClick={handleExportPng}
          disabled={isExporting}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          aria-label="PNG로 내보내기"
        >
          <Image className="w-3.5 h-3.5" aria-hidden="true" />
          <span>PNG</span>
        </button>
      )}
      {canSvg && (
        <button
          onClick={handleExportSvg}
          disabled={isExporting}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          aria-label="SVG로 내보내기"
        >
          <FileText className="w-3.5 h-3.5" aria-hidden="true" />
          <span>SVG</span>
        </button>
      )}
      {canPdf && (
        <button
          onClick={handleExportPdf}
          disabled={isExporting}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          aria-label="PDF 보고서 내보내기"
        >
          <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
          <span>PDF</span>
        </button>
      )}
    </div>
  );
}

// 노드 수 임계값
const NODE_THRESHOLD = 100;

export function RelationshipGraph({ entities, edges, onNodeClick, selectedScene, sceneIndex, onShowSubscription }: Props) {
  const selectedEntityId = useStore((s) => s.selectedEntityId);
  const selectEntity = useStore((s) => s.selectEntity);
  const [selectedEdge, setSelectedEdge] = useState<HyperEdge | null>(null);
  const [viewMode, setViewMode] = useState<GraphViewMode>('full');
  const [focusedCharIds, setFocusedCharIds] = useState<string[]>([]);
  const [minConnections, setMinConnections] = useState<number>(1);  // 최소 연결 횟수 필터
  const [showSidebar, setShowSidebar] = useState(true);
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);

  // 인물 목록 추출
  const characters = useMemo(() =>
    getCharacters(entities),
    [entities]
  );

  // 노드가 많으면 자동으로 주인공(최다 등장 인물)만 선택
  useEffect(() => {
    if (entities.length > NODE_THRESHOLD && selectedEntityIds.length === 0) {
      // 등장 횟수 1위 인물만 기본 선택
      const topCharacter = [...characters]
        .sort((a, b) => (b.scenes?.length || 0) - (a.scenes?.length || 0))
        .slice(0, 1)
        .map(c => c.id);
      setSelectedEntityIds(topCharacter);
      setShowSidebar(true);
    }
  }, [entities.length, characters]);

  // 선택된 엔티티와의 연결 횟수 계산
  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (selectedEntityIds.length === 0) return counts;

    edges.forEach(edge => {
      const hasSelected = selectedEntityIds.some(id => edge.entities.includes(id));
      if (hasSelected) {
        edge.entities.forEach(id => {
          if (!selectedEntityIds.includes(id)) {
            counts.set(id, (counts.get(id) || 0) + 1);
          }
        });
      }
    });
    return counts;
  }, [edges, selectedEntityIds]);

  // 사이드바 선택에 의한 필터링 (노드가 많을 때)
  const sidebarFilteredResult = useMemo(() => {
    // 노드가 많은데 아무것도 선택 안됐으면 빈 그래프
    if (entities.length > NODE_THRESHOLD && selectedEntityIds.length === 0) {
      return { filteredEntities: [], filteredEdges: [] };
    }

    // 사이드바에서 선택된 엔티티가 있으면 그것들과 연결된 것만 표시
    if (selectedEntityIds.length > 0) {
      const fEdges = edges.filter(e =>
        selectedEntityIds.some(id => e.entities.includes(id))
      );

      const relatedEntityIds = new Set<string>(selectedEntityIds);
      fEdges.forEach(edge => {
        edge.entities.forEach(id => {
          // 연결 횟수 필터 적용 (선택된 것은 항상 표시)
          const count = connectionCounts.get(id) || 0;
          if (selectedEntityIds.includes(id) || count >= minConnections) {
            relatedEntityIds.add(id);
          }
        });
      });

      const fEntities = entities.filter(e => relatedEntityIds.has(e.id));
      // 연결 횟수 필터가 적용된 엣지만
      const filteredFEdges = fEdges.filter(e =>
        e.entities.every(id => relatedEntityIds.has(id))
      );
      return { filteredEntities: fEntities, filteredEdges: filteredFEdges };
    }

    return { filteredEntities: entities, filteredEdges: edges };
  }, [entities, edges, selectedEntityIds, connectionCounts, minConnections]);

  // 인물 중심 모드: 선택된 인물들이 직접 연결된 것만 표시
  const { filteredEntities, filteredEdges } = useMemo(() => {
    const baseEntities = sidebarFilteredResult.filteredEntities;
    const baseEdges = sidebarFilteredResult.filteredEdges;

    if (viewMode !== 'focused' || focusedCharIds.length === 0) {
      return { filteredEntities: baseEntities, filteredEdges: baseEdges };
    }

    // 포커스된 인물들이 직접 연결된 관계만 필터링
    const fEdges = baseEdges.filter(e =>
      focusedCharIds.some(charId => e.entities.includes(charId))
    );

    // 해당 관계에 포함된 엔티티만 표시 (포커스된 인물들 + 직접 연결된 엔티티들)
    const relatedEntityIds = new Set<string>(focusedCharIds);
    fEdges.forEach(edge => {
      edge.entities.forEach(id => relatedEntityIds.add(id));
    });

    const fEntities = baseEntities.filter(e => relatedEntityIds.has(e.id));

    return { filteredEntities: fEntities, filteredEdges: fEdges };
  }, [sidebarFilteredResult, viewMode, focusedCharIds]);

  // 간소화 모드: 인물만 표시
  const displayEntities = useMemo(() => {
    if (viewMode === 'simple') {
      return getCharacters(filteredEntities);
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
    const chars = getCharacters(displayEntities);
    const locations = getEntitiesByCategory(displayEntities, 'location');
    const others = displayEntities.filter(e => e.category !== 'character' && e.category !== 'location');

    const centerX = 400;
    const centerY = 350;

    // 인물 중심 모드: 선택한 인물들이 중앙에 위치
    const isFocusedMode = viewMode === 'focused' && focusedCharIds.length > 0;
    const focusedEntities = isFocusedMode ? displayEntities.filter(e => focusedCharIds.includes(e.id)) : [];

    // 원 크기 계산: 최대 반지름 제한으로 전체가 보이도록
    const getRadius = (count: number, nodeSize: number, minCount: number) => {
      const effectiveCount = Math.max(count, minCount);
      const spacing = nodeSize + 10; // 노드 크기 + 여백
      const calculated = (effectiveCount * spacing) / (2 * Math.PI);
      // 최소 100, 최대 350으로 제한
      return Math.min(350, Math.max(100, calculated));
    };

    // 인물 중심 모드일 때도 동일한 구조: 중앙 → 인물 → 장소 → 기타
    if (isFocusedMode && focusedEntities.length > 0) {
      const relatedChars = chars.filter(e => !focusedCharIds.includes(e.id));

      // 중앙 영역 반지름 (선택된 인물 수에 따라 조정)
      const centerRadius = focusedEntities.length > 1 ? Math.min(80, 30 + focusedEntities.length * 20) : 0;

      // 각 레이어별 반지름
      const charRadius = getRadius(relatedChars.length, 50, 4) + centerRadius;
      const locationRadius = charRadius + 60;
      const otherRadius = locationRadius + 50;

      const allPositions: { id: string; x: number; y: number; size: number; layer: number }[] = [];

      // 인물 레이어
      relatedChars.forEach((entity, i) => {
        const angle = (2 * Math.PI * i) / Math.max(relatedChars.length, 1) - Math.PI / 2;
        allPositions.push({
          id: entity.id,
          x: centerX + charRadius * Math.cos(angle),
          y: centerY + charRadius * Math.sin(angle),
          size: 50,
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
          size: 56,
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

      // 중앙 노드들 (포커스된 인물들)
      const nodes: Node[] = [];
      focusedEntities.forEach((focusedEntity, i) => {
        // 여러 명이면 중앙에 원형 배치, 1명이면 정중앙
        const angle = focusedEntities.length > 1
          ? (2 * Math.PI * i) / focusedEntities.length - Math.PI / 2
          : 0;
        const x = focusedEntities.length > 1
          ? centerX + centerRadius * Math.cos(angle)
          : centerX;
        const y = focusedEntities.length > 1
          ? centerY + centerRadius * Math.sin(angle)
          : centerY;

        nodes.push({
          id: focusedEntity.id,
          type: 'default',
          position: { x, y },
          data: { label: focusedEntity.name, entity: focusedEntity },
          style: {
            background: CATEGORY_COLORS[focusedEntity.category],
            color: 'white',
            border: '3px solid #fbbf24',
            borderRadius: '50%',
            width: 60,
            height: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 600,
            boxShadow: '0 0 20px rgba(251, 191, 36, 0.5)',
          },
        });
      });

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
            border: selectedEntityId === entity.id ? '2px solid #1e40af' : 'none',
            borderRadius: '50%',
            width: 50,
            height: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            fontWeight: 500,
            opacity: isPast ? 0.35 : 1,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
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
            borderRadius: '6px',
            width: 56,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '9px',
            fontWeight: 500,
            opacity: isPast ? 0.35 : 1,
            boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
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

    // 일반 모드 - 원형 배치
    const charRadius = getRadius(chars.length, 50, 4);
    const locationRadius = charRadius + 60;
    const otherRadius = locationRadius + 50;

    // 초기 위치 설정
    const allPositions: { id: string; x: number; y: number; size: number; layer: number }[] = [];

    chars.forEach((entity, i) => {
      const angle = (2 * Math.PI * i) / chars.length - Math.PI / 2;
      allPositions.push({
        id: entity.id,
        x: centerX + charRadius * Math.cos(angle),
        y: centerY + charRadius * Math.sin(angle),
        size: 50,
        layer: 1,
      });
    });

    locations.forEach((entity, i) => {
      const angle = (2 * Math.PI * i) / locations.length + Math.PI / 6;
      allPositions.push({
        id: entity.id,
        x: centerX + locationRadius * Math.cos(angle),
        y: centerY + locationRadius * Math.sin(angle),
        size: 56,
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
          border: selectedEntityId === entity.id ? '2px solid #1e40af' : 'none',
          borderRadius: '50%',
          width: 50,
          height: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: 500,
          opacity: isPast ? 0.35 : 1,
          boxShadow: selectedEntityId === entity.id
            ? '0 0 15px rgba(59, 130, 246, 0.5)'
            : '0 2px 8px rgba(0,0,0,0.12)',
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
          borderRadius: '6px',
          width: 56,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '9px',
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
  }, [displayEntities, selectedEntityId, viewMode, focusedCharIds]);

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
      const dashArray = SENTIMENT_STROKE_STYLES[edge.sentiment || 'neutral'].strokeDasharray;
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

  // 엔티티/뷰모드 변경 시에만 노드 위치 재설정 (선택 상태 변경 시 제외)
  const prevDisplayEntitiesRef = useRef<string>('');
  const prevViewModeRef = useRef<string>('');
  const prevFocusedCharIdsRef = useRef<string>('');

  useEffect(() => {
    const entitiesKey = displayEntities.map(e => e.id).sort().join(',');
    const focusedKey = focusedCharIds.sort().join(',');
    const shouldResetPositions =
      entitiesKey !== prevDisplayEntitiesRef.current ||
      viewMode !== prevViewModeRef.current ||
      focusedKey !== prevFocusedCharIdsRef.current;

    if (shouldResetPositions) {
      // 엔티티 구성이나 뷰모드가 변경됨 → 위치 초기화
      setNodes(initialNodes);
      prevDisplayEntitiesRef.current = entitiesKey;
      prevViewModeRef.current = viewMode;
      prevFocusedCharIdsRef.current = focusedKey;
    } else {
      // 선택 상태만 변경됨 → 스타일만 업데이트 (위치 유지)
      setNodes(currentNodes =>
        currentNodes.map(node => {
          const newNode = initialNodes.find(n => n.id === node.id);
          if (newNode) {
            return {
              ...node,
              style: newNode.style, // 스타일만 업데이트
              data: newNode.data,
            };
          }
          return node;
        })
      );
    }
  }, [initialNodes, setNodes, displayEntities, viewMode, focusedCharIds]);

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

  const getCharColor = (index: number) => CHARACTER_COLORS[index % CHARACTER_COLORS.length];

  return (
    <div className="w-full h-full bg-gray-50 rounded-xl overflow-hidden relative flex">
      {/* 엔티티 선택 사이드바 */}
      {showSidebar && (
        <div className="w-64 h-full flex-shrink-0 relative z-20">
          <EntitySelector
            entities={entities}
            selectedIds={selectedEntityIds}
            onSelectionChange={setSelectedEntityIds}
          />
        </div>
      )}

      {/* 그래프 영역 */}
      <div className="flex-1 h-full relative">
        {/* 사이드바 토글 버튼 */}
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="absolute top-3 left-3 z-10 bg-white rounded-lg shadow-lg p-2 hover:bg-gray-50"
          title={showSidebar ? '사이드바 닫기' : '사이드바 열기'}
          aria-label={showSidebar ? '사이드바 닫기' : '사이드바 열기'}
        >
          {showSidebar ? (
            <PanelLeftClose className="w-4 h-4 text-gray-600" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="w-4 h-4 text-gray-600" aria-hidden="true" />
          )}
        </button>

        {/* 노드 수 경고 (많을 때) */}
        {entities.length > NODE_THRESHOLD && selectedEntityIds.length === 0 && (
          <div className="absolute top-3 left-14 z-10 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
            노드가 {entities.length}개로 많습니다. 사이드바에서 표시할 항목을 선택하세요.
          </div>
        )}

        {/* 뷰 모드 + 내보내기 컨트롤 */}
        <div className="absolute top-3 right-3 z-10 bg-white rounded-lg shadow-lg p-2">
          <div className="flex items-center justify-between gap-2 mb-2 border-b border-gray-100 pb-2">
            <GraphExportPanel
              nodes={nodes}
              onShowSubscription={onShowSubscription}
            />
          </div>
          <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => { setViewMode('full'); setFocusedCharIds([]); }}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
              viewMode === 'full'
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title="전체 보기"
          >
            <Eye className="w-3 h-3" aria-hidden="true" />
            전체
          </button>
          <button
            onClick={() => { setViewMode('simple'); setFocusedCharIds([]); }}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
              viewMode === 'simple'
                ? 'bg-green-100 text-green-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title="간소화 (인물만)"
          >
            <EyeOff className="w-3 h-3" aria-hidden="true" />
            간소화
          </button>
          </div>

        {/* 연결 횟수 필터 - 선택된 엔티티가 있을 때만 */}
        {selectedEntityIds.length > 0 && (
          <div className="border-t border-gray-100 pt-2 mt-2">
            <div className="flex items-center gap-2">
              <Filter className="w-3 h-3 text-gray-400" aria-hidden="true" />
              <span className="text-[10px] text-gray-400">연결</span>
              <input
                type="range"
                min="1"
                max="10"
                value={minConnections}
                onChange={(e) => setMinConnections(Number(e.target.value))}
                className="w-16 h-1 accent-blue-500"
              />
              <span className="text-[10px] text-gray-600 font-medium w-4">{minConnections}+</span>
            </div>
            {minConnections > 1 && (
              <div className="text-[9px] text-gray-400 mt-1">
                {displayEntities.length}개 표시
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
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.3, maxZoom: 1.5 }}
          minZoom={0.1}
          maxZoom={3}
          nodesDraggable={true}
          nodesConnectable={false}
          edgesFocusable={false}
          panOnScroll={false}
          zoomOnScroll={true}
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

        {/* 장면 정보 팝업 */}
        {selectedScene && sceneIndex && (
          <SceneInfoPopup
            scene={selectedScene}
            sceneIndex={sceneIndex}
            edges={edges}
            entities={entities}
            onClose={() => {}}
          />
        )}
      </div>
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
