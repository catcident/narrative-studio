/**
 * 타임라인 뷰 컴포넌트
 * 시간순으로 스토리 흐름과 관계 변화를 시각화
 */

import { useMemo, useState } from 'react';
import { Clock, Users, ChevronDown, ChevronRight, Sparkles, BookOpen, Heart, Swords, MessageCircle } from 'lucide-react';
import { useStore } from '../store';
import type { HyperEdge, Entity } from '../types';

// 관계 유형별 설정
const RELATION_CONFIG: Record<string, { label: string; icon: typeof Heart; color: string }> = {
  family: { label: '가족', icon: Heart, color: '#ec4899' },
  romantic: { label: '연인', icon: Heart, color: '#f43f5e' },
  friendship: { label: '친구', icon: MessageCircle, color: '#22c55e' },
  rivalry: { label: '적대', icon: Swords, color: '#ef4444' },
  mentor: { label: '스승-제자', icon: BookOpen, color: '#8b5cf6' },
  subordinate: { label: '상하관계', icon: Users, color: '#6366f1' },
  belongs_to: { label: '소속', icon: Users, color: '#a855f7' },
  owns: { label: '소유', icon: Sparkles, color: '#f59e0b' },
  '가족': { label: '가족', icon: Heart, color: '#ec4899' },
  '연인': { label: '연인', icon: Heart, color: '#f43f5e' },
  '친구': { label: '친구', icon: MessageCircle, color: '#22c55e' },
  '적대': { label: '적대', icon: Swords, color: '#ef4444' },
  '동료': { label: '동료', icon: Users, color: '#3b82f6' },
  '소속': { label: '소속', icon: Users, color: '#a855f7' },
  '소유': { label: '소유', icon: Sparkles, color: '#f59e0b' },
  '위치': { label: '위치', icon: Sparkles, color: '#14b8a6' },
  '포함': { label: '포함', icon: Sparkles, color: '#6366f1' },
  '관련': { label: '관련', icon: MessageCircle, color: '#64748b' },
};

const SENTIMENT_STYLES = {
  positive: { bg: 'from-green-50 to-emerald-50', border: 'border-green-200', accent: '#22c55e' },
  negative: { bg: 'from-red-50 to-rose-50', border: 'border-red-200', accent: '#ef4444' },
  neutral: { bg: 'from-gray-50 to-slate-50', border: 'border-gray-200', accent: '#64748b' },
  complex: { bg: 'from-purple-50 to-violet-50', border: 'border-purple-200', accent: '#8b5cf6' },
};

interface TimelineEvent {
  id: string;
  sceneId: string;
  sceneNum: number;
  time: string;
  timeMarker?: string | null;  // 텍스트에 명시된 시간 표현 (예: "10년 전", "다음 날")
  location?: string;
  summary?: string;
  chapter?: number;
  chapterTitle?: string;
  edges: HyperEdge[];
  entities: Entity[];
}

export function TimelineView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const selectEntity = useStore((s) => s.selectEntity);
  const selectedEntityId = useStore((s) => s.selectedEntityId);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  // 장면(snapshot) 기반 타임라인
  const events = useMemo(() => {
    if (!knowledgeGraph) return [];

    const snapshots = knowledgeGraph.snapshots || {};
    const chapters = knowledgeGraph.chapters || {};

    // ⚠️ 장면 정렬: chapterNumber 먼저, 같은 장 내에서 order 사용
    const sortedScenes = Object.values(snapshots)
      .sort((a: any, b: any) => {
        const chapterA = a.chapterNumber || 0;
        const chapterB = b.chapterNumber || 0;
        if (chapterA !== chapterB) return chapterA - chapterB;
        return (a.order || 0) - (b.order || 0);
      });

    return sortedScenes.map((scene: any) => {
      const sceneId = scene.sceneId;
      const sceneNum = parseInt(sceneId.replace('S', '').replace(/^0+/, '') || '0');

      // 이 장면의 관계들
      const edges = Object.values(knowledgeGraph.hyperedges)
        .filter((edge: any) => edge.scenes?.includes(sceneId)) as HyperEdge[];

      // 관련 엔티티들
      const entityIds = new Set<string>();
      edges.forEach((e) => e.entities.forEach((id) => entityIds.add(id)));
      // 장면에 등장하는 캐릭터도 추가
      (scene.charactersPresent || []).forEach((id: string) => entityIds.add(id));

      const entities = Array.from(entityIds)
        .map((id) => knowledgeGraph.entities[id])
        .filter(Boolean);

      // 챕터 정보 - scene.chapter가 "C0001" 형식 또는 숫자일 수 있음
      let chapterInfo = null;
      if (scene.chapter) {
        // scene.chapter가 이미 "C0001" 형식이면 그대로 사용
        if (typeof scene.chapter === 'string' && scene.chapter.startsWith('C')) {
          chapterInfo = chapters[scene.chapter];
        } else {
          // 숫자면 "C0001" 형식으로 변환
          const chapterId = `C${String(scene.chapter).padStart(4, '0')}`;
          chapterInfo = chapters[chapterId];
        }
      }
      // chapterNumber로도 시도
      if (!chapterInfo && scene.chapterNumber) {
        const chapterId = `C${String(scene.chapterNumber).padStart(4, '0')}`;
        chapterInfo = chapters[chapterId];
      }

      return {
        id: sceneId,
        sceneId,
        sceneNum,
        time: scene.time || `장면 ${sceneNum}`,
        // 새 필드(timeMarker) 우선, 기존 데이터 호환(timeElapsed)
        timeMarker: scene.timeMarker || scene.timeElapsed,
        location: scene.location,
        summary: scene.summary,
        chapter: scene.chapterNumber || (chapterInfo?.number),
        chapterTitle: chapterInfo?.title,
        edges,
        entities,
      } as TimelineEvent;
    });
  }, [knowledgeGraph]);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedEvents);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedEvents(newExpanded);
  };

  if (!knowledgeGraph) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center text-gray-400">
          <Clock className="w-16 h-16 mx-auto mb-3 opacity-30" aria-hidden="true" />
          <p>데이터를 불러와주세요</p>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center text-gray-400">
          <Clock className="w-16 h-16 mx-auto mb-3 opacity-30" aria-hidden="true" />
          <p>타임라인 정보가 없습니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden flex flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* 헤더 */}
      <div className="flex-shrink-0 px-6 py-4 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-200">
              <Clock className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">스토리 타임라인</h2>
              <p className="text-xs text-gray-500">{events.length}개의 장면</p>
            </div>
          </div>

          {/* 통계 */}
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">
                {Object.keys(knowledgeGraph.hyperedges).length}
              </div>
              <div className="text-[10px] text-gray-400">관계</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">
                {Object.values(knowledgeGraph.entities).filter(e => e.category === 'character').length}
              </div>
              <div className="text-[10px] text-gray-400">인물</div>
            </div>
          </div>
        </div>
      </div>

      {/* 타임라인 본문 */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <div className="relative">
            {/* 메인 타임라인 선 */}
            <div className="absolute left-6 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-300 via-indigo-300 to-purple-300 rounded-full" />

            {/* 이벤트 목록 */}
            <div className="space-y-4">
              {events.map((event, eventIndex) => {
                const isExpanded = expandedEvents.has(event.id);
                const characters = event.entities.filter(e => e.category === 'character');
                const mainSentiment = event.edges[0]?.sentiment || 'neutral';
                const style = SENTIMENT_STYLES[mainSentiment];

                // 시간 마커 표시 (텍스트에 명시된 시간 표현 우선, 없으면 시간 변화 비교)
                const prevEvent = eventIndex > 0 ? events[eventIndex - 1] : null;
                const timeMarkerText = event.timeMarker ||
                  (prevEvent && event.time && prevEvent.time && event.time !== prevEvent.time
                    ? `${prevEvent.time} → ${event.time}`
                    : null);

                return (
                  <div key={event.id}>
                    {/* 시간 마커 표시 (장면 사이) */}
                    {timeMarkerText && eventIndex > 0 && (
                      <div className="relative pl-16 mb-4">
                        {/* 점선 연결 */}
                        <div className="absolute left-[1.4rem] top-0 bottom-0 w-0 border-l-2 border-dashed border-amber-400" />

                        {/* 시간 마커 라벨 */}
                        <div className="py-3 px-5 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-dashed border-amber-300 rounded-xl shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                              <span className="text-lg">⏱</span>
                            </div>
                            <div>
                              <div className="text-xs text-amber-600 font-medium">시간 표시</div>
                              <div className="text-sm text-amber-800 font-bold">
                                {timeMarkerText}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="relative pl-16">
                      {/* 타임라인 노드 */}
                      <div
                        className="absolute left-4 w-5 h-5 rounded-full border-4 border-white shadow-lg z-10"
                        style={{
                          background: `linear-gradient(135deg, ${style.accent}, ${style.accent}dd)`,
                          top: '1.25rem'
                        }}
                      />

                      {/* 연결선 */}
                      <div
                        className="absolute left-[1.65rem] w-8 h-0.5 top-[1.5rem]"
                        style={{ background: style.accent + '40' }}
                      />

                    {/* 이벤트 카드 */}
                    <div
                      className={`bg-gradient-to-r ${style.bg} rounded-2xl border ${style.border} overflow-hidden shadow-sm hover:shadow-md transition-all duration-300`}
                    >
                      {/* 카드 헤더 */}
                      <button
                        onClick={() => toggleExpand(event.id)}
                        className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/30 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col items-start">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-blue-500 text-white text-xs font-bold rounded">
                                장면 {event.sceneNum}
                              </span>
                              <span className="text-base font-bold text-gray-800">
                                {event.time}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {event.chapter && (
                                <span className="text-xs text-gray-500">
                                  {event.chapterTitle || `제 ${event.chapter}장`}
                                </span>
                              )}
                              {event.location && (
                                <span className="text-xs text-green-600">
                                  📍 {event.location}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* 관계 타입 뱃지들 */}
                          <div className="flex gap-1.5 flex-wrap">
                            {[...new Set(event.edges.map(e => e.type))].slice(0, 3).map(type => {
                              const config = RELATION_CONFIG[type] || { label: type, color: '#64748b' };
                              return (
                                <span
                                  key={type}
                                  className="px-2 py-0.5 rounded-full text-[10px] font-medium text-white shadow-sm"
                                  style={{ backgroundColor: config.color }}
                                >
                                  {config.label}
                                </span>
                              );
                            })}
                            {[...new Set(event.edges.map(e => e.type))].length > 3 && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-400 text-white">
                                +{[...new Set(event.edges.map(e => e.type))].length - 3}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* 인물 아바타 */}
                          <div className="flex -space-x-2">
                            {characters.slice(0, 4).map((char) => (
                              <div
                                key={char.id}
                                className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                                title={char.name}
                              >
                                {char.name[0]}
                              </div>
                            ))}
                            {characters.length > 4 && (
                              <div className="w-7 h-7 rounded-full bg-gray-300 border-2 border-white flex items-center justify-center text-[10px] font-medium text-gray-600">
                                +{characters.length - 4}
                              </div>
                            )}
                          </div>

                          {/* 확장 버튼 */}
                          <div className="flex items-center gap-2 text-gray-400">
                            <span className="text-xs">{event.edges.length}개</span>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="w-4 h-4" aria-hidden="true" />
                            )}
                          </div>
                        </div>
                      </button>

                      {/* 확장된 내용 */}
                      {isExpanded && (
                        <div className="px-5 pb-4 space-y-3 border-t border-white/50">
                          {/* 장면 요약 */}
                          {event.summary && (
                            <div className="mt-3 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                              <p className="text-sm text-gray-700 leading-relaxed">
                                📖 {event.summary}
                              </p>
                            </div>
                          )}

                          {event.edges.length === 0 ? (
                            <div className="mt-3 py-6 text-center text-gray-400 text-sm">
                              이 장면에 추출된 관계가 없습니다
                            </div>
                          ) : event.edges.map((edge) => {
                            const config = RELATION_CONFIG[edge.type] || { label: edge.type, icon: MessageCircle, color: '#64748b' };
                            const Icon = config.icon;

                            return (
                              <div
                                key={edge.id}
                                className="mt-3 p-4 bg-white/60 backdrop-blur rounded-xl border border-white/80 shadow-sm"
                              >
                                <div className="flex items-start gap-3">
                                  {/* 아이콘 */}
                                  <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                    style={{ backgroundColor: config.color + '20' }}
                                  >
                                    <Icon className="w-4 h-4" style={{ color: config.color }} aria-hidden="true" />
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    {/* 관계 정보 */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span
                                        className="px-2 py-0.5 rounded-md text-xs font-medium text-white"
                                        style={{ backgroundColor: config.color }}
                                      >
                                        {config.label}
                                      </span>
                                      {edge.strength && (
                                        <div className="flex items-center gap-1">
                                          <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                            <div
                                              className="h-full rounded-full"
                                              style={{
                                                width: `${edge.strength * 10}%`,
                                                backgroundColor: config.color
                                              }}
                                            />
                                          </div>
                                          <span className="text-[10px] text-gray-400">{edge.strength}/10</span>
                                        </div>
                                      )}
                                    </div>

                                    {/* 설명 */}
                                    <p className="mt-2 text-sm text-gray-700 leading-relaxed">
                                      {edge.statement}
                                    </p>

                                    {/* 관련 엔티티 */}
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                      {edge.entities.map((entityId) => {
                                        const entity = knowledgeGraph.entities[entityId];
                                        if (!entity) return null;
                                        const isChar = entity.category === 'character';
                                        return (
                                          <button
                                            key={entityId}
                                            onClick={() => selectEntity(entityId)}
                                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                                              selectedEntityId === entityId
                                                ? 'bg-blue-500 text-white shadow-md scale-105'
                                                : isChar
                                                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                          >
                                            {entity.name}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    </div>
                  </div>
                );
              })}
              {events.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  장면 데이터가 없습니다
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
