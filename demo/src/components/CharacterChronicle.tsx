/**
 * 캐릭터 연대기 컴포넌트 (플로우차트 스타일)
 * 같은 장면은 같은 가로 줄에 배치
 * CSS Grid로 행 높이 자동 맞춤
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { User, Clock, X } from 'lucide-react';
import { useStore, useCharacters } from '../store';
import type { HyperEdge } from '../types';

// 감정 색상
const SENTIMENT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  positive: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  negative: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
  neutral: { bg: '#f3f4f6', border: '#d1d5db', text: '#4b5563' },
  complex: { bg: '#f3e8ff', border: '#d8b4fe', text: '#7e22ce' },
};

// 캐릭터별 색상
const CHARACTER_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899',
  '#14b8a6', '#6366f1', '#f43f5e', '#06b6d4', '#f59e0b',
];

interface SceneInfo {
  sceneId: string;
  sceneLabel: string;
  time: string;
}

export function CharacterChronicle() {
  const { ontology, selectEntity } = useStore();
  const characters = useCharacters();
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedColumnRef = useRef<HTMLDivElement>(null);

  // 모든 장면 목록 (정렬됨)
  const allScenes = useMemo(() => {
    if (!ontology) return [];

    const sceneSet = new Set<string>();
    Object.values(ontology.hyperedges).forEach((edge) => {
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
        const snapshot = ontology.snapshots?.[sceneId];
        const sceneNum = sceneId.replace('S', '').replace(/^0+/, '') || '?';

        // 시간 정보 찾기
        let time = snapshot?.time || '시점 미상';
        if (time === '시점 미상') {
          // 해당 장면의 엣지에서 시간 정보 찾기
          const edge = Object.values(ontology.hyperedges).find(
            (e) => e.scenes?.includes(sceneId) && e.timeline?.start
          );
          if (edge?.timeline?.start) {
            time = edge.timeline.start;
          }
        }

        return {
          sceneId,
          sceneLabel: `장면 ${sceneNum}`,
          time,
        };
      });
  }, [ontology]);

  // 캐릭터별, 장면별 이벤트 매핑
  const characterSceneEvents = useMemo(() => {
    if (!ontology) return new Map<string, Map<string, HyperEdge[]>>();

    const map = new Map<string, Map<string, HyperEdge[]>>();

    characters.forEach((char) => {
      const sceneMap = new Map<string, HyperEdge[]>();

      Object.values(ontology.hyperedges).forEach((edge) => {
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
  }, [ontology, characters]);

  // 선택된 캐릭터로 스크롤
  useEffect(() => {
    if (selectedCharId && selectedColumnRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const column = selectedColumnRef.current;
      const scrollTo = column.offsetLeft - (container.clientWidth / 2) + (column.clientWidth / 2);
      container.scrollTo({ left: Math.max(0, scrollTo), behavior: 'smooth' });
    }
  }, [selectedCharId]);

  if (!ontology || characters.length === 0) {
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

      {/* 그리드 영역 */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto"
      >
        <div
          className="grid gap-0"
          style={{
            gridTemplateColumns: `100px repeat(${characters.length}, 260px)`,
            gridTemplateRows: `80px repeat(${allScenes.length}, auto)`,
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
          {allScenes.map((scene, sceneIndex) => (
            <>
              {/* 장면 라벨 (고정) */}
              <div
                key={`label-${scene.sceneId}`}
                className="sticky left-0 z-20 bg-white border-b border-r border-gray-200 px-3 py-4 flex flex-col justify-center"
              >
                <div className="text-sm font-bold text-blue-600">{scene.sceneLabel}</div>
                <div className="text-xs text-gray-500 mt-0.5">{scene.time}</div>
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
                    className={`border-b border-gray-100 p-3 flex items-stretch justify-center relative transition-opacity duration-300 ${
                      isOtherSelected ? 'opacity-30' : 'opacity-100'
                    }`}
                    style={{ minHeight: '120px' }}
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
                        {/* 헤더: 장면 / 시점 */}
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
                            {scene.time}
                          </div>
                        </div>
                        {/* 관계 목록 - 전체 표시 */}
                        <div className="p-3 space-y-3 flex-1">
                          {events.map((edge: HyperEdge, i: number) => {
                            // 관계 상대방 이름 추출 (현재 캐릭터 제외)
                            const partnerNames = edge.entities
                              .filter(id => id !== char.id)
                              .map(id => ontology.entities[id]?.name || id)
                              .join(', ');

                            return (
                              <div
                                key={`${edge.id}-${i}`}
                                className="text-sm leading-relaxed border-l-2 pl-2"
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
                                    {edge.type}
                                  </span>
                                  {partnerNames && (
                                    <span className="text-xs font-medium text-gray-800">
                                      → {partnerNames}
                                    </span>
                                  )}
                                </div>
                                {/* 설명 */}
                                {edge.statement && (
                                  <p className="text-gray-600 text-xs leading-relaxed">
                                    {edge.statement}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ))}
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
