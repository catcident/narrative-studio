/**
 * 캐릭터 연대기 컴포넌트 (플로우차트 스타일)
 * 같은 장면은 같은 가로 줄에 배치
 * CSS Grid로 행 높이 자동 맞춤
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { User, Clock, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useStore, useCharacters } from '../store';
import type { HyperEdge } from '../types';

// 줌 레벨 설정
const ZOOM_LEVELS = [0.6, 0.8, 1, 1.2, 1.5];
const DEFAULT_ZOOM_INDEX = 2; // 1 (100%)

// 감정 색상
const SENTIMENT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  positive: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  negative: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
  neutral: { bg: '#f3f4f6', border: '#d1d5db', text: '#4b5563' },
  complex: { bg: '#f3e8ff', border: '#d8b4fe', text: '#7e22ce' },
};

// 관계 유형 한글화
const RELATION_LABELS: Record<string, string> = {
  family: '가족', romantic: '연인', friendship: '친구', rivalry: '적대',
  mentor: '스승', subordinate: '부하', trust: '신뢰', belongs_to: '소속',
  owns: '소유', knows_about: '인지', located_at: '위치', related_to: '관련', related: '관련',
  '가족': '가족', '연인': '연인', '친구': '친구', '적대': '적대', '동료': '동료',
  '주인': '주인', '위치': '위치', '소유': '소유', '관련': '관련',
};

// 관계 항목 컴포넌트 (호버/클릭 가능)
function RelationshipItemWithTooltip({
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

// 캐릭터별 색상
const CHARACTER_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899',
  '#14b8a6', '#6366f1', '#f43f5e', '#06b6d4', '#f59e0b',
];

interface SceneInfo {
  sceneId: string;
  sceneLabel: string;
  time: string;
  location: string;
}

export function CharacterChronicle() {
  const { knowledgeGraph, selectEntity } = useStore();
  const characters = useCharacters();
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedColumnRef = useRef<HTMLDivElement>(null);

  // 줌 상태
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const zoomLevel = ZOOM_LEVELS[zoomIndex];

  // 줌 핸들러
  const handleZoomIn = () => {
    setZoomIndex((prev) => Math.min(prev + 1, ZOOM_LEVELS.length - 1));
  };

  const handleZoomOut = () => {
    setZoomIndex((prev) => Math.max(prev - 1, 0));
  };

  // 드래그 스크롤 상태
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ x: 0, y: 0 });

  // 드래그 스크롤 핸들러
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setScrollStart({
      x: scrollContainerRef.current.scrollLeft,
      y: scrollContainerRef.current.scrollTop,
    });
    scrollContainerRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    scrollContainerRef.current.scrollLeft = scrollStart.x - dx;
    scrollContainerRef.current.scrollTop = scrollStart.y - dy;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.cursor = 'grab';
    }
  };

  const handleMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.cursor = 'grab';
      }
    }
  };

  // 모든 장면 목록 (정렬됨)
  const allScenes = useMemo(() => {
    if (!knowledgeGraph) return [];

    const sceneSet = new Set<string>();
    Object.values(knowledgeGraph.hyperedges).forEach((edge) => {
      const scenes = edge.scenes || ['unknown'];
      scenes.forEach((s) => sceneSet.add(s));
    });

    return Array.from(sceneSet)
      .sort((a, b) => {
        if (a === 'unknown') return 1;
        if (b === 'unknown') return -1;
        return a.localeCompare(b);
      })
      .map((sceneId): SceneInfo => {
        const snapshot = knowledgeGraph.snapshots?.[sceneId];
        const sceneNum = sceneId.replace('S', '').replace(/^0+/, '') || '?';

        // 시간 정보 찾기
        let time = snapshot?.time || '';
        if (!time) {
          // 해당 장면의 엣지에서 시간 정보 찾기
          const edge = Object.values(knowledgeGraph.hyperedges).find(
            (e) => e.scenes?.includes(sceneId) && e.timeline?.start
          );
          if (edge?.timeline?.start) {
            time = edge.timeline.start;
          }
        }

        // 장소 정보
        const location = snapshot?.location || '';

        return {
          sceneId,
          sceneLabel: `장면 ${sceneNum}`,
          time,
          location,
        };
      });
  }, [knowledgeGraph]);

  // 캐릭터별, 장면별 이벤트 매핑
  const characterSceneEvents = useMemo(() => {
    if (!knowledgeGraph) return new Map<string, Map<string, HyperEdge[]>>();

    const map = new Map<string, Map<string, HyperEdge[]>>();

    characters.forEach((char) => {
      const sceneMap = new Map<string, HyperEdge[]>();

      Object.values(knowledgeGraph.hyperedges).forEach((edge) => {
        if (!edge.entities.includes(char.id)) return;

        const scenes = edge.scenes || ['unknown'];
        scenes.forEach((sceneId) => {
          if (!sceneMap.has(sceneId)) {
            sceneMap.set(sceneId, []);
          }
          sceneMap.get(sceneId)!.push(edge);
        });
      });

      map.set(char.id, sceneMap);
    });

    return map;
  }, [knowledgeGraph, characters]);

  // 선택된 캐릭터로 스크롤
  useEffect(() => {
    if (selectedCharId && selectedColumnRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const column = selectedColumnRef.current;
      const scrollTo = column.offsetLeft - (container.clientWidth / 2) + (column.clientWidth / 2);
      container.scrollTo({ left: Math.max(0, scrollTo), behavior: 'smooth' });
    }
  }, [selectedCharId]);

  if (!knowledgeGraph || characters.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 text-gray-400">
        <div className="text-center">
          <User className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>캐릭터가 없습니다</p>
        </div>
      </div>
    );
  }

  const getCharColor = (index: number) => CHARACTER_COLORS[index % CHARACTER_COLORS.length];

  // 캐릭터의 첫 등장 장면 인덱스
  const getFirstSceneIndex = (charId: string): number => {
    const sceneMap = characterSceneEvents.get(charId);
    if (!sceneMap) return -1;

    for (let i = 0; i < allScenes.length; i++) {
      if (sceneMap.has(allScenes[i].sceneId)) {
        return i;
      }
    }
    return -1;
  };

  // 캐릭터의 마지막 등장 장면 인덱스
  const getLastSceneIndex = (charId: string): number => {
    const sceneMap = characterSceneEvents.get(charId);
    if (!sceneMap) return -1;

    for (let i = allScenes.length - 1; i >= 0; i--) {
      if (sceneMap.has(allScenes[i].sceneId)) {
        return i;
      }
    }
    return -1;
  };

  // 현재 장면이 캐릭터의 타임라인 범위 안에 있는지 확인
  const isInTimelineRange = (charId: string, sceneIndex: number): boolean => {
    const first = getFirstSceneIndex(charId);
    const last = getLastSceneIndex(charId);
    return first !== -1 && sceneIndex >= first && sceneIndex <= last;
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 헤더 */}
      <div className="p-3 bg-white border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">캐릭터 연대기</span>
          <span className="text-xs text-gray-400">
            {characters.length}명 · {allScenes.length}개 장면
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 줌 컨트롤 */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg px-1 py-0.5">
            <button
              onClick={handleZoomOut}
              disabled={zoomIndex === 0}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="축소"
            >
              <ZoomOut className="w-4 h-4 text-gray-600" />
            </button>
            <span className="text-xs text-gray-600 min-w-[40px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="확대"
            >
              <ZoomIn className="w-4 h-4 text-gray-600" />
            </button>
          </div>
          {selectedCharId && (
            <button
              onClick={() => setSelectedCharId(null)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              <X className="w-3 h-3" />
              선택 해제
            </button>
          )}
        </div>
      </div>

      {/* 그리드 영역 - 드래그로 스크롤 가능 */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto cursor-grab select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <div
          className="grid gap-0 origin-top-left transition-transform duration-200"
          style={{
            gridTemplateColumns: `${100 * zoomLevel}px repeat(${characters.length}, ${260 * zoomLevel}px)`,
            gridTemplateRows: `${80 * zoomLevel}px repeat(${allScenes.length}, auto)`,
          }}
        >
          {/* 헤더 행: 빈 셀 + 캐릭터 헤더들 */}
          <div className="sticky left-0 z-30 bg-gray-50 border-b border-r border-gray-200 flex items-center justify-center">
            <span className="text-xs font-medium text-gray-400">장면</span>
          </div>
          {characters.map((char, charIndex) => {
            const isSelected = selectedCharId === char.id;
            const isOtherSelected = selectedCharId && !isSelected;
            const charColor = getCharColor(charIndex);

            return (
              <div
                key={`header-${char.id}`}
                ref={isSelected ? selectedColumnRef : undefined}
                className={`border-b border-gray-200 flex items-center justify-center p-2 transition-opacity duration-300 ${
                  isOtherSelected ? 'opacity-30' : 'opacity-100'
                }`}
              >
                <button
                  onClick={() => {
                    if (selectedCharId === char.id) {
                      setSelectedCharId(null);
                    } else {
                      setSelectedCharId(char.id);
                      selectEntity(char.id);
                    }
                  }}
                  className={`flex flex-col items-center p-2 rounded-xl transition-all ${
                    isSelected
                      ? 'bg-blue-50 ring-2 ring-blue-400 shadow-lg scale-105'
                      : 'bg-white hover:bg-gray-50 shadow'
                  }`}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-md"
                    style={{ backgroundColor: charColor }}
                  >
                    {char.name.charAt(0)}
                  </div>
                  <span className={`mt-1 text-xs font-medium truncate max-w-[120px] ${
                    isSelected ? 'text-blue-700' : 'text-gray-700'
                  }`}>
                    {char.name}
                  </span>
                </button>
              </div>
            );
          })}

          {/* 각 장면 행 */}
          {allScenes.map((scene, sceneIndex) => {
            // 이전 장면과의 시간 경과 계산
            const prevScene = sceneIndex > 0 ? allScenes[sceneIndex - 1] : null;
            const timeChange = (() => {
              if (!prevScene) return null;
              // 현재 장면의 시간이 이전과 다르면 표시
              if (scene.time && prevScene.time && scene.time !== prevScene.time) {
                return { from: prevScene.time, to: scene.time };
              }
              // 이전에 시간 정보가 없다가 새로 나타난 경우
              if (scene.time && !prevScene.time) {
                return { from: null, to: scene.time };
              }
              return null;
            })();

            return (
            <>
              {/* 장면 라벨 (고정) */}
              <div
                key={`label-${scene.sceneId}`}
                className="sticky left-0 z-20 bg-white border-b border-r border-gray-200 flex flex-col justify-center"
                style={{ padding: `${16 * zoomLevel}px ${12 * zoomLevel}px` }}
              >
                <div
                  className="font-bold text-blue-600"
                  style={{ fontSize: `${14 * zoomLevel}px` }}
                >
                  {scene.sceneLabel}
                </div>
                {/* 장소/시간 정보 */}
                <div
                  className="text-gray-500"
                  style={{ fontSize: `${12 * zoomLevel}px`, marginTop: `${2 * zoomLevel}px` }}
                >
                  {[scene.location, scene.time].filter(Boolean).join(' / ') || ''}
                </div>
                {/* 시간 경과 표시 - 이전→현재 형태 */}
                {timeChange && sceneIndex > 0 && (
                  <div
                    className="text-amber-600 bg-amber-50 rounded inline-block"
                    style={{
                      fontSize: `${10 * zoomLevel}px`,
                      marginTop: `${4 * zoomLevel}px`,
                      padding: `${2 * zoomLevel}px ${6 * zoomLevel}px`
                    }}
                  >
                    ⏱ {timeChange.from ? `${timeChange.from} → ${timeChange.to}` : `→ ${timeChange.to}`}
                  </div>
                )}
              </div>

              {/* 각 캐릭터의 해당 장면 셀 */}
              {characters.map((char, charIndex) => {
                const isSelected = selectedCharId === char.id;
                const isOtherSelected = selectedCharId && !isSelected;
                const charColor = getCharColor(charIndex);
                const sceneMap = characterSceneEvents.get(char.id) || new Map();
                const events = sceneMap.get(scene.sceneId) || [];
                const hasEvents = events.length > 0;
                const inRange = isInTimelineRange(char.id, sceneIndex);

                // 대표 감정 결정
                const sentiments = events.map((e: HyperEdge) => e.sentiment || 'neutral');
                const mainSentiment = sentiments.includes('negative') ? 'negative' :
                  sentiments.includes('positive') ? 'positive' :
                  sentiments.includes('complex') ? 'complex' : 'neutral';
                const colors = SENTIMENT_COLORS[mainSentiment];

                return (
                  <div
                    key={`cell-${scene.sceneId}-${char.id}`}
                    className={`border-b border-gray-100 flex items-stretch justify-center relative transition-opacity duration-300 ${
                      isOtherSelected ? 'opacity-30' : 'opacity-100'
                    }`}
                    style={{ minHeight: `${120 * zoomLevel}px`, padding: `${12 * zoomLevel}px` }}
                  >
                    {/* 연속 세로선 */}
                    {inRange && (
                      <div
                        className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2"
                        style={{ backgroundColor: charColor, opacity: hasEvents ? 1 : 0.3 }}
                      />
                    )}

                    {hasEvents && (
                      <div
                        className="w-full rounded-xl shadow-md overflow-hidden relative z-10 bg-white flex flex-col"
                        style={{
                          border: `2px solid ${colors.border}`,
                        }}
                      >
                        {/* 헤더: 장면 번호 + 장소/시간 */}
                        <div
                          className="px-3 py-2 flex-shrink-0"
                          style={{ backgroundColor: colors.bg }}
                        >
                          <div
                            className="text-sm font-bold"
                            style={{ color: colors.text }}
                          >
                            {scene.sceneLabel}
                          </div>
                          <div
                            className="text-xs opacity-80"
                            style={{ color: colors.text }}
                          >
                            {[scene.location, scene.time].filter(Boolean).join(' / ') || '정보 없음'}
                          </div>
                        </div>
                        {/* 관계 목록 - 호버/클릭 가능 */}
                        <div className="p-3 space-y-2 flex-1">
                          {events.map((edge: HyperEdge, i: number) => (
                            <RelationshipItemWithTooltip
                              key={`${edge.id}-${i}`}
                              edge={edge}
                              charId={char.id}
                              entities={knowledgeGraph.entities}
                              colors={colors}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          );
          })}
        </div>
      </div>

      {/* 하단 범례 */}
      <div className="flex-shrink-0 p-2 bg-white border-t border-gray-200 flex items-center gap-4 text-[10px] text-gray-500">
        <span className="font-medium">감정:</span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: SENTIMENT_COLORS.positive.bg, border: `1px solid ${SENTIMENT_COLORS.positive.border}` }} />
          긍정
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: SENTIMENT_COLORS.negative.bg, border: `1px solid ${SENTIMENT_COLORS.negative.border}` }} />
          부정
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: SENTIMENT_COLORS.neutral.bg, border: `1px solid ${SENTIMENT_COLORS.neutral.border}` }} />
          중립
        </span>
        <span className="mx-2">|</span>
        <span>캐릭터를 클릭하면 강조됩니다</span>
      </div>
    </div>
  );
}
