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
