import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongo';
import { requireAuth } from '@/lib/auth';

const ENV_API_KEY = process.env.OPENROUTER_API_KEY || '';

/**
 * 텍스트를 임베딩 벡터로 변환 (OpenAI embedding API via OpenRouter)
 */
async function getEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
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
function cosineSimilarity(a: number[], b: number[]): number {
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

// POST: 문서 청크 임베딩 생성 및 저장
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const { graphId, chunks, apiKey: userApiKey } = await request.json();
    const apiKey = userApiKey || ENV_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 400 });
    }

    if (!graphId || !chunks || !Array.isArray(chunks)) {
      return NextResponse.json({ error: 'graphId and chunks array required' }, { status: 400 });
    }

    console.log(`[chunk-embeddings] 그래프 ${graphId}의 ${chunks.length}개 청크 임베딩 시작`);

    // 청크 텍스트 준비 (앞 500자만 임베딩에 사용 - 비용 절감)
    const textsToEmbed = chunks.map((chunk: { content: string }) =>
      chunk.content.slice(0, 500)
    );

    // 배치 임베딩 (최대 100개씩)
    const batchSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < textsToEmbed.length; i += batchSize) {
      const batch = textsToEmbed.slice(i, i + batchSize);
      const embeddings = await getEmbeddings(batch, apiKey);
      allEmbeddings.push(...embeddings);
      console.log(`[chunk-embeddings] ${i + batch.length}/${textsToEmbed.length} 배치 완료`);
    }

    // MongoDB에 저장
    const db = await connectMongo();
    const collection = db.collection('chunkEmbeddings');

    // 기존 임베딩 삭제
    await collection.deleteMany({ graphId, userId });

    // 새 임베딩 저장
    const documents = chunks.map((chunk: {
      index: number;
      content: string;
      sourceFile?: string;
      chapterTitle?: string;
    }, idx: number) => ({
      graphId,
      userId,
      chunkIndex: chunk.index,
      content: chunk.content, // 전체 내용 저장 (검색 결과로 반환)
      sourceFile: chunk.sourceFile || null,
      chapterTitle: chunk.chapterTitle || null,
      embedding: allEmbeddings[idx],
      createdAt: new Date(),
    }));

    if (documents.length > 0) {
      await collection.insertMany(documents);
    }

    console.log(`[chunk-embeddings] ${documents.length}개 청크 임베딩 저장 완료`);

    return NextResponse.json({
      success: true,
      count: documents.length,
      message: `${documents.length}개 청크 임베딩 완료`
    });
  } catch (err) {
    console.error('[chunk-embeddings] 오류:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// GET: 질문으로 유사 청크 검색
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const { searchParams } = new URL(request.url);
    const graphId = searchParams.get('graphId');
    const query = searchParams.get('query'); // 검색 질문
    const apiKey = searchParams.get('apiKey') || ENV_API_KEY;
    const topK = parseInt(searchParams.get('topK') || '3');

    if (!graphId || !query) {
      return NextResponse.json({ error: 'graphId and query required' }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 400 });
    }

    // 질문 임베딩
    const [queryEmbedding] = await getEmbeddings([query], apiKey);

    // 해당 그래프의 모든 청크 임베딩 가져오기
    const db = await connectMongo();
    const collection = db.collection('chunkEmbeddings');
    const chunkEmbeddings = await collection.find({ graphId, userId }).toArray();

    if (chunkEmbeddings.length === 0) {
      return NextResponse.json({ results: [], message: '청크 임베딩이 없습니다.' });
    }

    // 모든 청크와 유사도 계산
    const similarities = chunkEmbeddings.map(doc => ({
      chunkIndex: doc.chunkIndex,
      content: doc.content,
      sourceFile: doc.sourceFile,
      chapterTitle: doc.chapterTitle,
      similarity: cosineSimilarity(queryEmbedding, doc.embedding),
    }));

    // 유사도 높은 순 정렬 및 상위 k개 반환
    const results = similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .filter(r => r.similarity > 0.3); // 임계값

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[chunk-embeddings/search] 오류:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
