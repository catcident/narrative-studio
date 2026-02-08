/**
 * 지식 그래프 조회 헬퍼 함수
 * 컴포넌트 전반에서 반복되는 entity/edge 필터링, 장면 정렬 패턴을 중앙화
 */

import type { Entity, HyperEdge, SceneSnapshot, EntityCategory } from '../types';

// ─── 내부 헬퍼: Record | Array 양쪽 지원 ───

function toArray<T>(input: Record<string, T> | T[]): T[] {
  return Array.isArray(input) ? input : Object.values(input);
}

// ─── 엔티티 필터 ───

/** 카테고리별 엔티티 필터링 */
export function getEntitiesByCategory<T extends Entity>(
  entities: Record<string, T> | T[],
  category: EntityCategory,
): T[] {
  return toArray(entities).filter(e => e.category === category);
}

/** 캐릭터 엔티티만 반환 */
export function getCharacters<T extends Entity>(entities: Record<string, T> | T[]): T[] {
  return getEntitiesByCategory(entities, 'character');
}

// ─── 엣지 필터 ───

/** 특정 장면에 등장하는 엣지 필터링 */
export function getEdgesByScene(
  edges: Record<string, HyperEdge> | HyperEdge[],
  sceneId: string,
): HyperEdge[] {
  return toArray(edges).filter(e => e.scenes?.includes(sceneId));
}

/** 특정 엔티티가 포함된 엣지 필터링 */
export function getEdgesByEntity(
  edges: Record<string, HyperEdge> | HyperEdge[],
  entityId: string,
): HyperEdge[] {
  return toArray(edges).filter(e => e.entities.includes(entityId));
}

// ─── 장면 정렬 ───

/** 장면 배열을 order 기준 정렬 (새 배열 반환) */
export function sortScenesByOrder(scenes: SceneSnapshot[]): SceneSnapshot[] {
  return [...scenes].sort((a, b) => (a.order || 0) - (b.order || 0));
}

/** Record<string, SceneSnapshot>에서 정렬된 배열 반환 */
export function getSortedScenes(snapshots: Record<string, SceneSnapshot>): SceneSnapshot[] {
  return sortScenesByOrder(Object.values(snapshots));
}
