import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectMongo } from '@/lib/mongo';

// 소설 원본 텍스트 단일 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectMongo();
    const item = await db.collection('novels').findOne({ _id: new ObjectId(id) });

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
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// 소설 원본 텍스트 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectMongo();
    const result = await db.collection('novels').deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: result.deletedCount > 0 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
