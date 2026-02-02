/**
 * 온톨로지 데이터 로컬 저장소 관리
 * localStorage를 사용해 분석 결과를 저장/관리
 */

import type { NovelOntology } from '../types';

const STORAGE_KEY = 'character-relationship-ontologies';
const VERSION_KEY = 'character-relationship-versions';

export interface SavedOntology {
  id: string;
  title: string;
  savedAt: string;
  updatedAt: string;
  version: number;
  ontology: NovelOntology;
  // 메타데이터
  entityCount: number;
  edgeCount: number;
  sceneCount: number;
}

export interface OntologyVersion {
  version: number;
  savedAt: string;
  note?: string;
  ontology: NovelOntology;
}

export interface SavedOntologyMeta {
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
 * 저장된 모든 온톨로지 목록 가져오기 (메타데이터만)
 */
export function getSavedOntologyList(): SavedOntologyMeta[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];

    const ontologies: SavedOntology[] = JSON.parse(data);
    return ontologies.map(o => ({
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
    console.error('저장된 온톨로지 목록 로드 실패:', err);
    return [];
  }
}

/**
 * 특정 온톨로지 불러오기
 */
export function loadOntology(id: string): NovelOntology | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;

    const ontologies: SavedOntology[] = JSON.parse(data);
    const found = ontologies.find(o => o.id === id);
    return found?.ontology || null;
  } catch (err) {
    console.error('온톨로지 로드 실패:', err);
    return null;
  }
}

/**
 * 온톨로지 저장 (신규 또는 업데이트)
 * 같은 제목이 있으면 업데이트, 없으면 신규 생성
 */
export function saveOntology(ontology: NovelOntology, options?: {
  forceNew?: boolean;
  versionNote?: string;
}): SavedOntologyMeta {
  const data = localStorage.getItem(STORAGE_KEY);
  const ontologies: SavedOntology[] = data ? JSON.parse(data) : [];

  const now = new Date().toISOString();
  const title = ontology.metadata.title;

  // 기존 데이터 찾기 (제목으로)
  const existingIndex = options?.forceNew
    ? -1
    : ontologies.findIndex(o => o.title === title);

  const entityCount = Object.keys(ontology.entities).length;
  const edgeCount = Object.keys(ontology.hyperedges).length;
  const sceneCount = Object.keys(ontology.snapshots || {}).length;

  if (existingIndex >= 0) {
    // 기존 데이터 업데이트
    const existing = ontologies[existingIndex];

    // 버전 히스토리 저장
    saveVersion(existing.id, existing.version, existing.ontology, options?.versionNote);

    existing.updatedAt = now;
    existing.version += 1;
    existing.ontology = ontology;
    existing.entityCount = entityCount;
    existing.edgeCount = edgeCount;
    existing.sceneCount = sceneCount;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(ontologies));

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
    const newItem: SavedOntology = {
      id: `ont_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      title,
      savedAt: now,
      updatedAt: now,
      version: 1,
      ontology,
      entityCount,
      edgeCount,
      sceneCount,
    };

    ontologies.push(newItem);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ontologies));

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
 * 온톨로지 삭제
 */
export function deleteOntology(id: string): boolean {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return false;

    const ontologies: SavedOntology[] = JSON.parse(data);
    const filtered = ontologies.filter(o => o.id !== id);

    if (filtered.length === ontologies.length) return false;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));

    // 버전 히스토리도 삭제
    deleteVersionHistory(id);

    return true;
  } catch (err) {
    console.error('온톨로지 삭제 실패:', err);
    return false;
  }
}

/**
 * 버전 히스토리 저장
 */
function saveVersion(ontologyId: string, version: number, ontology: NovelOntology, note?: string): void {
  try {
    const data = localStorage.getItem(VERSION_KEY);
    const allVersions: Record<string, OntologyVersion[]> = data ? JSON.parse(data) : {};

    if (!allVersions[ontologyId]) {
      allVersions[ontologyId] = [];
    }

    // 최대 10개 버전만 유지
    if (allVersions[ontologyId].length >= 10) {
      allVersions[ontologyId].shift();
    }

    allVersions[ontologyId].push({
      version,
      savedAt: new Date().toISOString(),
      note,
      ontology,
    });

    localStorage.setItem(VERSION_KEY, JSON.stringify(allVersions));
  } catch (err) {
    console.error('버전 저장 실패:', err);
  }
}

/**
 * 버전 히스토리 가져오기
 */
export function getVersionHistory(ontologyId: string): Omit<OntologyVersion, 'ontology'>[] {
  try {
    const data = localStorage.getItem(VERSION_KEY);
    if (!data) return [];

    const allVersions: Record<string, OntologyVersion[]> = JSON.parse(data);
    const versions = allVersions[ontologyId] || [];

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
export function restoreVersion(ontologyId: string, version: number): NovelOntology | null {
  try {
    const data = localStorage.getItem(VERSION_KEY);
    if (!data) return null;

    const allVersions: Record<string, OntologyVersion[]> = JSON.parse(data);
    const versions = allVersions[ontologyId] || [];

    const found = versions.find(v => v.version === version);
    return found?.ontology || null;
  } catch (err) {
    console.error('버전 복원 실패:', err);
    return null;
  }
}

/**
 * 버전 히스토리 삭제
 */
function deleteVersionHistory(ontologyId: string): void {
  try {
    const data = localStorage.getItem(VERSION_KEY);
    if (!data) return;

    const allVersions: Record<string, OntologyVersion[]> = JSON.parse(data);
    delete allVersions[ontologyId];

    localStorage.setItem(VERSION_KEY, JSON.stringify(allVersions));
  } catch (err) {
    console.error('버전 히스토리 삭제 실패:', err);
  }
}

/**
 * 온톨로지 내보내기 (JSON 파일로)
 */
export function exportOntology(ontology: NovelOntology): void {
  const json = JSON.stringify(ontology, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${ontology.metadata.title}_ontology.json`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * 온톨로지 가져오기 (JSON 파일에서)
 */
export async function importOntology(file: File): Promise<NovelOntology> {
  const text = await file.text();
  const ontology = JSON.parse(text) as NovelOntology;

  // 기본 검증
  if (!ontology.metadata || !ontology.entities || !ontology.hyperedges) {
    throw new Error('유효하지 않은 온톨로지 파일입니다.');
  }

  return ontology;
}

/**
 * 저장소 전체 초기화 (주의!)
 */
export function clearAllStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(VERSION_KEY);
}
