import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectMongo } from '@/lib/mongo';

// 단일 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectMongo();
    const item = await db.collection('knowledgeGraphs').findOne({ _id: new ObjectId(id) });

    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(item.data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectMongo();
    const result = await db.collection('knowledgeGraphs').deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: result.deletedCount > 0 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
