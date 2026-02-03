import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongo';

// 특정 버전 복원
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  try {
    const { id, version } = await params;
    const versionNum = parseInt(version, 10);

    const db = await connectMongo();

    const versionDoc = await db.collection('knowledgeGraphVersions').findOne({
      dataId: id,
      version: versionNum,
    });

    if (!versionDoc || !versionDoc.data) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    return NextResponse.json(versionDoc.data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
