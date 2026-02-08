/**
 * PDF 보고서 내보내기 서비스
 * jsPDF + jspdf-autotable을 사용한 클라이언트 사이드 PDF 생성
 * 한국어 지원: Noto Sans KR 폰트 동적 로딩
 */

import type { NovelKnowledgeGraph, Entity, HyperEdge, SceneSnapshot, EntityCategory } from '../types';

// jsPDF / autotable은 동적 import로 지연 로딩 (번들 크기 절감)

const FONT_NAME = 'NotoSansKR';
const FONT_URL = 'https://cdn.jsdelivr.net/gh/nicholasgasior/gfonts-base64/noto-sans-kr/NotoSansKR-Regular.ttf.base64.txt';

const CATEGORY_LABELS: Record<EntityCategory, string> = {
  character: '인물',
  location: '장소',
  organization: '조직',
  item: '아이템',
  creature: '생물',
  event: '사건',
  concept: '개념',
  time_period: '시대',
  status: '상태',
  emotion: '감정',
};

// 텍스트 말줄임 (PDF 테이블 셀 너비 제한용)
function truncate(text: string | undefined, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

// 폰트 base64 캐시
let fontBase64Cache: string | null = null;

async function loadFontBase64(): Promise<string | null> {
  if (fontBase64Cache) return fontBase64Cache;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(FONT_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.error('[export] Font download failed:', response.status);
      return null;
    }
    fontBase64Cache = await response.text();
    return fontBase64Cache;
  } catch (err: unknown) {
    console.error('[export] Font download error:', err instanceof Error ? err.message : err);
    return null;
  }
}

interface PdfModules {
  jsPDF: typeof import('jspdf').jsPDF;
  autoTable: typeof import('jspdf-autotable').default;
}

async function loadPdfModules(): Promise<PdfModules> {
  const [jspdfModule, autotableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return {
    jsPDF: jspdfModule.jsPDF,
    autoTable: autotableModule.default,
  };
}

/**
 * PDF 보고서 내보내기
 * @param knowledgeGraph 지식 그래프 데이터
 * @param graphImageDataUrl 관계도 PNG DataURL (optional, captureGraphAsPngDataUrl으로 캡처)
 */
export async function exportPdfReport(
  knowledgeGraph: NovelKnowledgeGraph,
  graphImageDataUrl?: string | null,
): Promise<void> {
  console.log('[export] PDF report generation started');

  const [{ jsPDF, autoTable }, fontBase64] = await Promise.all([
    loadPdfModules(),
    loadFontBase64(),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;

  // 한국어 폰트 등록
  if (fontBase64) {
    doc.addFileToVFS('NotoSansKR-Regular.ttf', fontBase64);
    doc.addFont('NotoSansKR-Regular.ttf', FONT_NAME, 'normal');
    doc.setFont(FONT_NAME);
  }

  const setFont = (size: number, style: 'normal' | 'bold' = 'normal') => {
    if (fontBase64) {
      doc.setFont(FONT_NAME, style);
    }
    doc.setFontSize(size);
  };

  // ===== 1. 표지 =====
  const { metadata, stats, entities, hyperedges, snapshots } = knowledgeGraph;

  setFont(24);
  doc.text(metadata.title || '소설 분석 보고서', pageWidth / 2, 60, { align: 'center' });

  setFont(12);
  if (metadata.author) {
    doc.text(`저자: ${metadata.author}`, pageWidth / 2, 75, { align: 'center' });
  }

  setFont(10);
  doc.setTextColor(100, 100, 100);
  const analysisDate = new Date(metadata.createdAt).toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  doc.text(`분석일: ${analysisDate}`, pageWidth / 2, 90, { align: 'center' });
  if (metadata.model) {
    doc.text(`분석 모델: ${metadata.model}`, pageWidth / 2, 97, { align: 'center' });
  }

  // 통계 요약 박스
  doc.setTextColor(0, 0, 0);
  setFont(11);
  const statsY = 115;
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(248, 249, 250);
  doc.roundedRect(margin + 20, statsY - 5, contentWidth - 40, 35, 3, 3, 'FD');

  setFont(10);
  const statsText = [
    `엔티티: ${stats.totalEntities}개`,
    `관계: ${stats.totalEdges}개`,
    `장면: ${Object.keys(snapshots).length}개`,
  ];
  if (stats.totalChapters) {
    statsText.push(`챕터: ${stats.totalChapters}개`);
  }
  doc.text(statsText.join('    |    '), pageWidth / 2, statsY + 10, { align: 'center' });

  // 카테고리별 통계
  const catEntries = Object.entries(stats.entitiesByCategory)
    .filter(([, count]) => count > 0)
    .map(([cat, count]) => `${CATEGORY_LABELS[cat as EntityCategory] || cat}: ${count}`)
    .join('  ');
  if (catEntries) {
    setFont(9);
    doc.setTextColor(100, 100, 100);
    doc.text(catEntries, pageWidth / 2, statsY + 22, { align: 'center' });
  }

  // ===== 2. 관계도 이미지 =====
  if (graphImageDataUrl) {
    doc.addPage();
    doc.setTextColor(0, 0, 0);
    setFont(16);
    doc.text('인물 관계도', margin, 20);

    // 이미지를 페이지에 맞게 삽입 (비율 유지)
    const imgWidth = contentWidth;
    const imgHeight = imgWidth * (3 / 4); // 4:3 비율
    const imgY = 30;

    if (imgY + imgHeight < pageHeight - margin) {
      doc.addImage(graphImageDataUrl, 'PNG', margin, imgY, imgWidth, imgHeight);
    } else {
      // 페이지에 안 맞으면 축소
      const fitHeight = pageHeight - margin - imgY;
      const fitWidth = fitHeight * (4 / 3);
      const fitX = margin + (contentWidth - fitWidth) / 2;
      doc.addImage(graphImageDataUrl, 'PNG', fitX, imgY, fitWidth, fitHeight);
    }
  }

  // ===== 3. 엔티티 표 =====
  doc.addPage();
  doc.setTextColor(0, 0, 0);
  setFont(16);
  doc.text('엔티티 목록', margin, 20);

  const entityList = Object.values(entities)
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));

  const entityRows = entityList.map((e: Entity) => [
    e.name,
    CATEGORY_LABELS[e.category] || e.category,
    String(e.importance ?? '-'),
    truncate(e.aliases?.join(', '), 30),
    String(e.scenes?.length ?? 0),
  ]);

  autoTable(doc, {
    startY: 28,
    head: [['이름', '카테고리', '중요도', '별칭', '등장수']],
    body: entityRows,
    styles: {
      font: fontBase64 ? FONT_NAME : 'helvetica',
      fontSize: 8,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [59, 130, 246],
      textColor: [255, 255, 255],
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 22 },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 50 },
      4: { cellWidth: 15, halign: 'center' },
    },
    margin: { left: margin, right: margin },
    theme: 'grid',
  });

  // ===== 4. 관계 표 =====
  doc.addPage();
  doc.setTextColor(0, 0, 0);
  setFont(16);
  doc.text('관계 목록', margin, 20);

  const edgeList = Object.values(hyperedges);
  const edgeRows = edgeList.map((e: HyperEdge) => {
    const entityNames = e.entities
      .map((id) => entities[id]?.name ?? id)
      .join(' ↔ ');
    return [
      truncate(entityNames, 35),
      e.type,
      e.sentiment ?? '-',
      String(e.strength ?? '-'),
      truncate(e.statement, 40),
    ];
  });

  autoTable(doc, {
    startY: 28,
    head: [['엔티티', '유형', '감정', '강도', '설명']],
    body: edgeRows,
    styles: {
      font: fontBase64 ? FONT_NAME : 'helvetica',
      fontSize: 8,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [139, 92, 246],
      textColor: [255, 255, 255],
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 20 },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 13, halign: 'center' },
      4: { cellWidth: 55 },
    },
    margin: { left: margin, right: margin },
    theme: 'grid',
  });

  // ===== 5. 장면 타임라인 =====
  const sceneList = Object.values(snapshots)
    .sort((a, b) => a.order - b.order);

  if (sceneList.length > 0) {
    doc.addPage();
    doc.setTextColor(0, 0, 0);
    setFont(16);
    doc.text('장면 타임라인', margin, 20);

    const sceneRows = sceneList.map((s: SceneSnapshot) => [
      String(s.order),
      s.chapter ?? '-',
      s.time,
      s.location,
      truncate(s.charactersPresent.join(', '), 30),
      truncate(s.summary, 40),
    ]);

    autoTable(doc, {
      startY: 28,
      head: [['순서', '챕터', '시간', '장소', '인물', '요약']],
      body: sceneRows,
      styles: {
        font: fontBase64 ? FONT_NAME : 'helvetica',
        fontSize: 7,
        cellPadding: 2,
      },
      headStyles: {
        fillColor: [20, 184, 166],
        textColor: [255, 255, 255],
        fontSize: 8,
      },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 20 },
        2: { cellWidth: 22 },
        3: { cellWidth: 22 },
        4: { cellWidth: 30 },
        5: { cellWidth: 50 },
      },
      margin: { left: margin, right: margin },
      theme: 'grid',
    });
  }

  // ===== 6. 페이지 번호 =====
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    setFont(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `${i} / ${totalPages}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' },
    );
  }

  // ===== 다운로드 =====
  const filename = (metadata.title?.replace(/[^a-zA-Z0-9가-힣]/g, '_') || 'report') + '_보고서.pdf';
  doc.save(filename);
  console.log('[export] PDF report exported:', filename);
}
