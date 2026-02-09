/**
 * 공유 폰트 로딩 유틸리티
 * SVG/PDF 내보내기에서 한글 폰트 임베딩에 사용
 */

const FONT_URL = 'https://cdn.jsdelivr.net/gh/nicholasgasior/gfonts-base64/noto-sans-kr/NotoSansKR-Regular.ttf.base64.txt';
export const FONT_FAMILY = 'NotoSansKR';

let fontBase64Cache: string | null = null;

export async function loadFontBase64(): Promise<string | null> {
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

export async function buildFontEmbedCSS(): Promise<string | null> {
  const base64 = await loadFontBase64();
  if (!base64) return null;
  return `@font-face { font-family: '${FONT_FAMILY}'; src: url(data:font/truetype;base64,${base64}) format('truetype'); }`;
}
