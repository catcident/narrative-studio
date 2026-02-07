/**
 * 임베딩 공유 유틸리티 (embeddings + chunk-embeddings route 공용)
 * - OpenRouter embedding API 호출
 * - 코사인 유사도 계산
 */

import { fetchWithTimeout } from './fetchWithTimeout';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_TIMEOUT_MS = 120000;

/** 텍스트를 임베딩 벡터로 변환 (OpenRouter embedding API) */
export async function getEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const response = await fetchWithTimeout('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  }, EMBEDDING_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}

/** 코사인 유사도 계산 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}
