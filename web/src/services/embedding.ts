/**
 * 임베딩 서비스
 * - 그래프 저장 시 엔티티 임베딩 생성
 * - 문서 청크 임베딩 생성
 * - 채팅 시 키워드로 유사 엔티티/청크 검색
 */

import type { Entity } from '../types';

export interface ChunkData {
  index: number;
  content: string;
  sourceFile?: string;
  chapterTitle?: string;
}

export interface ChunkSearchResult {
  chunkIndex: number;
  content: string;
  sourceFile?: string;
  chapterTitle?: string;
  similarity: number;
}

/**
 * 엔티티 임베딩 생성 및 저장
 */
export async function createEntityEmbeddings(
  graphId: string,
  entities: Entity[],
  apiKey?: string
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const response = await fetch('/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphId,
        entities: entities.map(e => ({
          id: e.id,
          name: e.name,
          description: e.description,
        })),
        apiKey,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, count: 0, error: data.error };
    }

    return { success: true, count: data.count };
  } catch (err: unknown) {
    return { success: false, count: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 키워드로 유사 엔티티 검색
 */
export async function searchSimilarEntities(
  graphId: string,
  keywords: string[],
  apiKey?: string,
  topK: number = 10
): Promise<{ entityId: string; entityName: string; similarity: number }[]> {
  try {
    const params = new URLSearchParams({
      graphId,
      keywords: keywords.join(','),
      topK: topK.toString(),
    });

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(`/api/embeddings?${params}`, { headers });
    const data = await response.json();

    if (!response.ok) {
      console.error('[embedding] 검색 실패:', data.error);
      return [];
    }

    return data.results || [];
  } catch (err: unknown) {
    console.error('[embedding] 검색 오류:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 질문에서 키워드 추출 (간단한 버전)
 */
export function extractKeywords(query: string): string[] {
  // 불용어 제거
  const stopWords = new Set([
    '이', '가', '을', '를', '의', '에', '에서', '로', '으로', '와', '과', '도', '만', '까지',
    '은', '는', '뭐', '뭘', '무엇', '어떤', '어떻게', '왜', '누구', '언제', '어디',
    '해줘', '해', '줘', '알려줘', '설명해', '말해', '보여', '찾아',
    '있어', '없어', '하는', '되는', '인가', '인지',
  ]);

  const words = query
    .replace(/[?!.,]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  return [...new Set(words)];
}

/**
 * 문서 청크 임베딩 생성 및 저장
 */
export async function createChunkEmbeddings(
  graphId: string,
  chunks: ChunkData[],
  apiKey?: string
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const response = await fetch('/api/chunk-embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphId,
        chunks,
        apiKey,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, count: 0, error: data.error };
    }

    return { success: true, count: data.count };
  } catch (err: unknown) {
    return { success: false, count: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 질문으로 유사 청크 검색
 */
export async function searchSimilarChunks(
  graphId: string,
  query: string,
  apiKey?: string,
  topK: number = 3
): Promise<ChunkSearchResult[]> {
  try {
    const params = new URLSearchParams({
      graphId,
      query,
      topK: topK.toString(),
    });

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(`/api/chunk-embeddings?${params}`, { headers });
    const data = await response.json();

    if (!response.ok) {
      console.error('[chunk-embedding] 검색 실패:', data.error);
      return [];
    }

    return data.results || [];
  } catch (err: unknown) {
    console.error('[chunk-embedding] 검색 오류:', err instanceof Error ? err.message : err);
    return [];
  }
}
