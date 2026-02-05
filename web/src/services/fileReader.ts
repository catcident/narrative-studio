/**
 * 파일 읽기 유틸리티
 * TXT/PDF 통합 읽기 + 인코딩 감지
 */

/**
 * 텍스트 파일 인코딩을 감지하여 디코딩
 */
async function readTextFileWithEncoding(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(buffer);

  // UTF-8 BOM 체크
  if (uint8Array[0] === 0xEF && uint8Array[1] === 0xBB && uint8Array[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(buffer);
  }

  // UTF-16 LE BOM 체크
  if (uint8Array[0] === 0xFF && uint8Array[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(buffer);
  }

  // UTF-16 BE BOM 체크
  if (uint8Array[0] === 0xFE && uint8Array[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(buffer);
  }

  // UTF-8로 먼저 시도
  try {
    const utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return utf8Text;
  } catch {
    // UTF-8이 아님
  }

  // EUC-KR (CP949) 시도 - 한글 텍스트에서 흔함
  try {
    const eucKrText = new TextDecoder('euc-kr').decode(buffer);
    const koreanPattern = /[가-힣]/g;
    const matches = eucKrText.match(koreanPattern);
    if (matches && matches.length > 10) {
      return eucKrText;
    }
  } catch {
    // EUC-KR 디코딩 실패
  }

  // 기본 UTF-8로 폴백
  return new TextDecoder('utf-8').decode(buffer);
}

/**
 * PDF 파일에서 텍스트 추출
 */
async function readPdfFile(file: File, onProgress?: (msg: string) => void): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(`PDF 페이지 ${i}/${pdf.numPages} 처리 중...`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    textParts.push(content.items.map((item: any) => item.str).join(' '));
  }
  return textParts.join('\n\n');
}

/**
 * TXT/PDF 파일을 텍스트로 읽기 (통합 함수)
 */
export async function readFileAsText(file: File, onProgress?: (msg: string) => void): Promise<string> {
  if (file.type === 'application/pdf') {
    onProgress?.('PDF 파싱 중...');
    return readPdfFile(file, onProgress);
  }
  return readTextFileWithEncoding(file);
}
