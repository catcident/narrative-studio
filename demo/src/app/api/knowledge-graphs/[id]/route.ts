import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectMongo } from '@/lib/mongo';

// 단일 조회 (원본 텍스트 포함 옵션)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeText = searchParams.get('includeText') === 'true';

    const db = await connectMongo();
    const item = await db.collection('knowledgeGraphs').findOne({ _id: new ObjectId(id) });

    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // 원본 텍스트 포함 여부에 따라 응답
    if (includeText) {
      return NextResponse.json({
        knowledgeGraph: item.data,
        originalText: item.originalText || null,
        userId: item.userId || null,
      });
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
