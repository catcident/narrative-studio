import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectMongo } from '@/lib/mongo';
import { requireAuth } from '@/lib/auth';
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
      const newVersion = (existing.version ?? 1) + 1;

      // 새로 추가된 파일명 추출 (기존 소스 파일 수와 비교)
      const existingFileCount = existing.data?.metadata?.sourceFiles?.length || 0;
      const newSourceFiles = data.metadata?.sourceFiles || [];
      const addedFiles = newSourceFiles.slice(existingFileCount);
      const addedFileNames = addedFiles.map((f: { fileName?: string }) => f.fileName).join(', ');

      // 이전 버전을 히스토리에 저장 (text 제거 + FIFO)
      try {
        const maxVersions = limits?.maxVersions ?? DEFAULT_MAX_VERSIONS;
        await saveVersionHistory({
          db,
          existingDoc: existing,
          note: addedFileNames ? `+${addedFileNames}` : `v${existing.version ?? 1}: ${existing.title}`,
          maxVersions,
          userId,
          addedFiles: addedFileNames || null,
        });
      } catch (versionErr: unknown) {
        console.error('[api] POST version history error:', versionErr);
      }

      await collection.updateOne({ _id: existing._id }, {
        $set: {
          title,
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
      // 저장 그래프 수 제한 (새 그래프 insert 시에만)
      const maxSavedGraphs = limits?.maxSavedGraphs ?? DEFAULT_MAX_SAVED_GRAPHS;
      const existingCount = await collection.countDocuments({ userId });
      if (existingCount >= maxSavedGraphs) {
        return NextResponse.json(
          { error: `저장 가능한 그래프 수를 초과했습니다 (최대 ${maxSavedGraphs}개). 기존 그래프를 삭제하거나 상위 플랜으로 업그레이드해주세요.` },
          { status: 403 }
        );
      }

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
  } catch (err: unknown) {
    console.error('[api] knowledge-graphs POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
