import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongo';

// 목록 조회 (userId로 필터링 가능)
export async function GET(request: NextRequest) {
  try {
    const db = await connectMongo();
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    const query = userId ? { userId } : {};
    const items = await db.collection('knowledgeGraphs').find(query).sort({ updatedAt: -1 }).toArray();

    return NextResponse.json(items.map(item => ({
      id: item._id.toString(),
      title: item.title || item.data?.metadata?.title || '제목 없음',
      savedAt: item.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: item.updatedAt?.toISOString() || new Date().toISOString(),
      version: item.version || 1,
      entityCount: item.entityCount || 0,
      edgeCount: item.edgeCount || 0,
      sceneCount: item.sceneCount || 0,
      userId: item.userId || null,
      hasOriginalText: !!item.originalText,
    })));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// 저장 (원본 텍스트 + 사용자 ID 포함)
export async function POST(request: NextRequest) {
  try {
    const db = await connectMongo();
    const collection = db.collection('knowledgeGraphs');
    const body = await request.json();

    // body 구조: { knowledgeGraph, originalText?, userId? }
    const data = body.knowledgeGraph || body;
    const originalText = body.originalText || null;
    const userId = body.userId || null;

    if (!data?.metadata) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    const title = data.metadata.title;
    const now = new Date();
    const entityCount = Object.keys(data.entities || {}).length;
    const edgeCount = Object.keys(data.hyperedges || {}).length;
    const sceneCount = Object.keys(data.snapshots || {}).length;

    // userId + title 조합으로 찾기 (사용자별 분리)
    const query = userId ? { title, userId } : { title, userId: null };
    const existing = await collection.findOne(query);

    if (existing) {
      const newVersion = (existing.version || 1) + 1;
      const updateData: any = {
        data,
        version: newVersion,
        updatedAt: now,
        entityCount,
        edgeCount,
        sceneCount
      };
      // 원본 텍스트가 있으면 업데이트
      if (originalText) {
        updateData.originalText = originalText;
      }

      await collection.updateOne({ _id: existing._id }, { $set: updateData });
      return NextResponse.json({
        id: existing._id.toString(),
        title,
        savedAt: existing.createdAt?.toISOString(),
        updatedAt: now.toISOString(),
        version: newVersion,
        entityCount,
        edgeCount,
        sceneCount,
        userId,
        hasOriginalText: !!(originalText || existing.originalText),
      });
    } else {
      const result = await collection.insertOne({
        title,
        data,
        originalText,
        userId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        entityCount,
        edgeCount,
        sceneCount
      });
      return NextResponse.json({
        id: result.insertedId.toString(),
        title,
        savedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        version: 1,
        entityCount,
        edgeCount,
        sceneCount,
        userId,
        hasOriginalText: !!originalText,
      });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
