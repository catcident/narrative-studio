/**
 * 그래프 이미지 내보내기 서비스
 * html-to-image를 사용한 PNG/SVG 캡처 + 다운로드
 */

import { toPng, toSvg } from 'html-to-image';
import { getNodesBounds, getViewportForBounds } from '@xyflow/react';
import type { Node } from '@xyflow/react';

const IMAGE_WIDTH = 2048;
const IMAGE_HEIGHT = 1536;
const PADDING = 0.15;

function getViewportElement(): HTMLElement | null {
  return document.querySelector('.react-flow__viewport');
}

function buildDownloadUrl(dataUrl: string): { url: string; cleanup: () => void } {
  if (dataUrl.startsWith('data:')) {
    return { url: dataUrl, cleanup: () => {} };
  }
  const blob = new Blob([dataUrl], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  return { url, cleanup: () => URL.revokeObjectURL(url) };
}

function triggerDownload(url: string, filename: string, cleanup: () => void): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  cleanup();
}

function computeViewport(nodes: Node[]) {
  const bounds = getNodesBounds(nodes);
  return getViewportForBounds(
    bounds,
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
    0.5,
    2,
    PADDING,
  );
}

export async function exportGraphAsPng(
  nodes: Node[],
  filename = 'knowledge-graph.png',
): Promise<void> {
  const el = getViewportElement();
  if (!el) {
    console.error('[export] .react-flow__viewport not found');
    return;
  }

  const viewport = computeViewport(nodes);

  const dataUrl = await toPng(el, {
    backgroundColor: '#f9fafb',
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    style: {
      width: `${IMAGE_WIDTH}px`,
      height: `${IMAGE_HEIGHT}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });

  const { url, cleanup } = buildDownloadUrl(dataUrl);
  triggerDownload(url, filename, cleanup);
  console.log('[export] PNG exported:', filename);
}

export async function exportGraphAsSvg(
  nodes: Node[],
  filename = 'knowledge-graph.svg',
): Promise<void> {
  const el = getViewportElement();
  if (!el) {
    console.error('[export] .react-flow__viewport not found');
    return;
  }

  const viewport = computeViewport(nodes);

  const dataUrl = await toSvg(el, {
    backgroundColor: '#f9fafb',
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    style: {
      width: `${IMAGE_WIDTH}px`,
      height: `${IMAGE_HEIGHT}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });

  const { url, cleanup } = buildDownloadUrl(dataUrl);
  triggerDownload(url, filename, cleanup);
  console.log('[export] SVG exported:', filename);
}

/**
 * 관계도 PNG DataURL 캡처 (PDF 보고서용)
 * 높은 DPI(2x)로 캡처하여 인쇄 품질 확보
 */
export async function captureGraphAsPngDataUrl(
  nodes: Node[],
): Promise<string | null> {
  const el = getViewportElement();
  if (!el) {
    console.error('[export] .react-flow__viewport not found');
    return null;
  }

  const viewport = computeViewport(nodes);

  try {
    return await toPng(el, {
      backgroundColor: '#f9fafb',
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      pixelRatio: 2,
      style: {
        width: `${IMAGE_WIDTH}px`,
        height: `${IMAGE_HEIGHT}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
    });
  } catch (err: unknown) {
    console.error('[export] PNG capture failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
