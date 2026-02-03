/**
 * 지식 그래프 데이터 로컬 저장소 관리
 * localStorage를 사용해 분석 결과를 저장/관리
 */

import type { NovelKnowledgeGraph } from '../types';

const STORAGE_KEY = 'character-relationship-data';
const VERSION_KEY = 'character-relationship-versions';

export interface SavedKnowledgeGraph {
  id: string;
  title: string;
  savedAt: string;
  updatedAt: string;
  version: number;
  data: NovelKnowledgeGraph;
  // 메타데이터
  entityCount: number;
  edgeCount: number;
  sceneCount: number;
}

export interface KnowledgeGraphVersion {
  version: number;
  savedAt: string;
  note?: string;
  data: NovelKnowledgeGraph;
}

export interface SavedKnowledgeGraphMeta {
  id: string;
  title: string;
  savedAt: string;
  updatedAt: string;
  version: number;
  entityCount: number;
  edgeCount: number;
  sceneCount: number;
}

/**
 * 저장된 모든 지식 그래프 목록 가져오기 (메타데이터만)
 */
export function getSavedKnowledgeGraphList(): SavedKnowledgeGraphMeta[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];

    const items: SavedKnowledgeGraph[] = JSON.parse(data);
    return items.map(o => ({
      id: o.id,
      title: o.title,
      savedAt: o.savedAt,
      updatedAt: o.updatedAt,
      version: o.version,
      entityCount: o.entityCount,
      edgeCount: o.edgeCount,
      sceneCount: o.sceneCount,
    }));
  } catch (err) {
    console.error('저장된 데이터 목록 로드 실패:', err);
    return [];
  }
}

/**
 * 특정 지식 그래프 불러오기
 */
export function loadKnowledgeGraph(id: string): NovelKnowledgeGraph | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;

    const items: SavedKnowledgeGraph[] = JSON.parse(data);
    const found = items.find(o => o.id === id);
    return found?.data || null;
  } catch (err) {
    console.error('데이터 로드 실패:', err);
    return null;
  }
}

/**
 * 지식 그래프 저장 (신규 또는 업데이트)
 * 같은 제목이 있으면 업데이트, 없으면 신규 생성
 */
export function saveKnowledgeGraph(knowledgeGraph: NovelKnowledgeGraph, options?: {
  forceNew?: boolean;
  versionNote?: string;
}): SavedKnowledgeGraphMeta {
  const data = localStorage.getItem(STORAGE_KEY);
  const items: SavedKnowledgeGraph[] = data ? JSON.parse(data) : [];

  const now = new Date().toISOString();
  const title = knowledgeGraph.metadata.title;

  // 기존 데이터 찾기 (제목으로)
  const existingIndex = options?.forceNew
    ? -1
    : items.findIndex(o => o.title === title);

  const entityCount = Object.keys(knowledgeGraph.entities).length;
  const edgeCount = Object.keys(knowledgeGraph.hyperedges).length;
  const sceneCount = Object.keys(knowledgeGraph.snapshots || {}).length;

  if (existingIndex >= 0) {
    // 기존 데이터 업데이트
    const existing = items[existingIndex];

    // 버전 히스토리 저장
    saveVersion(existing.id, existing.version, existing.data, options?.versionNote);

    existing.updatedAt = now;
    existing.version += 1;
    existing.data = knowledgeGraph;
    existing.entityCount = entityCount;
    existing.edgeCount = edgeCount;
    existing.sceneCount = sceneCount;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));

    return {
      id: existing.id,
      title: existing.title,
      savedAt: existing.savedAt,
      updatedAt: existing.updatedAt,
      version: existing.version,
      entityCount,
      edgeCount,
      sceneCount,
    };
  } else {
    // 신규 생성
    const newItem: SavedKnowledgeGraph = {
      id: `kg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      title,
      savedAt: now,
      updatedAt: now,
      version: 1,
      data: knowledgeGraph,
      entityCount,
      edgeCount,
      sceneCount,
    };

    items.push(newItem);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));

    return {
      id: newItem.id,
      title: newItem.title,
      savedAt: newItem.savedAt,
      updatedAt: newItem.updatedAt,
      version: newItem.version,
      entityCount,
      edgeCount,
      sceneCount,
    };
  }
}

/**
 * 지식 그래프 삭제
 */
export function deleteKnowledgeGraph(id: string): boolean {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return false;

    const items: SavedKnowledgeGraph[] = JSON.parse(data);
    const filtered = items.filter(o => o.id !== id);

    if (filtered.length === items.length) return false;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));

    // 버전 히스토리도 삭제
    deleteVersionHistory(id);

    return true;
  } catch (err) {
    console.error('데이터 삭제 실패:', err);
    return false;
  }
}

/**
 * 버전 히스토리 저장
 */
function saveVersion(dataId: string, version: number, data: NovelKnowledgeGraph, note?: string): void {
  try {
    const stored = localStorage.getItem(VERSION_KEY);
    const allVersions: Record<string, KnowledgeGraphVersion[]> = stored ? JSON.parse(stored) : {};

    if (!allVersions[dataId]) {
      allVersions[dataId] = [];
    }

    // 최대 10개 버전만 유지
    if (allVersions[dataId].length >= 10) {
      allVersions[dataId].shift();
    }

    allVersions[dataId].push({
      version,
      savedAt: new Date().toISOString(),
      note,
      data,
    });

    localStorage.setItem(VERSION_KEY, JSON.stringify(allVersions));
  } catch (err) {
    console.error('버전 저장 실패:', err);
  }
}

/**
 * 버전 히스토리 가져오기
 */
export function getVersionHistory(dataId: string): Omit<KnowledgeGraphVersion, 'data'>[] {
  try {
    const stored = localStorage.getItem(VERSION_KEY);
    if (!stored) return [];

    const allVersions: Record<string, KnowledgeGraphVersion[]> = JSON.parse(stored);
    const versions = allVersions[dataId] || [];

    return versions.map(v => ({
      version: v.version,
      savedAt: v.savedAt,
      note: v.note,
    }));
  } catch (err) {
    console.error('버전 히스토리 로드 실패:', err);
    return [];
  }
}

/**
 * 특정 버전 복원
 */
export function restoreVersion(dataId: string, version: number): NovelKnowledgeGraph | null {
  try {
    const stored = localStorage.getItem(VERSION_KEY);
    if (!stored) return null;

    const allVersions: Record<string, KnowledgeGraphVersion[]> = JSON.parse(stored);
    const versions = allVersions[dataId] || [];

    const found = versions.find(v => v.version === version);
    return found?.data || null;
  } catch (err) {
    console.error('버전 복원 실패:', err);
    return null;
  }
}

/**
 * 버전 히스토리 삭제
 */
function deleteVersionHistory(dataId: string): void {
  try {
    const stored = localStorage.getItem(VERSION_KEY);
    if (!stored) return;

    const allVersions: Record<string, KnowledgeGraphVersion[]> = JSON.parse(stored);
    delete allVersions[dataId];

    localStorage.setItem(VERSION_KEY, JSON.stringify(allVersions));
  } catch (err) {
    console.error('버전 히스토리 삭제 실패:', err);
  }
}

/**
 * 지식 그래프 내보내기 (JSON 파일로)
 */
export function exportKnowledgeGraph(data: NovelKnowledgeGraph): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.metadata.title}_knowledge_graph.json`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * 지식 그래프 가져오기 (JSON 파일에서)
 */
export async function importKnowledgeGraph(file: File): Promise<NovelKnowledgeGraph> {
  const text = await file.text();
  const data = JSON.parse(text) as NovelKnowledgeGraph;

  // 기본 검증
  if (!data.metadata || !data.entities || !data.hyperedges) {
    throw new Error('유효하지 않은 데이터 파일입니다.');
  }

  return data;
}

/**
 * 저장소 전체 초기화 (주의!)
 */
export function clearAllStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(VERSION_KEY);
}
