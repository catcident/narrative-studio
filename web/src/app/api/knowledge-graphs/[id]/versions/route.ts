import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectMongo } from '@/lib/mongo';
import { requireAuth } from '@/lib/auth';

// 버전 히스토리 조회 (사용자 소유권 확인)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const { id } = await params;
    const db = await connectMongo();

    // 먼저 해당 지식 그래프가 사용자 소유인지 확인
    const knowledgeGraph = await db.collection('knowledgeGraphs').findOne({
      _id: new ObjectId(id),
      userId,
    });

    if (!knowledgeGraph) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const versions = await db.collection('knowledgeGraphVersions')
      .find({ dataId: id })
      .sort({ version: -1 })
      .project({ data: 0 })
      .toArray();

    return NextResponse.json(versions.map(v => ({
      version: v.version,
      savedAt: v.savedAt?.toISOString?.() || v.savedAt,
      note: v.note,
      addedFiles: v.addedFiles || null,
    })));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
