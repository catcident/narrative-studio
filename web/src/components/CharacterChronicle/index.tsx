/**
 * 캐릭터 연대기 컴포넌트 (플로우차트 스타일)
 * 같은 장면은 같은 가로 줄에 배치
 * CSS Grid로 행 높이 자동 맞춤
 */

import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { User, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore, useCharacters } from '../../store';
import type { HyperEdge } from '../../types';
import { SENTIMENT_CARD_COLORS, CHARACTER_COLORS } from '../../constants';
import { RelationshipItemWithTooltip } from './RelationshipItemWithTooltip';
import { ChronicleHeader } from './ChronicleHeader';

// 줌 레벨 설정
const ZOOM_LEVELS = [0.6, 0.8, 1, 1.2, 1.5];
const DEFAULT_ZOOM_INDEX = 2; // 1 (100%)

// 페이지 설정
const PAGE_SIZE = 20;      // 한 페이지에 20개 장면
const PAGE_STEP = 10;      // 다음 페이지로 넘길 때 10개 겹침

interface SceneInfo {
  sceneId: string;
  sceneLabel: string;
  time: string;
  location: string;
  timeMarker?: string | null;  // 텍스트에 명시된 시간 표현 (예: "10년 전", "다음 날")
}

export function CharacterChronicle() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const selectEntity = useStore((s) => s.selectEntity);
  const characters = useCharacters();
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedColumnRef = useRef<HTMLTableCellElement>(null);

  // 줌 상태
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const zoomLevel = ZOOM_LEVELS[zoomIndex];

  // 현재 페이지 시작 인덱스 (0, 10, 20, 30 ...)
  const [pageStart, setPageStart] = useState(0);
  const [showJumpInput, setShowJumpInput] = useState(false);
  const [jumpValue, setJumpValue] = useState('');

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

    // ⚠️ 장면 정렬: chapterNumber 먼저, 같은 장 내에서 order 사용
    return Array.from(sceneSet)
      .sort((a, b) => {
        if (a === 'unknown') return 1;
        if (b === 'unknown') return -1;
        const snapshotA = knowledgeGraph.snapshots?.[a];
        const snapshotB = knowledgeGraph.snapshots?.[b];
        // 1. chapterNumber로 먼저 정렬
        const chapterA = snapshotA?.chapterNumber || 0;
        const chapterB = snapshotB?.chapterNumber || 0;
        if (chapterA !== chapterB) {
          return chapterA - chapterB;
        }
        // 2. 같은 장 내에서는 order로 정렬
        return (snapshotA?.order || 0) - (snapshotB?.order || 0);
      })
      .map((sceneId): SceneInfo => {
        const snapshot = knowledgeGraph.snapshots?.[sceneId];
        // order 필드 사용 (파일 순서 변경 시 업데이트됨), 없으면 sceneId에서 추출
        const sceneNum = snapshot?.order?.toString() || sceneId.replace('S', '').replace(/^0+/, '') || '?';

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
          // 새 필드(timeMarker) 우선, 기존 데이터 호환(timeElapsed)
          timeMarker: (snapshot as any)?.timeMarker || (snapshot as any)?.timeElapsed || null,
        };
      });
  }, [knowledgeGraph]);

  // 현재 페이지 장면들 (pageStart ~ pageStart + PAGE_SIZE)
  const pageEnd = Math.min(pageStart + PAGE_SIZE, allScenes.length);
  const pageScenes = useMemo(() =>
    allScenes.slice(pageStart, pageEnd),
    [allScenes, pageStart, pageEnd]
  );

  // 현재 페이지 장면 ID Set
  const pageSceneIds = useMemo(() =>
    new Set(pageScenes.map(s => s.sceneId)),
    [pageScenes]
  );

  // 현재 페이지에 등장하는 캐릭터들과 이벤트 매핑
  const { characterSceneEvents, visibleCharacters } = useMemo(() => {
    if (!knowledgeGraph) {
      return {
        characterSceneEvents: new Map<string, Map<string, HyperEdge[]>>(),
        visibleCharacters: [] as typeof characters
      };
    }

    const map = new Map<string, Map<string, HyperEdge[]>>();
    const charIdsInPage = new Set<string>();

    // 현재 페이지 장면에 관련된 엣지 처리
    Object.values(knowledgeGraph.hyperedges).forEach((edge) => {
      const edgeScenes = edge.scenes || ['unknown'];
      const relevantScenes = edgeScenes.filter(s => pageSceneIds.has(s));

      if (relevantScenes.length === 0) return;

      edge.entities.forEach(entityId => {
        const entity = knowledgeGraph.entities[entityId];
        if (!entity || entity.category !== 'character') return;

        charIdsInPage.add(entityId);

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

    // 현재 페이지에 등장하는 캐릭터만
    const visible = characters.filter(c => charIdsInPage.has(c.id));

    return { characterSceneEvents: map, visibleCharacters: visible };
  }, [knowledgeGraph, characters, pageSceneIds]);

  // 페이지 이동
  // 특정 장면으로 스크롤 (페이지 내 인덱스 기준)
  const scrollToSceneIndex = useCallback((localIndex: number) => {
    // 약간의 딜레이 후 스크롤 (DOM 업데이트 대기)
    setTimeout(() => {
      const sceneRow = document.getElementById(`scene-row-local-${localIndex}`);
      if (sceneRow && scrollContainerRef.current) {
        sceneRow.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }, 50);
  }, []);

  const goNextPage = useCallback(() => {
    const nextStart = pageStart + PAGE_STEP;
    if (nextStart < allScenes.length) {
      setPageStart(nextStart);
      // 겹치는 부분의 첫 장면으로 스크롤 (새 페이지의 10번째 = 이전 페이지 마지막 부분)
      // 0~20 -> 10~30 이면, 인덱스 10(새 페이지에서는 0번째부터 시작하므로 PAGE_STEP 위치)
      scrollToSceneIndex(PAGE_SIZE - PAGE_STEP); // 20-10 = 10번째 장면 (인덱스로는 10)
    }
  }, [pageStart, allScenes.length, scrollToSceneIndex]);

  const goPrevPage = useCallback(() => {
    const prevStart = pageStart - PAGE_STEP;
    setPageStart(Math.max(0, prevStart));
    // 겹치는 부분의 첫 장면으로 스크롤 (새 페이지에서 이전에 본 첫 장면 위치)
    // 30~50 -> 20~40 이면, 장면 30을 보여줘야 함 (새 페이지에서 인덱스 10)
    scrollToSceneIndex(PAGE_STEP); // 10번째 장면
  }, [pageStart, scrollToSceneIndex]);

  const goFirstPage = useCallback(() => {
    setPageStart(0);
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, []);

  const goLastPage = useCallback(() => {
    // 마지막 페이지 시작점 계산
    const lastStart = Math.max(0, allScenes.length - PAGE_SIZE);
    setPageStart(lastStart);
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [allScenes.length]);

  // 장면 번호로 점프
  const jumpToScene = useCallback((sceneNum: number) => {
    const targetIndex = sceneNum - 1;
    // 해당 장면이 포함된 페이지 시작점 계산
    const pageStartIndex = Math.floor(targetIndex / PAGE_STEP) * PAGE_STEP;
    setPageStart(Math.max(0, Math.min(pageStartIndex, allScenes.length - 1)));
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [allScenes.length]);

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
          <User className="w-12 h-12 mx-auto mb-2 opacity-50" aria-hidden="true" />
          <p>캐릭터가 없습니다</p>
        </div>
      </div>
    );
  }

  const getCharColor = (index: number) => CHARACTER_COLORS[index % CHARACTER_COLORS.length];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 헤더 */}
      <ChronicleHeader
        characterCount={characters.length}
        totalSceneCount={allScenes.length}
        showJumpInput={showJumpInput}
        setShowJumpInput={setShowJumpInput}
        jumpValue={jumpValue}
        setJumpValue={setJumpValue}
        handleJumpSubmit={handleJumpSubmit}
        pageStart={pageStart}
        pageEnd={pageEnd}
        zoomIndex={zoomIndex}
        zoomLevel={zoomLevel}
        zoomLevelsLength={ZOOM_LEVELS.length}
        handleZoomIn={handleZoomIn}
        handleZoomOut={handleZoomOut}
        selectedCharId={selectedCharId}
        setSelectedCharId={setSelectedCharId}
      />

      {/*
        ⚠️ 레이아웃: HTML Table 사용

        CSS Grid의 sticky는 가로 스크롤에서 제대로 작동하지 않음!
        HTML table의 첫 번째 열(td/th)에 sticky left-0을 적용하면
        가로 스크롤해도 왼쪽 열이 고정됨.

        행 높이가 자동으로 동기화되어 왼쪽/오른쪽 불일치 문제 해결.
      */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto cursor-grab select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <table
          className="border-collapse table-fixed"
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }}
        >
          {/* 헤더 행: 장면 라벨 + 캐릭터들 */}
          <thead>
            <tr>
              {/* 왼쪽 상단 고정 셀 */}
              <th
                className="sticky left-0 z-30 bg-gray-50 border-b border-r border-gray-200 text-center"
                style={{ width: 100, minWidth: 100 }}
              >
                <span className="text-xs font-medium text-gray-400">장면</span>
              </th>
              {/* 캐릭터 헤더들 */}
              {visibleCharacters.map((char) => {
                const isSelected = selectedCharId === char.id;
                const isOtherSelected = selectedCharId && !isSelected;
                const charColor = getCharColor(characters.findIndex(c => c.id === char.id));

                return (
                  <th
                    key={`header-${char.id}`}
                    ref={isSelected ? selectedColumnRef : undefined}
                    className={`sticky top-0 z-20 bg-gray-50 border-b border-gray-200 p-2 transition-opacity duration-300 ${
                      isOtherSelected ? 'opacity-30' : 'opacity-100'
                    }`}
                    style={{ width: 260, minWidth: 260 }}
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
                      className={`flex flex-col items-center p-2 rounded-xl transition-all mx-auto ${
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
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
          {/* 각 장면 행 */}
          {pageScenes.map((scene, localIndex) => {
            // 시간 마커 텍스트
            const getTimeMarkerText = () => {
              if (localIndex === 0) return null;
              if (scene.timeMarker) return scene.timeMarker;
              const prevScene = pageScenes[localIndex - 1];
              if (prevScene && scene.time && prevScene.time && scene.time !== prevScene.time) {
                return `${prevScene.time} → ${scene.time}`;
              }
              return null;
            };
            const timeMarkerText = getTimeMarkerText();

            return (
            <React.Fragment key={`row-${scene.sceneId}`}>
              {/* 시간 경과 행 */}
              {timeMarkerText && localIndex > 0 && (
                <tr>
                  {/* 시간 경과 라벨 (왼쪽 고정) */}
                  <td
                    className="sticky left-0 z-20 bg-amber-50 border-b border-r border-amber-200"
                    style={{ padding: '8px 12px' }}
                  >
                    <div className="text-amber-700 font-medium flex items-center gap-1 text-xs">
                      <span>⏱</span>
                      <span>{timeMarkerText}</span>
                    </div>
                  </td>
                  {/* 각 캐릭터 열에 시간 경과 표시 */}
                  {visibleCharacters.map((char) => (
                    <td
                      key={`time-${scene.sceneId}-${char.id}`}
                      className="bg-amber-50/50 border-b border-amber-100"
                      style={{ width: 260, maxWidth: 260, padding: 8 }}
                    >
                      <div className="w-full border-t-2 border-dashed border-amber-300" />
                    </td>
                  ))}
                </tr>
              )}

              {/* 장면 데이터 행 */}
              <tr id={`scene-row-local-${localIndex}`}>
                {/* 장면 라벨 (왼쪽 고정) */}
                <td
                  className="sticky left-0 z-20 bg-white border-b border-r border-gray-200 align-top"
                  style={{ padding: '16px 12px', minHeight: 120 }}
                >
                  <div className="font-bold text-blue-600 text-sm">
                    {scene.sceneLabel}
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {[scene.location, scene.time].filter(Boolean).join(' / ') || ''}
                  </div>
                </td>

                {/* 각 캐릭터의 해당 장면 셀 */}
                {visibleCharacters.map((char) => {
                  const globalIndex = characters.findIndex(c => c.id === char.id);
                  const isSelected = selectedCharId === char.id;
                  const isOtherSelected = selectedCharId && !isSelected;
                  const charColor = getCharColor(globalIndex);
                  const sceneMap = characterSceneEvents.get(char.id) || new Map();
                  const events = sceneMap.get(scene.sceneId) || [];
                  const hasEvents = events.length > 0;

                  // 이 장면에 등장 안 하면 빈 셀
                  if (!hasEvents) {
                    return (
                      <td
                        key={`cell-${scene.sceneId}-${char.id}`}
                        className={`border-b border-gray-100 transition-opacity duration-300 ${
                          isOtherSelected ? 'opacity-30' : 'opacity-100'
                        }`}
                        style={{ width: 260, maxWidth: 260, minHeight: 120 }}
                      />
                    );
                  }

                  // 대표 감정 결정
                  const sentiments = events.map((e: HyperEdge) => e.sentiment || 'neutral');
                  const mainSentiment = sentiments.includes('negative') ? 'negative' :
                    sentiments.includes('positive') ? 'positive' :
                    sentiments.includes('complex') ? 'complex' : 'neutral';
                  const colors = SENTIMENT_CARD_COLORS[mainSentiment];

                  return (
                    <td
                      key={`cell-${scene.sceneId}-${char.id}`}
                      className={`border-b border-gray-100 relative transition-opacity duration-300 align-top ${
                        isOtherSelected ? 'opacity-30' : 'opacity-100'
                      }`}
                      style={{ width: 260, maxWidth: 260, minHeight: 120, padding: 12 }}
                    >
                      {/* 연속 세로선 */}
                      <div
                        className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2"
                        style={{ backgroundColor: charColor }}
                      />

                      {/* 이벤트 카드 - 너비 고정, 텍스트 줄바꿈 */}
                      <div
                        className="rounded-xl shadow-md overflow-hidden relative z-10 bg-white flex flex-col"
                        style={{
                          border: `2px solid ${colors.border}`,
                          width: 236,  /* 260 - 24 (padding) */
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
                    </td>
                  );
                })}
              </tr>
            </React.Fragment>
          );
          })}
          </tbody>
        </table>
      </div>

      {/* 하단: 네비게이션 + 범례 */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200">
        {/* 페이지 네비게이션 바 */}
        <div className="px-3 py-2 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {/* 처음으로 */}
            <button
              onClick={goFirstPage}
              disabled={pageStart === 0}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex"
              title="처음으로"
              aria-label="처음으로"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              <ChevronLeft className="w-4 h-4 -ml-2.5" aria-hidden="true" />
            </button>

            {/* 이전 */}
            <button
              onClick={goPrevPage}
              disabled={pageStart === 0}
              className="px-3 py-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
              title="이전 페이지"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              <span className="text-sm">이전</span>
            </button>

            {/* 페이지 정보 */}
            <div className="flex-1 flex items-center justify-center gap-2">
              <span className="text-sm font-medium text-gray-700">
                장면 {pageStart + 1} - {pageEnd}
              </span>
              <span className="text-xs text-gray-400">
                / 총 {allScenes.length}개
              </span>
            </div>

            {/* 다음 */}
            <button
              onClick={goNextPage}
              disabled={pageStart + PAGE_STEP >= allScenes.length}
              className="px-3 py-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
              title="다음 페이지"
            >
              <span className="text-sm">다음</span>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* 끝으로 */}
            <button
              onClick={goLastPage}
              disabled={pageStart >= allScenes.length - PAGE_SIZE}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex"
              title="끝으로"
              aria-label="끝으로"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
              <ChevronRight className="w-4 h-4 -ml-2.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 범례 */}
        <div className="p-2 flex items-center gap-4 text-[10px] text-gray-500">
          <span className="font-medium">감정:</span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: SENTIMENT_CARD_COLORS.positive.bg, border: `1px solid ${SENTIMENT_CARD_COLORS.positive.border}` }} />
            긍정
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: SENTIMENT_CARD_COLORS.negative.bg, border: `1px solid ${SENTIMENT_CARD_COLORS.negative.border}` }} />
            부정
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: SENTIMENT_CARD_COLORS.neutral.bg, border: `1px solid ${SENTIMENT_CARD_COLORS.neutral.border}` }} />
            중립
          </span>
          <span className="mx-2">|</span>
          <span>페이지당 20개 (10개 겹침) · 캐릭터 클릭 강조</span>
        </div>
      </div>
    </div>
  );
}
