import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectMongo } from '@/lib/mongo';
import { requireAuth } from '@/lib/auth';
import { runWithSubjectWriteFence } from '@/lib/subjectWriteFence';
import {
  fetchStorageLimits,
  saveVersionHistory,
  DEFAULT_MAX_SAVED_GRAPHS,
  DEFAULT_MAX_VERSIONS,
} from '@/lib/versionHistory';

// 목록 조회 (세션 userId로 필터링)
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId } = authResult;

    const db = await connectMongo();
    const query = { userId };
    const items = await db.collection('knowledgeGraphs').find(query).sort({ updatedAt: -1 }).toArray();

    return NextResponse.json(items.map(item => ({
      id: item._id.toString(),
      title: item.title || item.data?.metadata?.title || '제목 없음',
      savedAt: item.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: item.updatedAt?.toISOString() || new Date().toISOString(),
      version: item.version ?? 1,
      entityCount: item.entityCount || 0,
      edgeCount: item.edgeCount || 0,
      sceneCount: item.sceneCount || 0,
      userId: item.userId || null,
      novelId: item.novelId || null,
      model: item.data?.metadata?.model || null,
    })));
  } catch (err: unknown) {
    console.error('[api] knowledge-graphs GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// 지식 그래프 저장 (novelId로 소설 텍스트 연결, 세션 인증)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;
    const { userId, accessToken } = authResult;

    const db = await connectMongo();
    const collection = db.collection('knowledgeGraphs');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // body 구조: { knowledgeGraph, novelId?, existingId? }
    const data = body.knowledgeGraph || body;
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

    // 플랜 스토리지 제한 조회 (anonymous가 아닌 경우만)
    const limits = userId !== 'anonymous' ? await fetchStorageLimits(accessToken) : null;

    // 1. existingId로 먼저 찾기 (파일 추가 시)
    let existing = null;
    if (existingId) {
      try {
        existing = await collection.findOne({ _id: new ObjectId(existingId), userId });
      } catch {
        // ObjectId 변환 실패 시 무시
      }
    }

    // 2. existingId로 못 찾으면 userId + title 조합으로 찾기
    if (!existing) {
      existing = await collection.findOne({ title, userId });
    }

    if (existing) {
      const persisted = await runWithSubjectWriteFence(db, userId, async (session) => {
        const currentExisting = await collection.findOne(
          { _id: existing._id, userId },
          { session },
        );
        if (!currentExisting) throw new Error('Existing graph not found');
        const newVersion = (currentExisting.version ?? 1) + 1;
        const existingFileCount = currentExisting.data?.metadata?.sourceFiles?.length || 0;
        const newSourceFiles = data.metadata?.sourceFiles || [];
        const addedFiles = newSourceFiles.slice(existingFileCount);
        const addedFileNames = addedFiles.map((f: { fileName?: string }) => f.fileName).join(', ');
        const maxVersions = limits?.maxVersions ?? DEFAULT_MAX_VERSIONS;
        await saveVersionHistory({
          db,
          existingDoc: currentExisting,
          note: addedFileNames ? `+${addedFileNames}` : `v${currentExisting.version ?? 1}: ${currentExisting.title}`,
          maxVersions,
          userId,
          addedFiles: addedFileNames || null,
          session,
        });
        await collection.updateOne({ _id: existing._id, userId }, {
          $set: {
            title,
            data,
            version: newVersion,
            updatedAt: now,
            entityCount,
            edgeCount,
            sceneCount,
            novelId: novelId || currentExisting.novelId,
          },
        }, { session });
        return {
          createdAt: currentExisting.createdAt,
          newVersion,
          novelId: novelId || currentExisting.novelId,
        };
      });
      return NextResponse.json({
        id: existing._id.toString(),
        title,
        savedAt: persisted.createdAt?.toISOString(),
        updatedAt: now.toISOString(),
        version: persisted.newVersion,
        entityCount,
        edgeCount,
        sceneCount,
        userId,
        novelId: persisted.novelId,
        model: data.metadata?.model || null,
      });
    } else {
      // 저장 그래프 수 제한 (새 그래프 insert 시에만)
      const maxSavedGraphs = limits?.maxSavedGraphs ?? DEFAULT_MAX_SAVED_GRAPHS;
      const persisted = await runWithSubjectWriteFence(db, userId, async (session) => {
        const existingCount = await collection.countDocuments({ userId }, { session });
        if (existingCount >= maxSavedGraphs) return { limitExceeded: true as const };
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
          sceneCount,
        }, { session });
        return { limitExceeded: false as const, insertedId: result.insertedId };
      });
      if (persisted.limitExceeded) {
        return NextResponse.json(
          { error: `저장 가능한 그래프 수를 초과했습니다 (최대 ${maxSavedGraphs}개). 기존 그래프를 삭제하거나 상위 플랜으로 업그레이드해주세요.` },
          { status: 403 }
        );
      }

      return NextResponse.json({
        id: persisted.insertedId.toString(),
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
  } catch (err: unknown) {
    console.error('[api] knowledge-graphs POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
