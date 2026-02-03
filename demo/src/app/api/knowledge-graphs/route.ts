import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongo';

// 목록 조회
export async function GET() {
  try {
    const db = await connectMongo();
    const items = await db.collection('knowledgeGraphs').find({}).sort({ updatedAt: -1 }).toArray();

    return NextResponse.json(items.map(item => ({
      id: item._id.toString(),
      title: item.title || item.data?.metadata?.title || '제목 없음',
      savedAt: item.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: item.updatedAt?.toISOString() || new Date().toISOString(),
      version: item.version || 1,
      entityCount: item.entityCount || 0,
      edgeCount: item.edgeCount || 0,
      sceneCount: item.sceneCount || 0,
    })));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// 저장
export async function POST(request: NextRequest) {
  try {
    const db = await connectMongo();
    const collection = db.collection('knowledgeGraphs');
    const data = await request.json();

    if (!data?.metadata) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    const title = data.metadata.title;
    const now = new Date();
    const entityCount = Object.keys(data.entities || {}).length;
    const edgeCount = Object.keys(data.hyperedges || {}).length;
    const sceneCount = Object.keys(data.snapshots || {}).length;

    const existing = await collection.findOne({ title });

    if (existing) {
      const newVersion = (existing.version || 1) + 1;
      await collection.updateOne({ _id: existing._id }, {
        $set: { data, version: newVersion, updatedAt: now, entityCount, edgeCount, sceneCount }
      });
      return NextResponse.json({
        id: existing._id.toString(),
        title,
        savedAt: existing.createdAt?.toISOString(),
        updatedAt: now.toISOString(),
        version: newVersion,
        entityCount,
        edgeCount,
        sceneCount
      });
    } else {
      const result = await collection.insertOne({
        title, data, version: 1, createdAt: now, updatedAt: now, entityCount, edgeCount, sceneCount
      });
      return NextResponse.json({
        id: result.insertedId.toString(),
        title,
        savedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        version: 1,
        entityCount,
        edgeCount,
        sceneCount
      });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
