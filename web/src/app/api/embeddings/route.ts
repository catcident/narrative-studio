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

// POST: 엔티티 임베딩 생성 및 저장
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const { graphId, entities, apiKey: userApiKey } = await request.json();
    const apiKey = userApiKey || ENV_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 400 });
    }

    if (!graphId || !entities || !Array.isArray(entities)) {
      return NextResponse.json({ error: 'graphId and entities array required' }, { status: 400 });
    }

    console.log(`[embeddings] 그래프 ${graphId}의 ${entities.length}개 엔티티 임베딩 시작`);

    // 엔티티 텍스트 준비 (name + description)
    const textsToEmbed = entities.map((e: { name: string; description?: string }) =>
      `${e.name}${e.description ? ': ' + e.description : ''}`
    );

    // 배치 임베딩 (최대 100개씩)
    const batchSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < textsToEmbed.length; i += batchSize) {
      const batch = textsToEmbed.slice(i, i + batchSize);
      const embeddings = await getEmbeddings(batch, apiKey);
      allEmbeddings.push(...embeddings);
    }

    // MongoDB에 저장
    const db = await connectMongo();
    const collection = db.collection('entityEmbeddings');

    // 기존 임베딩 삭제
    await collection.deleteMany({ graphId, userId });

    // 새 임베딩 저장
    const documents = entities.map((entity: { id: string; name: string }, idx: number) => ({
      graphId,
      userId,
      entityId: entity.id,
      entityName: entity.name,
      embedding: allEmbeddings[idx],
      createdAt: new Date(),
    }));

    if (documents.length > 0) {
      await collection.insertMany(documents);
    }

    console.log(`[embeddings] ${documents.length}개 임베딩 저장 완료`);

    return NextResponse.json({
      success: true,
      count: documents.length,
      message: `${documents.length}개 엔티티 임베딩 완료`
    });
  } catch (err) {
    console.error('[embeddings] 오류:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// GET: 키워드로 유사 엔티티 검색
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const { searchParams } = new URL(request.url);
    const graphId = searchParams.get('graphId');
    const keywords = searchParams.get('keywords'); // 쉼표로 구분된 키워드들
    const apiKey = searchParams.get('apiKey') || ENV_API_KEY;
    const topK = parseInt(searchParams.get('topK') || '10');

    if (!graphId || !keywords) {
      return NextResponse.json({ error: 'graphId and keywords required' }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 400 });
    }

    const keywordList = keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if (keywordList.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // 키워드 임베딩
    const keywordEmbeddings = await getEmbeddings(keywordList, apiKey);

    // 해당 그래프의 모든 엔티티 임베딩 가져오기
    const db = await connectMongo();
    const collection = db.collection('entityEmbeddings');
    const entityEmbeddings = await collection.find({ graphId, userId }).toArray();

    if (entityEmbeddings.length === 0) {
      return NextResponse.json({ results: [], message: '임베딩이 없습니다. 먼저 임베딩을 생성하세요.' });
    }

    // 각 키워드에 대해 유사 엔티티 찾기
    const results: { keyword: string; entityId: string; entityName: string; similarity: number }[] = [];

    for (let i = 0; i < keywordList.length; i++) {
      const keyword = keywordList[i];
      const keywordEmb = keywordEmbeddings[i];

      // 모든 엔티티와 유사도 계산
      const similarities = entityEmbeddings.map(doc => ({
        entityId: doc.entityId,
        entityName: doc.entityName,
        similarity: cosineSimilarity(keywordEmb, doc.embedding),
      }));

      // 유사도 높은 순 정렬
      similarities.sort((a, b) => b.similarity - a.similarity);

      // 상위 k개 추가
      similarities.slice(0, topK).forEach(sim => {
        if (sim.similarity > 0.3) { // 임계값
          results.push({ keyword, ...sim });
        }
      });
    }

    // 중복 제거 및 정렬
    const uniqueResults = new Map<string, typeof results[0]>();
    results.forEach(r => {
      const existing = uniqueResults.get(r.entityId);
      if (!existing || existing.similarity < r.similarity) {
        uniqueResults.set(r.entityId, r);
      }
    });

    const finalResults = Array.from(uniqueResults.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return NextResponse.json({ results: finalResults });
  } catch (err) {
    console.error('[embeddings/search] 오류:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
