import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectMongo } from '@/lib/mongo';
import { requireAuth } from '@/lib/auth';
import { fetchStorageLimits, saveVersionHistory, DEFAULT_MAX_VERSIONS } from '@/lib/versionHistory';

// 단일 조회 (원본 텍스트 포함 옵션, 사용자 소유권 확인)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeText = searchParams.get('includeText') === 'true';

    const db = await connectMongo();
    const item = await db.collection('knowledgeGraphs').findOne({
      _id: new ObjectId(id),
      userId,
    });

    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // 기존 데이터에 sourceFiles가 없으면 originalText 또는 novels에서 가져와 생성
    const knowledgeGraph = item.data;
    if (!knowledgeGraph.metadata.sourceFiles || knowledgeGraph.metadata.sourceFiles.length === 0) {
      let sourceText = item.originalText;

      // originalText가 없고 novelId가 있으면 novels 컬렉션에서 가져오기
      if (!sourceText && item.novelId) {
        try {
          const { ObjectId: ObjId } = await import('mongodb');
          const novel = await db.collection('novels').findOne({ _id: new ObjId(item.novelId) });
          if (novel?.text) {
            sourceText = novel.text;
          }
        } catch {
          // 무시
        }
      }

      // sourceText가 있으면 sourceFiles로 변환
      if (sourceText) {
        knowledgeGraph.metadata.sourceFiles = [{
          id: 'F0001',
          fileName: `${knowledgeGraph.metadata.title}.txt`,
          uploadedAt: item.createdAt?.toISOString?.() || new Date().toISOString(),
          text: sourceText,
          charCount: sourceText.length,
        }];
      }
    }

    // 원본 텍스트 포함 여부에 따라 응답
    if (includeText) {
      return NextResponse.json({
        knowledgeGraph,
        originalText: item.originalText || null,
        userId: item.userId || null,
      });
    }

    return NextResponse.json(knowledgeGraph);
  } catch (err: unknown) {
    console.error('[api] knowledge-graphs/[id] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// 부분 업데이트 (PUT)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId, accessToken } = authResult;

    const { id } = await params;
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { knowledgeGraph } = body;

    if (!knowledgeGraph) {
      return NextResponse.json({ error: 'knowledgeGraph is required' }, { status: 400 });
    }

    const db = await connectMongo();
    const now = new Date();

    // 기존 데이터 확인
    const existing = await db.collection('knowledgeGraphs').findOne({
      _id: new ObjectId(id),
      userId,
    });

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // 이전 버전을 히스토리에 저장 (fail-safe: 실패해도 업데이트 진행)
    try {
      // anonymous는 fetchStorageLimits 네트워크 호출 불필요 (accessToken 없음)
      const maxVersions = userId !== 'anonymous'
        ? (await fetchStorageLimits(accessToken)).maxVersions
        : DEFAULT_MAX_VERSIONS;
      await saveVersionHistory({
        db,
        existingDoc: existing,
        note: `v${existing.version ?? 1}: ${existing.title}`,
        maxVersions,
        userId,
      });
    } catch (versionErr: unknown) {
      console.error('[api] PUT version history error:', versionErr);
    }

    // 업데이트
    const result = await db.collection('knowledgeGraphs').updateOne(
      { _id: new ObjectId(id), userId },
      {
        $set: {
          data: knowledgeGraph,
          title: knowledgeGraph.metadata?.title || existing.title,
          updatedAt: now,
          entityCount: Object.keys(knowledgeGraph.entities || {}).length,
          edgeCount: Object.keys(knowledgeGraph.hyperedges || {}).length,
          sceneCount: Object.keys(knowledgeGraph.snapshots || {}).length,
        },
        $inc: { version: 1 },
      }
    );

    return NextResponse.json({ success: result.modifiedCount > 0 });
  } catch (err: unknown) {
    console.error('[api] knowledge-graphs/[id] PUT error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// 삭제 (사용자 소유권 확인)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const { id } = await params;
    const db = await connectMongo();
    const result = await db.collection('knowledgeGraphs').deleteOne({
      _id: new ObjectId(id),
      userId,
    });

    if (result.deletedCount > 0) {
      try {
        await Promise.all([
          db.collection('knowledgeGraphVersions').deleteMany({ dataId: id }),
          db.collection('entityEmbeddings').deleteMany({ graphId: id, userId }),
          db.collection('chunkEmbeddings').deleteMany({ graphId: id, userId }),
        ]);
      } catch (cleanupErr: unknown) {
        console.error('[api] knowledge-graphs/[id] DELETE cascade cleanup error:', cleanupErr);
      }
    }

    return NextResponse.json({ success: result.deletedCount > 0 });
  } catch (err: unknown) {
    console.error('[api] knowledge-graphs/[id] DELETE error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
