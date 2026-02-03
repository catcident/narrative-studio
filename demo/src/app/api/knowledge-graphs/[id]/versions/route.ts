import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongo';

// 버전 히스토리 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectMongo();

    const versions = await db.collection('knowledgeGraphVersions')
      .find({ dataId: id })
      .sort({ version: -1 })
      .project({ data: 0 })  // 데이터는 제외 (목록용)
      .toArray();

    return NextResponse.json(versions.map(v => ({
      version: v.version,
      savedAt: v.savedAt?.toISOString?.() || v.savedAt,
      note: v.note,
    })));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
