/**
 * 캐릭터 연대기 컴포넌트 (플로우차트 스타일)
 * 같은 장면은 같은 가로 줄에 배치
 * CSS Grid로 행 높이 자동 맞춤
 */

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { User, Clock, X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useStore, useCharacters } from '../store';
import type { HyperEdge } from '../types';

// 줌 레벨 설정
const ZOOM_LEVELS = [0.6, 0.8, 1, 1.2, 1.5];
const DEFAULT_ZOOM_INDEX = 2; // 1 (100%)

// 윈도우 설정
const VISIBLE_SIZE = 15;  // 화면에 보여줄 장면 수
const BUFFER_SIZE = 10;   // 앞뒤 버퍼 장면 수 (프리로드)
const TOTAL_LOAD_SIZE = VISIBLE_SIZE + BUFFER_SIZE * 2; // 총 로드 크기 (35개)
const SCROLL_THRESHOLD = 300; // 스크롤 트리거 거리 (px)

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
  timeElapsed?: string | null;  // 이전 장면으로부터 경과 시간
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

  // 현재 "논리적" 시작 위치 (사용자가 보고 있다고 생각하는 위치)
  const [logicalStart, setLogicalStart] = useState(0);
  const [showJumpInput, setShowJumpInput] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
          timeElapsed: snapshot?.timeElapsed || null,
        };
      });
  }, [knowledgeGraph]);

  // 실제 로드 범위 (버퍼 포함)
  const loadStart = Math.max(0, logicalStart - BUFFER_SIZE);
  const loadEnd = Math.min(loadStart + TOTAL_LOAD_SIZE, allScenes.length);

  // 논리적 범위 (사용자에게 표시되는 범위)
  const logicalEnd = Math.min(logicalStart + VISIBLE_SIZE, allScenes.length);

  // 로드된 장면들 (버퍼 포함)
  const loadedScenes = useMemo(() =>
    allScenes.slice(loadStart, loadEnd),
    [allScenes, loadStart, loadEnd]
  );

  // 로드된 장면 ID Set
  const loadedSceneIds = useMemo(() =>
    new Set(loadedScenes.map(s => s.sceneId)),
    [loadedScenes]
  );

  // 로드된 장면에 등장하는 캐릭터들과 이벤트 매핑
  const { characterSceneEvents, visibleCharacters } = useMemo(() => {
    if (!knowledgeGraph) {
      return {
        characterSceneEvents: new Map<string, Map<string, HyperEdge[]>>(),
        visibleCharacters: [] as typeof characters
      };
    }

    const map = new Map<string, Map<string, HyperEdge[]>>();
    const charIdsInWindow = new Set<string>();

    // 로드된 장면에 관련된 엣지 처리
    Object.values(knowledgeGraph.hyperedges).forEach((edge) => {
      const edgeScenes = edge.scenes || ['unknown'];
      const relevantScenes = edgeScenes.filter(s => loadedSceneIds.has(s));

      if (relevantScenes.length === 0) return;

      edge.entities.forEach(entityId => {
        const entity = knowledgeGraph.entities[entityId];
        if (!entity || entity.category !== 'character') return;

        charIdsInWindow.add(entityId);

        if (!map.has(entityId)) {
          map.set(entityId, new Map());
        }
        const sceneMap = map.get(entityId)!;

        relevantScenes.forEach(sceneId => {
          if (!sceneMap.has(sceneId)) {
            sceneMap.set(sceneId, []);
          }
          sceneMap.get(sceneId)!.push(edge);
        });
      });
    });

    // 로드된 범위에 등장하는 캐릭터만
    const visible = characters.filter(c => charIdsInWindow.has(c.id));

    return { characterSceneEvents: map, visibleCharacters: visible };
  }, [knowledgeGraph, characters, loadedSceneIds]);

  // 윈도우 이동 (버튼용)
  const moveWindow = useCallback((direction: 'up' | 'down') => {
    if (direction === 'down' && logicalEnd < allScenes.length) {
      setLogicalStart(prev => Math.min(prev + 5, allScenes.length - VISIBLE_SIZE));
    } else if (direction === 'up' && logicalStart > 0) {
      setLogicalStart(prev => Math.max(prev - 5, 0));
    }
  }, [logicalStart, logicalEnd, allScenes.length]);

  // 특정 위치로 점프
  const jumpToPosition = useCallback((position: number) => {
    const newStart = Math.max(0, Math.min(position, allScenes.length - VISIBLE_SIZE));
    setLogicalStart(newStart);
  }, [allScenes.length]);

  // 스크롤 핸들러 - 버퍼 영역 진입 시 논리적 위치만 조정 (화면 점프 없음)
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || isScrollingRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const scrollBottom = scrollHeight - scrollTop - clientHeight;

    // 아래쪽 버퍼 영역 진입 - 다음 데이터 프리로드
    if (scrollBottom < SCROLL_THRESHOLD && logicalEnd < allScenes.length) {
      isScrollingRef.current = true;
      setLogicalStart(prev => Math.min(prev + 5, allScenes.length - VISIBLE_SIZE));
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 200);
    }
    // 위쪽 버퍼 영역 진입 - 이전 데이터 프리로드
    else if (scrollTop < SCROLL_THRESHOLD && logicalStart > 0) {
      isScrollingRef.current = true;
      setLogicalStart(prev => Math.max(prev - 5, 0));
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 200);
    }
  }, [logicalStart, logicalEnd, allScenes.length]);

  // 스크롤 이벤트 등록
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [handleScroll]);

  // 장면 번호로 점프
  const jumpToScene = useCallback((sceneNum: number) => {
    const targetIndex = sceneNum - 1;
    jumpToPosition(Math.max(0, targetIndex - 2)); // 약간 위에서 시작
  }, [jumpToPosition]);

  // 점프 입력 처리
  const handleJumpSubmit = () => {
    const num = parseInt(jumpValue);
    if (!isNaN(num) && num >= 1 && num <= allScenes.length) {
      jumpToScene(num);
      setShowJumpInput(false);
      setJumpValue('');
    }
  };

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
          {/* 장면 점프 */}
          {showJumpInput ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={allScenes.length}
                value={jumpValue}
                onChange={(e) => setJumpValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJumpSubmit()}
                placeholder={`1-${allScenes.length}`}
                className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleJumpSubmit}
                className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                이동
              </button>
              <button
                onClick={() => { setShowJumpInput(false); setJumpValue(''); }}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowJumpInput(true)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
              title="장면으로 이동"
            >
              <Search className="w-3 h-3" />
              장면 이동
            </button>
          )}

          {/* 현재 위치 */}
          <div className="flex items-center gap-1 border-l border-gray-200 pl-2">
            <span className="text-xs text-gray-600">
              {logicalStart + 1}-{logicalEnd} / {allScenes.length}
            </span>
          </div>

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
            gridTemplateColumns: `${100 * zoomLevel}px repeat(${visibleCharacters.length}, ${260 * zoomLevel}px)`,
            gridTemplateRows: `${80 * zoomLevel}px repeat(${loadedScenes.length}, auto)`,
          }}
        >
          {/* 헤더 행: 빈 셀 + 캐릭터 헤더들 */}
          <div className="sticky left-0 z-30 bg-gray-50 border-b border-r border-gray-200 flex items-center justify-center">
            <span className="text-xs font-medium text-gray-400">장면</span>
          </div>
          {visibleCharacters.map((char, charIndex) => {
            const isSelected = selectedCharId === char.id;
            const isOtherSelected = selectedCharId && !isSelected;
            const charColor = getCharColor(characters.findIndex(c => c.id === char.id));

            return (
              <div
                key={`header-${char.id}`}
                ref={isSelected ? selectedColumnRef : undefined}
                className={`sticky top-0 z-20 bg-gray-50 border-b border-gray-200 flex items-center justify-center p-2 transition-opacity duration-300 ${
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
          {loadedScenes.map((scene, localIndex) => {
            const sceneNum = parseInt(scene.sceneId.replace('S', '').replace(/^0+/, '') || '0');
            // 시간 경과 텍스트: timeElapsed 우선, 없으면 시간 변화 비교
            const getTimeElapsedText = () => {
              // 윈도우 첫 장면은 시간 경과 표시 안함
              if (localIndex === 0) return null;

              // 1. 지식그래프에서 추출한 timeElapsed 사용 (우선)
              if (scene.timeElapsed) {
                return scene.timeElapsed;
              }

              // 2. fallback: 이전 장면과 시간이 다르면 표시
              const prevScene = loadedScenes[localIndex - 1];
              if (prevScene && scene.time && prevScene.time && scene.time !== prevScene.time) {
                return `${prevScene.time} → ${scene.time}`;
              }
              return null;
            };
            const timeElapsedText = getTimeElapsedText();

            return (
            <>
              {/* 시간 경과 행 (장면 사이에 표시) */}
              {timeElapsedText && localIndex > 0 && (
                <>
                  {/* 시간 경과 라벨 셀 */}
                  <div
                    key={`time-label-${scene.sceneId}`}
                    className="sticky left-0 z-20 bg-amber-50 border-b border-r border-amber-200 flex items-center justify-center"
                    style={{ padding: `${8 * zoomLevel}px ${12 * zoomLevel}px` }}
                  >
                    <div
                      className="text-amber-700 font-medium flex items-center gap-1"
                      style={{ fontSize: `${11 * zoomLevel}px` }}
                    >
                      <span>⏱</span>
                      <span>{timeElapsedText}</span>
                    </div>
                  </div>
                  {/* 각 캐릭터 열에 시간 경과 표시 */}
                  {visibleCharacters.map((char) => (
                    <div
                      key={`time-${scene.sceneId}-${char.id}`}
                      className="bg-amber-50/50 border-b border-amber-100 flex items-center justify-center"
                      style={{ padding: `${8 * zoomLevel}px` }}
                    >
                      <div
                        className="w-full border-t-2 border-dashed border-amber-300"
                      />
                    </div>
                  ))}
                </>
              )}

              {/* 장면 라벨 (고정) */}
              <div
                id={`scene-row-${sceneNum}`}
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
              </div>

              {/* 각 캐릭터의 해당 장면 셀 (등장하는 캐릭터만) */}
              {visibleCharacters.map((char) => {
                const globalIndex = characters.findIndex(c => c.id === char.id);
                const isSelected = selectedCharId === char.id;
                const isOtherSelected = selectedCharId && !isSelected;
                const charColor = getCharColor(globalIndex);
                const sceneMap = characterSceneEvents.get(char.id) || new Map();
                const events = sceneMap.get(scene.sceneId) || [];
                const hasEvents = events.length > 0;

                // 이 장면에 등장 안 하면 빈 셀 (세로선만)
                if (!hasEvents) {
                  return (
                    <div
                      key={`cell-${scene.sceneId}-${char.id}`}
                      className={`border-b border-gray-100 transition-opacity duration-300 ${
                        isOtherSelected ? 'opacity-30' : 'opacity-100'
                      }`}
                      style={{ minHeight: `${120 * zoomLevel}px` }}
                    />
                  );
                }

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
                    <div
                      className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2"
                      style={{ backgroundColor: charColor }}
                    />

                    {/* 이벤트 카드 */}
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
                  </div>
                );
              })}
            </>
          );
          })}
        </div>
      </div>

      {/* 하단: 네비게이션 + 범례 */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200">
        {/* 장면 네비게이션 바 */}
        <div className="px-3 py-2 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {/* 처음으로 */}
            <button
              onClick={() => setLogicalStart(0)}
              disabled={logicalStart === 0}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex"
              title="처음으로"
            >
              <ChevronLeft className="w-4 h-4" />
              <ChevronLeft className="w-4 h-4 -ml-2.5" />
            </button>

            {/* 이전 */}
            <button
              onClick={() => moveWindow('up')}
              disabled={logicalStart === 0}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title="이전"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* 슬라이더 + 눈금 */}
            <div className="flex-1 relative">
              {/* 슬라이더 트랙 배경에 눈금 */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 bg-gray-200 rounded-full">
                {/* 현재 위치 표시 */}
                <div
                  className="absolute top-0 h-full bg-blue-500 rounded-full transition-all"
                  style={{
                    left: `${(logicalStart / Math.max(1, allScenes.length - VISIBLE_SIZE)) * 100}%`,
                    width: `${(VISIBLE_SIZE / allScenes.length) * 100}%`,
                  }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, allScenes.length - VISIBLE_SIZE)}
                value={logicalStart}
                onChange={(e) => jumpToPosition(parseInt(e.target.value))}
                className="relative w-full h-4 appearance-none bg-transparent cursor-pointer z-10"
                style={{
                  WebkitAppearance: 'none',
                }}
              />
              {/* 눈금 라벨 */}
              <div className="flex justify-between text-[9px] text-gray-400 mt-1 px-0.5">
                <span>1</span>
                <span>{Math.floor(allScenes.length / 4)}</span>
                <span>{Math.floor(allScenes.length / 2)}</span>
                <span>{Math.floor(allScenes.length * 3 / 4)}</span>
                <span>{allScenes.length}</span>
              </div>
            </div>

            {/* 다음 */}
            <button
              onClick={() => moveWindow('down')}
              disabled={logicalEnd >= allScenes.length}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title="다음"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* 끝으로 */}
            <button
              onClick={() => setLogicalStart(Math.max(0, allScenes.length - VISIBLE_SIZE))}
              disabled={logicalEnd >= allScenes.length}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex"
              title="끝으로"
            >
              <ChevronRight className="w-4 h-4" />
              <ChevronRight className="w-4 h-4 -ml-2.5" />
            </button>

            {/* 현재 위치 표시 */}
            <span className="text-xs text-gray-600 min-w-[90px] text-right font-medium">
              {logicalStart + 1}-{logicalEnd} / {allScenes.length}
            </span>
          </div>
        </div>

        {/* 범례 */}
        <div className="p-2 flex items-center gap-4 text-[10px] text-gray-500">
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
          <span>스크롤로 더 보기 · 캐릭터 클릭 강조</span>
        </div>
      </div>
    </div>
  );
}
