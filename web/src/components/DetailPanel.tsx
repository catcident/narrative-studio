/**
 * 상세 정보 패널 (개선된 버전)
 * 선택한 엔티티의 상세 정보 + 관계의 방향/시점 표시
 */

import { useState } from 'react';
import { X, User, MapPin, Building, Sword, Clock, Zap, Info, ArrowRight, Heart, Swords, Users, Film } from 'lucide-react';
import { AiGeneratedBadge } from './AiGeneratedBadge';
import { useStore, useSelectedEntity, useEntityEdges } from '../store';
import type { EntityCategory, HyperEdge, Entity } from '../types';
import { CATEGORY_LABELS, CATEGORY_BG_CLASSES, RELATION_LABELS } from '../constants';
import { getEdgesByScene } from '../services/knowledgeGraphQueries';

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

// 속성 라벨 한글화
const ATTR_LABELS: Record<string, string> = {
  gender: '성별',
  age: '나이',
  occupation: '직업',
  affiliation: '소속',
  appearance: '외모',
  personality: '성격',
  abilities: '능력',
  current_location: '현재 위치',
  current_status: '현재 상태',
  knowledge: '알고 있는 정보',
  goals: '목표',
  backstory: '과거사',
  type: '유형',
  parent_location: '상위 장소',
  features: '특징',
  residents: '거주자',
  leader: '리더',
  members: '구성원',
  purpose: '목적',
  location: '위치',
  time: '시점',
  participants: '참여자',
  cause: '원인',
  outcome: '결과',
};


export function DetailPanel() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const selectEntity = useStore((s) => s.selectEntity);
  const selectedSceneId = useStore((s) => s.selectedSceneId);
  const entity = useSelectedEntity();
  const allEdges = useEntityEdges(entity?.id || null);
  const [expandedEdgeId, setExpandedEdgeId] = useState<string | null>(null);

  // 현재 장면 정보
  const currentScene = selectedSceneId && knowledgeGraph?.snapshots ? knowledgeGraph.snapshots[selectedSceneId] : null;
  // ⚠️ 정렬: chapterNumber 먼저, 같은 장 내에서 order 사용
  const sceneIndex = selectedSceneId && knowledgeGraph?.snapshots
    ? Object.values(knowledgeGraph.snapshots)
        .sort((a, b) => {
          const chapterA = a.chapterNumber || 0;
          const chapterB = b.chapterNumber || 0;
          if (chapterA !== chapterB) return chapterA - chapterB;
          return (a.order || 0) - (b.order || 0);
        })
        .findIndex(s => s.sceneId === selectedSceneId) + 1
    : 0;

  // 현재 장면에서의 관계만 필터링
  const edges = selectedSceneId
    ? getEdgesByScene(allEdges, selectedSceneId)
    : allEdges;

  // 현재 장면에서의 엔티티 정보 (sceneData에서 가져오기)
  const getSceneEntityInfo = (entity: Entity): string | null => {
    if (!currentScene || !entity) return null;
    // sceneData에 엔티티별 정보가 있다면 반환
    const sceneData = currentScene as any;
    if (sceneData.entityStates && sceneData.entityStates[entity.id]) {
      return sceneData.entityStates[entity.id];
    }
    // summary에서 엔티티 이름이 포함된 문장 추출
    if (currentScene.summary && entity.name) {
      const sentences = currentScene.summary.split(/[.!?]/).filter((s: string) => s.trim());
      const relevant = sentences.filter((s: string) => s.includes(entity.name));
      if (relevant.length > 0) {
        return relevant.join('. ').trim() + '.';
      }
    }
    return null;
  };

  if (!entity) {
    return (
      <div className="h-full flex items-center justify-center bg-white text-gray-400 p-6">
        <div className="text-center">
          <Info aria-hidden="true" className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">그래프에서 노드를 선택하세요</p>
        </div>
      </div>
    );
  }

  const Icon = CATEGORY_ICONS[entity.category] || Info;
  const sceneEntityInfo = getSceneEntityInfo(entity);

  // 속성 렌더링 (배열은 콤마로 연결)
  const renderAttrValue = (value: unknown): string => {
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  };

  // 관계를 그룹화 (sentiment별)
  const positiveEdges = edges.filter(e => e.sentiment === 'positive');
  const negativeEdges = edges.filter(e => e.sentiment === 'negative');
  const otherEdges = edges.filter(e => e.sentiment !== 'positive' && e.sentiment !== 'negative');

  const renderEdge = (edge: HyperEdge) => {
    const otherEntityIds = edge.entities.filter((id) => id !== entity.id);
    const otherEntities = otherEntityIds
      .map((id) => knowledgeGraph?.entities[id])
      .filter(Boolean);

    // from/to 방향 확인
    const isFrom = edge.entities[0] === entity.id;
    const perspective = isFrom ? (edge as any).fromPerspective : (edge as any).toPerspective;
    const isExpanded = expandedEdgeId === edge.id;

    return (
      <div
        key={edge.id}
        className={`rounded-lg border transition-all duration-200 ${
          edge.sentiment === 'positive' ? 'bg-green-50 border-green-200' :
          edge.sentiment === 'negative' ? 'bg-red-50 border-red-200' :
          'bg-gray-50 border-gray-200'
        } ${isExpanded ? 'ring-2 ring-blue-300' : ''}`}
      >
        {/* 클릭 가능한 헤더 (요약) */}
        <button
          onClick={() => setExpandedEdgeId(isExpanded ? null : edge.id)}
          className="w-full p-3 text-left hover:bg-white/50 transition-colors rounded-lg"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                edge.sentiment === 'positive' ? 'bg-green-200 text-green-800' :
                edge.sentiment === 'negative' ? 'bg-red-200 text-red-800' :
                'bg-gray-200 text-gray-700'
              }`}>
                {RELATION_LABELS[edge.type] || edge.type}
              </span>
              <ArrowRight aria-hidden="true" className="w-3 h-3 text-gray-400" />
              {otherEntities.map((e) => (
                <span key={e!.id} className="text-sm font-medium text-gray-700">
                  {e!.name}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {edge.strength && (
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 h-2 rounded-sm ${
                        i < Math.ceil(edge.strength! / 2)
                          ? edge.sentiment === 'positive' ? 'bg-green-400' :
                            edge.sentiment === 'negative' ? 'bg-red-400' : 'bg-gray-400'
                          : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
              )}
              <span className={`text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
            </div>
          </div>

          {/* 설명 미리보기 (한 줄) */}
          {edge.statement && !isExpanded && (
            <p className="mt-1.5 text-xs text-gray-500 truncate">{edge.statement}</p>
          )}
        </button>

        {/* 펼쳐진 상세 내용 */}
        {isExpanded && (
          <div className="px-3 pb-3 border-t border-white/50">
            {/* 관계 설명 - 더 눈에 띄게 */}
            {edge.statement && (
              <div className="mt-3 p-3 bg-white rounded-lg border border-gray-100 shadow-sm">
                <p className="text-sm text-gray-800 leading-relaxed">{edge.statement}</p>
              </div>
            )}

            {/* 관계 대상 (클릭 가능) */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">관련:</span>
              {otherEntities.map((e) => (
                <button
                  key={e!.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    selectEntity(e!.id);
                  }}
                  className="text-sm font-medium px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  {e!.name}
                </button>
              ))}
            </div>

            {/* 시점에서의 관점 */}
            {perspective && (
              <div className="mt-3 p-2 bg-blue-50 rounded text-xs text-blue-700 italic">
                💭 "{perspective}"
              </div>
            )}

            {/* 등장 장면 정보 */}
            {edge.scenes && edge.scenes.length > 0 && knowledgeGraph?.snapshots && (
              <div className="mt-3">
                <div className="text-xs text-gray-400 mb-2">등장 장면 ({edge.scenes.length}개):</div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {[...edge.scenes]
                    .sort((a, b) => {
                      const snapshotA = knowledgeGraph.snapshots[a];
                      const snapshotB = knowledgeGraph.snapshots[b];
                      const chapterA = snapshotA?.chapterNumber || 0;
                      const chapterB = snapshotB?.chapterNumber || 0;
                      if (chapterA !== chapterB) return chapterA - chapterB;
                      return (snapshotA?.order || 0) - (snapshotB?.order || 0);
                    })
                    .map((sceneId) => {
                    const scene = knowledgeGraph.snapshots[sceneId];
                    const sceneIdx = scene?.order || 0;
                    if (!scene) return null;

                    return (
                      <div
                        key={sceneId}
                        className="p-2 bg-white rounded border border-gray-100 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-blue-600">장면 {sceneIdx}</span>
                          <div className="flex items-center gap-2 text-[10px] text-gray-400">
                            {scene.time && <span>{scene.time}</span>}
                            {scene.location && (
                              <span className="flex items-center gap-0.5">
                                <MapPin aria-hidden="true" className="w-2.5 h-2.5" />
                                {scene.location}
                              </span>
                            )}
                          </div>
                        </div>
                        {scene.summary && (
                          <p className="mt-1 text-[10px] text-gray-500 line-clamp-2">{scene.summary}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 시간 정보 */}
            {edge.timeline?.start && (
              <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                <Clock aria-hidden="true" className="w-3 h-3" />
                {edge.timeline.start}
              </div>
            )}

            {/* 양방향/강도 정보 */}
            <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
              {(edge as any).bidirectional && (
                <span className="px-2 py-0.5 bg-gray-100 rounded">쌍방향</span>
              )}
              {edge.strength && (
                <span>강도: {edge.strength}/10</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 헤더 */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl ${CATEGORY_BG_CLASSES[entity.category]} text-white`}>
              <Icon aria-hidden="true" className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-gray-800">{entity.name}</h2>
                <AiGeneratedBadge />
              </div>
              {entity.aliases && entity.aliases.length > 0 && (
                <p className="text-sm text-gray-500">
                  {entity.aliases.join(', ')}
                </p>
              )}
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded mt-1 inline-block">
                {CATEGORY_LABELS[entity.category]}
              </span>
            </div>
          </div>
          <button
            onClick={() => selectEntity(null)}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="닫기"
          >
            <X aria-hidden="true" className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      {/* 내용 - 스크롤 */}
      <div className="flex-1 overflow-y-auto">
        {/*
         * 설명(description) 필드는 UI에서 숨김 처리
         * - 파일 수정/삭제 시 동기화 문제로 인해 UI에서 제외
         * - 데이터는 유지됨 (채팅 기능에서 활용 예정)
         * - 이 필드 내용은 다른 곳에서 사용하지 말 것
         */}

        {/* 속성 */}
        {entity.attributes && Object.keys(entity.attributes).length > 0 && (
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">상세 정보</h3>
            <div className="space-y-2">
              {Object.entries(entity.attributes).map(([key, value]) => (
                <div key={key} className="flex">
                  <span className="text-xs text-gray-500 w-20 flex-shrink-0 pt-0.5">
                    {ATTR_LABELS[key] || key}
                  </span>
                  <span className="text-sm text-gray-800 flex-1">
                    {renderAttrValue(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 등장 장면 */}
        {entity.scenes && entity.scenes.length > 0 && knowledgeGraph?.snapshots && (
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              등장 장면 ({entity.scenes.length}개)
            </h3>

            {/* 첫 등장 */}
            {(() => {
              // order 필드 기준 정렬 (파일 순서 반영)
              const sortedScenes = [...entity.scenes].sort((a, b) => {
                const snapshotA = knowledgeGraph.snapshots[a];
                const snapshotB = knowledgeGraph.snapshots[b];
                return (snapshotA?.order || 0) - (snapshotB?.order || 0);
              });
              const firstSceneId = sortedScenes[0];
              const firstScene = knowledgeGraph.snapshots[firstSceneId];
              const firstSceneIndex = firstScene?.order || 0;

              return (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-amber-700 px-2 py-0.5 bg-amber-200 rounded">첫 등장</span>
                    <span className="text-sm font-medium text-amber-800">장면 {firstSceneIndex}</span>
                  </div>
                  {firstScene && (
                    <div className="mt-2 text-sm text-gray-700">
                      {firstScene.time && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                          <Clock aria-hidden="true" className="w-3 h-3" />
                          {firstScene.time}
                          {firstScene.location && <span> · {firstScene.location}</span>}
                        </div>
                      )}
                      {firstScene.summary && (
                        <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{firstScene.summary}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 모든 등장 장면 목록 */}
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {[...entity.scenes]
                .sort((a, b) => {
                  const snapshotA = knowledgeGraph.snapshots[a];
                  const snapshotB = knowledgeGraph.snapshots[b];
                  return (snapshotA?.order || 0) - (snapshotB?.order || 0);
                })
                .map((sceneId) => {
                const scene = knowledgeGraph.snapshots[sceneId];
                const sceneIdx = scene?.order || 0;
                if (!scene) return null;

                return (
                  <div
                    key={sceneId}
                    className="p-2 bg-gray-50 rounded-lg border border-gray-100 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700">장면 {sceneIdx}</span>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        {scene.time && <span>{scene.time}</span>}
                        {scene.location && (
                          <span className="flex items-center gap-0.5">
                            <MapPin aria-hidden="true" className="w-3 h-3" />
                            {scene.location}
                          </span>
                        )}
                      </div>
                    </div>
                    {scene.summary && (
                      <p className="mt-1 text-xs text-gray-500 line-clamp-1">{scene.summary}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────── */}
        {/* 현재 장면에서의 정보 */}
        {selectedSceneId && currentScene && (
          <div className="p-4 border-b-4 border-blue-200 bg-gradient-to-b from-blue-50 to-white">
            <div className="flex items-center gap-2 mb-3">
              <Film aria-hidden="true" className="w-4 h-4 text-blue-500" />
              <h3 className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
                장면 {sceneIndex}에서의 {entity.name}
              </h3>
            </div>

            {/* 장면 정보 */}
            <div className="mb-3 p-2 bg-white rounded-lg border border-blue-100">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                {currentScene.time && <span>{currentScene.time}</span>}
                {currentScene.location && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <MapPin aria-hidden="true" className="w-3 h-3" />
                      {currentScene.location}
                    </span>
                  </>
                )}
              </div>
              {currentScene.mood && (
                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded">
                  {currentScene.mood}
                </span>
              )}
            </div>

            {/* 이 장면에서의 엔티티 상태/행동 */}
            {sceneEntityInfo ? (
              <div className="p-3 bg-white rounded-lg border border-blue-200">
                <p className="text-sm text-gray-800 leading-relaxed">{sceneEntityInfo}</p>
              </div>
            ) : currentScene.summary ? (
              <div className="p-3 bg-white rounded-lg border border-blue-200">
                <p className="text-xs text-gray-400 mb-1">장면 요약:</p>
                <p className="text-sm text-gray-700 leading-relaxed">{currentScene.summary}</p>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">이 장면에 대한 상세 정보가 없습니다</p>
            )}

            {/* 이 장면에서의 관계 수 */}
            {edges.length > 0 && (
              <div className="mt-3 text-xs text-blue-600">
                이 장면에서 {edges.length}개의 관계가 활성화됨
              </div>
            )}
          </div>
        )}

        {/* 관계 */}
        <div className="p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {selectedSceneId ? `이 장면의 관계 (${edges.length})` : `전체 관계 (${allEdges.length})`}
          </h3>

          {edges.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              연결된 관계가 없습니다
            </p>
          ) : (
            <div className="space-y-4">
              {/* 긍정적 관계 */}
              {positiveEdges.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Heart aria-hidden="true" className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-xs font-medium text-green-700">긍정적 관계</span>
                  </div>
                  <div className="space-y-2">
                    {positiveEdges.map(renderEdge)}
                  </div>
                </div>
              )}

              {/* 부정적 관계 */}
              {negativeEdges.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Swords aria-hidden="true" className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-xs font-medium text-red-700">부정적 관계</span>
                  </div>
                  <div className="space-y-2">
                    {negativeEdges.map(renderEdge)}
                  </div>
                </div>
              )}

              {/* 기타 관계 */}
              {otherEdges.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Users aria-hidden="true" className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs font-medium text-gray-700">기타 관계</span>
                  </div>
                  <div className="space-y-2">
                    {otherEdges.map(renderEdge)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
