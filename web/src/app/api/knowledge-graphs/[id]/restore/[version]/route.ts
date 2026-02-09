import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectMongo } from '@/lib/mongo';
import { requireAuth } from '@/lib/auth';

// 특정 버전 복원 (사용자 소유권 확인)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const { id, version } = await params;
    const versionNum = parseInt(version, 10);

    const db = await connectMongo();

    // 먼저 해당 지식 그래프가 사용자 소유인지 확인
    const knowledgeGraph = await db.collection('knowledgeGraphs').findOne({
      _id: new ObjectId(id),
      userId,
    });

    if (!knowledgeGraph) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const versionDoc = await db.collection('knowledgeGraphVersions').findOne({
      dataId: id,
      version: versionNum,
    });

    if (!versionDoc || !versionDoc.data) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    // 버전에서 제거된 sourceFiles text를 현재 그래프에서 재구성
    try {
      const versionSourceFiles = versionDoc.data?.metadata?.sourceFiles as
        Array<{ id: string; text?: string; [key: string]: unknown }> | undefined;

      if (Array.isArray(versionSourceFiles)) {
        const currentFiles = knowledgeGraph.data?.metadata?.sourceFiles as
          Array<{ id: string; text?: string }> | undefined;

        const currentFileMap = new Map<string, string>();
        if (Array.isArray(currentFiles)) {
          for (const f of currentFiles) {
            if (f.id && f.text) currentFileMap.set(f.id, f.text);
          }
        }

        for (const vf of versionSourceFiles) {
          if (!vf.text) {
            vf.text = currentFileMap.get(vf.id) ?? '';
          }
        }
      }
    } catch (reconstructErr: unknown) {
      console.error('[api] restore text reconstruction error:', reconstructErr);
    }

    return NextResponse.json(versionDoc.data);
  } catch (err: unknown) {
    console.error('[api] knowledge-graphs/[id]/restore POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
