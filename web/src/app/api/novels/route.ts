import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongo';
import { requireAuth } from '@/lib/auth';
import { runWithSubjectWriteFence } from '@/lib/subjectWriteFence';

// 소설 저장 제한
const MAX_NOVEL_TEXT_LENGTH = 5_000_000;
const MAX_NOVELS_PER_USER = 20;

// 소설 원본 텍스트 목록 조회 (세션 userId로 필터링)
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const db = await connectMongo();
    const query = { userId };
    const items = await db.collection('novels').find(query).sort({ updatedAt: -1 }).toArray();

    return NextResponse.json(items.map(item => ({
      id: item._id.toString(),
      title: item.title,
      savedAt: item.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: item.updatedAt?.toISOString() || new Date().toISOString(),
      textLength: item.text?.length || 0,
      userId: item.userId || null,
      knowledgeGraphId: item.knowledgeGraphId || null,
    })));
  } catch (err: unknown) {
    console.error('[api] novels GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// 소설 원본 텍스트 저장 (세션 인증)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const db = await connectMongo();
    const collection = db.collection('novels');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { title, text, knowledgeGraphId } = body;

    if (!title || typeof text !== 'string' || text.length === 0) {
      return NextResponse.json({ error: 'title and text are required' }, { status: 400 });
    }

    if (text.length > MAX_NOVEL_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `텍스트 크기가 제한을 초과했습니다 (최대 ${(MAX_NOVEL_TEXT_LENGTH / 1_000_000).toFixed(0)}백만 자)` },
        { status: 400 }
      );
    }

    const now = new Date();

    const persisted = await runWithSubjectWriteFence(db, userId, async (session) => {
      const existing = await collection.findOne({ title, userId }, { session });
      if (existing) {
        const persistedKnowledgeGraphId = knowledgeGraphId || existing.knowledgeGraphId || null;
        await collection.updateOne(
          { _id: existing._id, userId },
          { $set: { text, updatedAt: now, knowledgeGraphId: persistedKnowledgeGraphId } },
          { session },
        );
        return {
          limitExceeded: false as const,
          id: existing._id.toString(),
          savedAt: existing.createdAt?.toISOString(),
          knowledgeGraphId: persistedKnowledgeGraphId,
        };
      }
      const novelCount = await collection.countDocuments({ userId }, { session });
      if (novelCount >= MAX_NOVELS_PER_USER) return { limitExceeded: true as const };
      const persistedKnowledgeGraphId = knowledgeGraphId || null;
      const result = await collection.insertOne({
        title,
        text,
        userId,
        knowledgeGraphId: persistedKnowledgeGraphId,
        createdAt: now,
        updatedAt: now,
      }, { session });
      return {
        limitExceeded: false as const,
        id: result.insertedId.toString(),
        savedAt: now.toISOString(),
        knowledgeGraphId: persistedKnowledgeGraphId,
      };
    });
    if (persisted.limitExceeded) {
        return NextResponse.json(
          { error: `저장 가능한 소설 수를 초과했습니다 (최대 ${MAX_NOVELS_PER_USER}개). 기존 소설을 삭제해주세요.` },
          { status: 403 }
        );
    }
    return NextResponse.json({
      id: persisted.id,
      title,
      savedAt: persisted.savedAt,
      updatedAt: now.toISOString(),
      textLength: text.length,
      userId,
      knowledgeGraphId: persisted.knowledgeGraphId,
    });
  } catch (err: unknown) {
    console.error('[api] novels POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
