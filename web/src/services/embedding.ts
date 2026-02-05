/**
 * 엔티티 임베딩 서비스
 * - 그래프 저장 시 엔티티 임베딩 생성
 * - 채팅 시 키워드로 유사 엔티티 검색
 */

import type { Entity } from '../types';

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
  } catch (err) {
    return { success: false, count: 0, error: (err as Error).message };
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
    if (apiKey) {
      params.set('apiKey', apiKey);
    }

    const response = await fetch(`/api/embeddings?${params}`);
    const data = await response.json();

    if (!response.ok) {
      console.error('[embedding] 검색 실패:', data.error);
      return [];
    }

    return data.results || [];
  } catch (err) {
    console.error('[embedding] 검색 오류:', err);
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
