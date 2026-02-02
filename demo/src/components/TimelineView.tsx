/**
 * 타임라인 뷰 컴포넌트
 * 시간순으로 관계 변화를 보여줌
 */

import { useMemo } from 'react';
import { Clock, Users, ArrowRight } from 'lucide-react';
import { useStore } from '../store';
import type { HyperEdge, Entity } from '../types';

// 관계 유형 한글
const RELATION_LABELS: Record<string, string> = {
  family: '가족',
  romantic: '연인',
  friendship: '친구',
  rivalry: '적대',
  mentor: '스승-제자',
  subordinate: '상하관계',
  belongs_to: '소속',
  owns: '소유',
  rules: '지배',
  located_at: '위치',
  occurred_at: '발생',
  during: '기간',
  participates: '참여',
  causes: '야기',
  transforms: '변화',
  knows: '인지',
  has_status: '상태',
  related_to: '관련',
};

const SENTIMENT_COLORS = {
  positive: 'bg-green-100 border-green-300 text-green-800',
  negative: 'bg-red-100 border-red-300 text-red-800',
  neutral: 'bg-gray-100 border-gray-300 text-gray-800',
  complex: 'bg-purple-100 border-purple-300 text-purple-800',
};

interface TimelineEvent {
  id: string;
  time: string;
  chapter?: number;
  edges: HyperEdge[];
  entities: Entity[];
}

export function TimelineView() {
  const { ontology, selectEntity, selectedEntityId } = useStore();

  // 시간순 이벤트 그룹화
  const events = useMemo(() => {
    if (!ontology) return [];

    const timeGroups: Record<string, HyperEdge[]> = {};

    Object.values(ontology.hyperedges).forEach((edge) => {
      const time = edge.timeline?.start || '시점 미상';
      if (!timeGroups[time]) timeGroups[time] = [];
      timeGroups[time].push(edge);
    });

    // 시간 순서 정렬 (간단한 휴리스틱)
    const sortedTimes = Object.keys(timeGroups).sort((a, b) => {
      // 숫자가 있으면 그것으로 정렬
      const numA = parseInt(a.match(/\d+/)?.[0] || '9999');
      const numB = parseInt(b.match(/\d+/)?.[0] || '9999');
      if (numA !== numB) return numA - numB;
      // "과거", "현재" 같은 키워드
      if (a.includes('과거')) return -1;
      if (b.includes('과거')) return 1;
      if (a.includes('현재')) return 1;
      if (b.includes('현재')) return -1;
      return a.localeCompare(b);
    });

    return sortedTimes.map((time) => {
      const edges = timeGroups[time];
      const entityIds = new Set<string>();
      edges.forEach((e) => e.entities.forEach((id) => entityIds.add(id)));

      const entities = Array.from(entityIds)
        .map((id) => ontology.entities[id])
        .filter(Boolean);

      return {
        id: time,
        time,
        chapter: edges[0]?.timeline?.chapter,
        edges,
        entities,
      } as TimelineEvent;
    });
  }, [ontology]);

  if (!ontology) return null;

  return (
    <div className="h-full overflow-y-auto p-6 bg-gray-50">
      <h2 className="text-lg font-semibold text-gray-800 mb-6 flex items-center gap-2">
        <Clock className="w-5 h-5" />
        타임라인
      </h2>

      <div className="relative">
        {/* 타임라인 선 */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-300" />

        {/* 이벤트 목록 */}
        <div className="space-y-6">
          {events.map((event, index) => (
            <div key={event.id} className="relative pl-12">
              {/* 타임라인 포인트 */}
              <div className="absolute left-2 w-5 h-5 bg-blue-500 rounded-full border-4 border-white shadow" />

              {/* 이벤트 카드 */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {/* 헤더 */}
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">{event.time}</span>
                    {event.chapter && (
                      <span className="text-xs text-gray-500">
                        Chapter {event.chapter}
                      </span>
                    )}
                  </div>
                </div>

                {/* 관계 목록 */}
                <div className="p-4 space-y-3">
                  {event.edges.map((edge) => (
                    <div
                      key={edge.id}
                      className={`p-3 rounded-lg border ${
                        SENTIMENT_COLORS[edge.sentiment || 'neutral']
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-xs font-medium px-2 py-0.5 bg-white/50 rounded">
                          {RELATION_LABELS[edge.type] || edge.type}
                        </span>
                        {edge.strength && (
                          <span className="text-xs text-gray-500">
                            강도: {edge.strength}/10
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm">{edge.statement}</p>

                      {/* 관련 엔티티 */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {edge.entities.map((entityId) => {
                          const entity = ontology.entities[entityId];
                          if (!entity) return null;
                          return (
                            <button
                              key={entityId}
                              onClick={() => selectEntity(entityId)}
                              className={`text-xs px-2 py-0.5 rounded-full transition-colors
                                ${selectedEntityId === entityId
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-white/70 hover:bg-white text-gray-700'
                                }
                              `}
                            >
                              {entity.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 등장 인물 요약 */}
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Users className="w-3 h-3" />
                    <span>
                      {event.entities
                        .filter((e) => e.category === 'character')
                        .map((e) => e.name)
                        .join(', ') || '등장인물 없음'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 화살표 (마지막 제외) */}
              {index < events.length - 1 && (
                <div className="absolute left-3.5 -bottom-3 text-gray-400">
                  <ArrowRight className="w-4 h-4 rotate-90" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
