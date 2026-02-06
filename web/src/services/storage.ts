/**
 * 지식 그래프 데이터 저장소 관리
 * - 서버 API를 통해 MongoDB에 저장
 */

import type { NovelKnowledgeGraph } from '../types';

const API_BASE = '/api';

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
  model?: string;  // 분석에 사용된 모델
}

/**
 * 저장된 모든 지식 그래프 목록 가져오기
 */
export async function getSavedKnowledgeGraphList(): Promise<SavedKnowledgeGraphMeta[]> {
  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs`);
    if (!response.ok) throw new Error('API 응답 오류');

    return await response.json();
  } catch (err: unknown) {
    console.error('[storage] 서버 목록 조회 실패:', err);
    return [];
  }
}

/**
 * 특정 지식 그래프 불러오기
 */
export async function loadKnowledgeGraph(id: string): Promise<NovelKnowledgeGraph | null> {
  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${id}`);
    if (!response.ok) throw new Error('API 응답 오류');

    return await response.json();
  } catch (err: unknown) {
    console.error('[storage] 서버 로드 실패:', err);
    return null;
  }
}

/**
 * 지식 그래프 저장
 * @param existingId - 기존 데이터의 ID (업데이트 시)
 */
export async function saveKnowledgeGraph(
  knowledgeGraph: NovelKnowledgeGraph,
  novelId?: string,
  existingId?: string
): Promise<SavedKnowledgeGraphMeta> {
  const response = await fetch(`${API_BASE}/knowledge-graphs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      knowledgeGraph,
      novelId: novelId || null,
      existingId: existingId || null,
    }),
  });

  if (!response.ok) throw new Error('API 응답 오류');

  return await response.json();
}

/**
 * 소설 원본 텍스트 저장
 */
export async function saveNovelText(
  title: string,
  text: string,
  knowledgeGraphId?: string,
): Promise<{ id: string; title: string }> {
  const response = await fetch(`${API_BASE}/novels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      text,
      knowledgeGraphId: knowledgeGraphId || null,
    }),
  });

  if (!response.ok) throw new Error('소설 저장 실패');
  return await response.json();
}

/**
 * 소설 원본 텍스트 불러오기
 */
export async function loadNovelText(id: string): Promise<{ title: string; text: string } | null> {
  try {
    const response = await fetch(`${API_BASE}/novels/${id}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err: unknown) {
    console.error('[storage] 소설 로드 실패:', err);
    return null;
  }
}

/**
 * 소설 목록 조회
 */
export async function getNovelList(): Promise<Array<{
  id: string;
  title: string;
  textLength: number;
  savedAt: string;
  knowledgeGraphId?: string;
}>> {
  try {
    const response = await fetch(`${API_BASE}/novels`);
    if (!response.ok) return [];
    return await response.json();
  } catch (err: unknown) {
    console.error('[storage] 소설 목록 조회 실패:', err);
    return [];
  }
}

/**
 * 지식 그래프 부분 업데이트 (PUT)
 */
export async function updateKnowledgeGraph(
  id: string,
  knowledgeGraph: NovelKnowledgeGraph
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ knowledgeGraph }),
    });

    if (!response.ok) throw new Error('API 응답 오류');

    const result = await response.json();
    return result.success;
  } catch (err: unknown) {
    console.error('[storage] 서버 업데이트 실패:', err);
    return false;
  }
}

/**
 * 지식 그래프 삭제
 */
export async function deleteKnowledgeGraph(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) throw new Error('API 응답 오류');

    const result = await response.json();
    return result.success;
  } catch (err: unknown) {
    console.error('[storage] 서버 삭제 실패:', err);
    return false;
  }
}

/**
 * 버전 히스토리 가져오기
 */
export async function getVersionHistory(dataId: string): Promise<Omit<KnowledgeGraphVersion, 'data'>[]> {
  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${dataId}/versions`);
    if (!response.ok) throw new Error('API 응답 오류');

    return await response.json();
  } catch (err: unknown) {
    console.error('[storage] 버전 히스토리 조회 실패:', err);
    return [];
  }
}

/**
 * 특정 버전 복원
 */
export async function restoreVersion(dataId: string, version: number): Promise<NovelKnowledgeGraph | null> {
  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${dataId}/restore/${version}`, {
      method: 'POST',
    });

    if (!response.ok) throw new Error('API 응답 오류');

    return await response.json();
  } catch (err: unknown) {
    console.error('[storage] 버전 복원 실패:', err);
    return null;
  }
}

/**
 * 지식 그래프 내보내기 (JSON 파일로 다운로드)
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

  if (!data.metadata || !data.entities || !data.hyperedges) {
    throw new Error('유효하지 않은 데이터 파일입니다.');
  }

  return data;
}
