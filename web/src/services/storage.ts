/**
 * 지식 그래프 데이터 저장소 관리
 * - 서버 API를 통해 MongoDB에 저장
 * - API 실패 시 로컬 IndexedDB 폴백
 */

import type { NovelKnowledgeGraph } from '../types';

// Next.js API 사용
const API_BASE = '/api';

export interface SavedKnowledgeGraph {
  id: string;
  title: string;
  savedAt: string;
  updatedAt: string;
  version: number;
  data: NovelKnowledgeGraph;
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
  model?: string;  // 분석에 사용된 모델
}

// ==================== 로컬 IndexedDB (폴백용) ====================

const DB_NAME = 'character-relationship-db';
const STORE_NAME = 'knowledgeGraphs';
const VERSION_STORE_NAME = 'versions';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(VERSION_STORE_NAME)) {
        const versionStore = db.createObjectStore(VERSION_STORE_NAME, { keyPath: ['dataId', 'version'] });
        versionStore.createIndex('dataId', 'dataId', { unique: false });
      }
    };
  });
}

async function getLocalList(): Promise<SavedKnowledgeGraphMeta[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const items: SavedKnowledgeGraph[] = request.result;
        resolve(items.map(o => ({
          id: o.id,
          title: o.title,
          savedAt: o.savedAt,
          updatedAt: o.updatedAt,
          version: o.version,
          entityCount: o.entityCount,
          edgeCount: o.edgeCount,
          sceneCount: o.sceneCount,
          model: o.data?.metadata?.model,  // 모델 정보 추가
        })).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      };
    });
  } catch (err) {
    console.error('[storage] 로컬 목록 로드 실패:', err);
    return [];
  }
}

async function loadLocal(id: string): Promise<NovelKnowledgeGraph | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const item: SavedKnowledgeGraph | undefined = request.result;
        resolve(item?.data || null);
      };
    });
  } catch (err) {
    console.error('[storage] 로컬 로드 실패:', err);
    return null;
  }
}

async function saveLocal(knowledgeGraph: NovelKnowledgeGraph, existingId?: string): Promise<SavedKnowledgeGraphMeta> {
  const dbConn = await openDB();
  const now = new Date().toISOString();
  const title = knowledgeGraph.metadata.title;

  const entityCount = Object.keys(knowledgeGraph.entities).length;
  const edgeCount = Object.keys(knowledgeGraph.hyperedges).length;
  const sceneCount = Object.keys(knowledgeGraph.snapshots || {}).length;

  // 기존 데이터 찾기 (ID가 제공되면 ID로, 아니면 첫 번째 제목 부분으로)
  let existing: SavedKnowledgeGraph | null = null;

  if (existingId) {
    // ID로 직접 찾기
    const tx = dbConn.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    existing = await new Promise<SavedKnowledgeGraph | null>((resolve, reject) => {
      const request = store.get(existingId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  // ID로 못 찾으면 제목의 첫 번째 부분으로 찾기 (기존 호환성)
  if (!existing) {
    const baseTitle = title.split(' + ')[0]; // "01화 + 02화" -> "01화"
    const allItems = await getLocalListFull();
    existing = allItems.find(o => {
      const existingBaseTitle = o.title.split(' + ')[0];
      return existingBaseTitle === baseTitle;
    }) || null;
  }

  if (existing) {
    // 이전 버전을 VERSION_STORE에 저장
    const versionTx = dbConn.transaction(VERSION_STORE_NAME, 'readwrite');
    const versionStore = versionTx.objectStore(VERSION_STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const versionItem = {
        dataId: existing!.id,
        version: existing!.version,
        savedAt: existing!.updatedAt,
        note: `v${existing!.version}: ${existing!.title}`,
        data: existing!.data,
      };
      const request = versionStore.put(versionItem);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    const updatedItem: SavedKnowledgeGraph = {
      id: existing.id,
      title,
      savedAt: existing.savedAt,
      updatedAt: now,
      version: existing.version + 1,
      data: knowledgeGraph,
      entityCount,
      edgeCount,
      sceneCount,
    };

    const tx = dbConn.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.put(updatedItem);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    console.log(`[storage] 기존 데이터 업데이트: ${existing.title} -> ${title} (v${updatedItem.version})`);

    return {
      id: updatedItem.id,
      title: updatedItem.title,
      savedAt: updatedItem.savedAt,
      updatedAt: updatedItem.updatedAt,
      version: updatedItem.version,
      entityCount,
      edgeCount,
      sceneCount,
    };
  } else {
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

    const tx = dbConn.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.add(newItem);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    console.log(`[storage] 새 데이터 저장: ${title} (v1)`);

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

// 전체 데이터 포함 목록 (내부용)
async function getLocalListFull(): Promise<SavedKnowledgeGraph[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const items: SavedKnowledgeGraph[] = request.result;
        resolve(items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      };
    });
  } catch (err) {
    console.error('[storage] 로컬 목록 로드 실패:', err);
    return [];
  }
}

async function updateLocal(id: string, knowledgeGraph: NovelKnowledgeGraph): Promise<boolean> {
  try {
    const dbConn = await openDB();
    const tx = dbConn.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // 기존 데이터 가져오기
    const existing = await new Promise<SavedKnowledgeGraph | undefined>((resolve, reject) => {
      const request = store.get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    if (!existing) {
      console.error('[storage] 로컬 업데이트 실패: 데이터 없음');
      return false;
    }

    const now = new Date().toISOString();
    const updatedItem: SavedKnowledgeGraph = {
      ...existing,
      title: knowledgeGraph.metadata.title,
      updatedAt: now,
      version: existing.version + 1,
      data: knowledgeGraph,
      entityCount: Object.keys(knowledgeGraph.entities).length,
      edgeCount: Object.keys(knowledgeGraph.hyperedges).length,
      sceneCount: Object.keys(knowledgeGraph.snapshots || {}).length,
    };

    const tx2 = dbConn.transaction(STORE_NAME, 'readwrite');
    const store2 = tx2.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store2.put(updatedItem);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    console.log(`[storage] 로컬 업데이트 완료: ${id}`);
    return true;
  } catch (err) {
    console.error('[storage] 로컬 업데이트 실패:', err);
    return false;
  }
}

async function deleteLocal(id: string): Promise<boolean> {
  try {
    const dbConn = await openDB();
    const tx = dbConn.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    return true;
  } catch (err) {
    console.error('[storage] 로컬 삭제 실패:', err);
    return false;
  }
}

async function getLocalVersionHistory(dataId: string): Promise<Omit<KnowledgeGraphVersion, 'data'>[]> {
  try {
    const dbConn = await openDB();
    const tx = dbConn.transaction(VERSION_STORE_NAME, 'readonly');
    const store = tx.objectStore(VERSION_STORE_NAME);
    const index = store.index('dataId');

    const versions = await new Promise<any[]>((resolve, reject) => {
      const request = index.getAll(dataId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    return versions.map(v => ({
      version: v.version,
      savedAt: v.savedAt,
      note: v.note,
    })).sort((a, b) => b.version - a.version);
  } catch (err) {
    console.error('[storage] 로컬 버전 히스토리 로드 실패:', err);
    return [];
  }
}

async function restoreLocalVersion(dataId: string, version: number): Promise<NovelKnowledgeGraph | null> {
  try {
    const dbConn = await openDB();
    const tx = dbConn.transaction(VERSION_STORE_NAME, 'readonly');
    const store = tx.objectStore(VERSION_STORE_NAME);

    const versionData = await new Promise<any>((resolve, reject) => {
      const request = store.get([dataId, version]);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    return versionData?.data || null;
  } catch (err) {
    console.error('[storage] 로컬 버전 복원 실패:', err);
    return null;
  }
}

// ==================== 통합 API ====================

/**
 * 저장된 모든 지식 그래프 목록 가져오기
 */
export async function getSavedKnowledgeGraphList(): Promise<SavedKnowledgeGraphMeta[]> {
  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs`);
    if (!response.ok) throw new Error('API 응답 오류');

    const serverList = await response.json();
    return serverList;
  } catch (err) {
    console.warn('[storage] 서버 목록 조회 실패, 로컬 사용:', err);
    return getLocalList();
  }
}

/**
 * 특정 지식 그래프 불러오기
 */
export async function loadKnowledgeGraph(id: string): Promise<NovelKnowledgeGraph | null> {
  // 로컬 ID 형식인 경우 로컬에서 로드
  if (id.startsWith('kg_')) {
    return loadLocal(id);
  }

  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${id}`);
    if (!response.ok) throw new Error('API 응답 오류');

    return await response.json();
  } catch (err) {
    console.warn('[storage] 서버 로드 실패, 로컬 시도:', err);
    return loadLocal(id);
  }
}

/**
 * 지식 그래프 저장
 * @param existingId - 기존 데이터의 ID (업데이트 시)
 */
export async function saveKnowledgeGraph(
  knowledgeGraph: NovelKnowledgeGraph,
  novelId?: string,
  userId?: string,
  existingId?: string
): Promise<SavedKnowledgeGraphMeta> {
  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knowledgeGraph,
        novelId: novelId || null,
        userId: userId || null,
        existingId: existingId || null,
      }),
    });

    if (!response.ok) throw new Error('API 응답 오류');

    return await response.json();
  } catch (err) {
    console.warn('[storage] 서버 저장 실패, 로컬 저장:', err);
    return saveLocal(knowledgeGraph, existingId);
  }
}

/**
 * 소설 원본 텍스트 저장
 */
export async function saveNovelText(
  title: string,
  text: string,
  knowledgeGraphId?: string,
  userId?: string
): Promise<{ id: string; title: string }> {
  const response = await fetch(`${API_BASE}/novels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      text,
      knowledgeGraphId: knowledgeGraphId || null,
      userId: userId || null,
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
  } catch {
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
  } catch {
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
  // 로컬 ID인 경우
  if (id.startsWith('kg_')) {
    return updateLocal(id, knowledgeGraph);
  }

  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ knowledgeGraph }),
    });

    if (!response.ok) throw new Error('API 응답 오류');

    const result = await response.json();
    return result.success;
  } catch (err) {
    console.warn('[storage] 서버 업데이트 실패, 로컬 업데이트:', err);
    return updateLocal(id, knowledgeGraph);
  }
}

/**
 * 지식 그래프 삭제
 */
export async function deleteKnowledgeGraph(id: string): Promise<boolean> {
  // 로컬 ID인 경우
  if (id.startsWith('kg_')) {
    return deleteLocal(id);
  }

  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) throw new Error('API 응답 오류');

    const result = await response.json();
    return result.success;
  } catch (err) {
    console.warn('[storage] 서버 삭제 실패:', err);
    return deleteLocal(id);
  }
}

/**
 * 버전 히스토리 가져오기
 */
export async function getVersionHistory(dataId: string): Promise<Omit<KnowledgeGraphVersion, 'data'>[]> {
  if (dataId.startsWith('kg_')) {
    return getLocalVersionHistory(dataId);
  }

  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${dataId}/versions`);
    if (!response.ok) throw new Error('API 응답 오류');

    return await response.json();
  } catch (err) {
    console.warn('[storage] 버전 히스토리 조회 실패:', err);
    return getLocalVersionHistory(dataId);
  }
}

/**
 * 특정 버전 복원
 */
export async function restoreVersion(dataId: string, version: number): Promise<NovelKnowledgeGraph | null> {
  if (dataId.startsWith('kg_')) {
    return restoreLocalVersion(dataId, version);
  }

  try {
    const response = await fetch(`${API_BASE}/knowledge-graphs/${dataId}/restore/${version}`, {
      method: 'POST',
    });

    if (!response.ok) throw new Error('API 응답 오류');

    return await response.json();
  } catch (err) {
    console.warn('[storage] 버전 복원 실패:', err);
    return restoreLocalVersion(dataId, version);
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

/**
 * 저장소 전체 초기화 (주의!)
 */
export async function clearAllStorage(): Promise<void> {
  try {
    const dbConn = await openDB();

    const tx1 = dbConn.transaction(STORE_NAME, 'readwrite');
    tx1.objectStore(STORE_NAME).clear();

    const tx2 = dbConn.transaction(VERSION_STORE_NAME, 'readwrite');
    tx2.objectStore(VERSION_STORE_NAME).clear();
  } catch (err) {
    console.error('[storage] 저장소 초기화 실패:', err);
  }
}
