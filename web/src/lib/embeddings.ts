/**
 * 임베딩 관련 공통 유틸리티
 * /api/embeddings와 /api/chunk-embeddings에서 공유
 */

import { isAiEnabled } from './aiAvailability';

/**
 * 텍스트를 임베딩 벡터로 변환 (OpenAI embedding API via OpenRouter)
 */
export async function getEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  if (!isAiEnabled()) throw new Error('ai_disabled');
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-small',
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}

/**
 * 코사인 유사도 계산
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
