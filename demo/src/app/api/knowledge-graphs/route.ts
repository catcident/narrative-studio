import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
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
      novelId: item.novelId || null,
      model: item.data?.metadata?.model || null,  // 분석에 사용된 모델
    })));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// 지식 그래프 저장 (novelId로 소설 텍스트 연결)
export async function POST(request: NextRequest) {
  try {
    const db = await connectMongo();
    const collection = db.collection('knowledgeGraphs');
    const body = await request.json();

    // body 구조: { knowledgeGraph, userId?, novelId?, existingId? }
    const data = body.knowledgeGraph || body;
    const userId = body.userId || null;
    const novelId = body.novelId || null;
    const existingId = body.existingId || null;

    if (!data?.metadata) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    const title = data.metadata.title;
    const now = new Date();
    const entityCount = Object.keys(data.entities || {}).length;
    const edgeCount = Object.keys(data.hyperedges || {}).length;
    const sceneCount = Object.keys(data.snapshots || {}).length;

    // 1. existingId로 먼저 찾기 (파일 추가 시)
    let existing = null;
    if (existingId) {
      try {
        existing = await collection.findOne({ _id: new ObjectId(existingId) });
      } catch {
        // ObjectId 변환 실패 시 무시
      }
    }

    // 2. existingId로 못 찾으면 userId + title 조합으로 찾기
    if (!existing) {
      const query = userId ? { title, userId } : { title, userId: null };
      existing = await collection.findOne(query);
    }

    if (existing) {
      const newVersion = (existing.version || 1) + 1;

      // 이전 버전을 히스토리에 저장
      const versionsCollection = db.collection('knowledgeGraphVersions');
      await versionsCollection.insertOne({
        dataId: existing._id.toString(),
        version: existing.version || 1,
        savedAt: existing.updatedAt || existing.createdAt || now,
        note: `v${existing.version || 1}: ${existing.title}`,
        data: existing.data,
      });

      await collection.updateOne({ _id: existing._id }, {
        $set: {
          title,  // 제목도 업데이트 (01화 -> 01화 + 02화)
          data,
          version: newVersion,
          updatedAt: now,
          entityCount,
          edgeCount,
          sceneCount,
          novelId: novelId || existing.novelId,
        }
      });
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
        novelId: novelId || existing.novelId,
        model: data.metadata?.model || null,
      });
    } else {
      const result = await collection.insertOne({
        title,
        data,
        userId,
        novelId,
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
        novelId,
        model: data.metadata?.model || null,
      });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
