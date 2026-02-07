import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectMongo } from '@/lib/mongo';
import { requireAuth } from '@/lib/auth';

// 소설 원본 텍스트 단일 조회 (사용자 소유권 확인)
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
    const item = await db.collection('novels').findOne({
      _id: new ObjectId(id),
      userId,
    });

    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: item._id.toString(),
      title: item.title,
      text: item.text,
      savedAt: item.createdAt?.toISOString(),
      updatedAt: item.updatedAt?.toISOString(),
      userId: item.userId || null,
      knowledgeGraphId: item.knowledgeGraphId || null,
    });
  } catch (err: unknown) {
    console.error('[api] novels/[id] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// 소설 원본 텍스트 삭제 (사용자 소유권 확인)
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
    const result = await db.collection('novels').deleteOne({
      _id: new ObjectId(id),
      userId,
    });

    return NextResponse.json({ success: result.deletedCount > 0 });
  } catch (err: unknown) {
    console.error('[api] novels/[id] DELETE error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
