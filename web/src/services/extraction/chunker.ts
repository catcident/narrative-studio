/**
 * 지식 그래프 추출 서비스 — 텍스트 청크 분할
 */

// 파일 구분선 상수
export const FILE_SEPARATOR = '\n\n--- 파일 구분 ---\n\n';

export interface ChunkWithSource {
  content: string;
  sourceFileIndex: number;  // 원본 파일 인덱스 (0부터 시작)
}

/**
 * 스마트 청크 분할 (하위 호환 — content만 반환)
 *
 * ⚠️ 중요: 청크는 반드시 "화/장" 단위로 분할해야 함!
 * ⚠️ 중요: 다른 파일의 내용은 절대 하나의 청크에 합쳐지면 안 됨!
 *
 * 잘못된 분할 (씬/구분선 단위):
 *   - 청크1: 1화 씬1 → LLM: "1화: 아침"
 *   - 청크2: 1화 씬2 → LLM: "1화 끝" (다른 제목!)
 *   - 청크3: 2화 씬1 → LLM: "2화: 시작"
 *   → 결과: 타임라인에 "1화 아침, 1화 끝, 2화 시작" 뒤죽박죽
 *
 * 올바른 분할 (화 단위):
 *   - 청크1: 1화 전체 → LLM: "1화: 아침" (씬 1,2,3...)
 *   - 청크2: 2화 전체 → LLM: "2화: 만남" (씬 4,5,6...)
 *   → 결과: 타임라인에 화 순서대로 정상 표시
 *
 * 분할 기준으로 사용하면 안 되는 것들:
 *   - 구분선 (---, ***, ===) → 씬 구분임
 *   - ## 또는 ### 헤딩 → 씬 제목일 수 있음
 */
export function splitIntoSmartChunks(text: string, targetSize: number = 5000, overlapSize: number = 300): string[] {
  return splitIntoSmartChunksWithSource(text, targetSize, overlapSize).map(c => c.content);
}

/**
 * 청크 분할 + 원본 파일 인덱스 추적
 */
export function splitIntoSmartChunksWithSource(text: string, targetSize: number = 5000, overlapSize: number = 300): ChunkWithSource[] {
  // 먼저 파일 구분선으로 분리 (다른 파일끼리 절대 합치지 않음)
  const fileParts = text.split(FILE_SEPARATOR).filter(part => part.trim());

  // 단일 파일이면 기존 로직 그대로
  if (fileParts.length <= 1) {
    return splitSingleFileIntoChunks(text, targetSize, overlapSize).map(content => ({
      content,
      sourceFileIndex: 0,
    }));
  }

  // 여러 파일이면 각 파일을 독립적으로 청크 분할 후 합침
  console.log(`[청크 분할] ${fileParts.length}개 파일 독립 분할`);
  const allChunks: ChunkWithSource[] = [];

  for (let i = 0; i < fileParts.length; i++) {
    const filePart = fileParts[i];
    const fileChunks = splitSingleFileIntoChunks(filePart, targetSize, overlapSize);
    console.log(`[청크 분할] 파일 ${i + 1}: ${fileChunks.length}개 청크`);
    for (const content of fileChunks) {
      allChunks.push({ content, sourceFileIndex: i });
    }
  }

  return allChunks;
}

/**
 * 단일 파일 청크 분할 (기존 로직)
 */
function splitSingleFileIntoChunks(text: string, targetSize: number = 5000, overlapSize: number = 300): string[] {
  const chunks: string[] = [];

  // ⚠️ 화/장 단위로만 분할! 씬 단위로 분할하면 안 됨!
  const chapterPattern = new RegExp(
    '(?=' +
      // 마크다운 H1 헤딩만 (# 제목) - ##, ###는 씬 구분이므로 제외
      '\\n#\\s+\\d+화[:\\s]' +
    ')|(?=' +
      // 한글 장/화/편/절 (줄 시작, 숫자 필수)
      '\\n(?:제)?\\s*\\d+\\s*[장화편절](?:[:\\s]|$)' +
    ')|(?=' +
      // 괄호로 감싼 형식
      '\\n[\\[【\\(]\\s*(?:제)?\\s*\\d+\\s*[장화편절]?\\s*[\\]】\\)]' +
    ')|(?=' +
      // 영문 Chapter/Episode/Part
      '\\n(?:Chapter|Episode|Part|Ch\\.|Ep\\.)\\s*\\d+' +
    ')|(?=' +
      // 프롤로그/에필로그/서장/종장
      '\\n(?:프롤로그|에필로그|Prologue|Epilogue|서장|종장|막간|Interlude)(?:[:\\s]|$)' +
    ')',
    'gi'
  );

  // 먼저 장/화 단위로 분할
  const sections = text.split(chapterPattern).filter(s => s.trim());

  for (const section of sections) {
    // 장/화 헤더로 시작하는 섹션인지 확인
    const hasChapterHeader = /^[\s\n]*#|^[\s\n]*(?:제)?\s*\d+\s*[장화편절]|^[\s\n]*\[|\^[\s\n]*【/.test(section);

    if (section.length <= targetSize) {
      // 섹션이 목표 크기 이하면 그대로 추가
      // 단, 장/화 헤더가 있는 섹션은 합치지 않음 (장 구분 유지)
      if (!hasChapterHeader && chunks.length > 0 && chunks[chunks.length - 1].length + section.length <= targetSize) {
        // 이전 청크와 합칠 수 있으면 합침 (장/화 헤더 없는 경우만)
        chunks[chunks.length - 1] += section;
      } else {
        chunks.push(section);
      }
    } else {
      // 섹션이 너무 크면 문장 단위로 분할
      let remaining = section;

      while (remaining.length > 0) {
        if (remaining.length <= targetSize) {
          if (chunks.length > 0 && chunks[chunks.length - 1].length + remaining.length <= targetSize) {
            chunks[chunks.length - 1] += remaining;
          } else {
            chunks.push(remaining);
          }
          break;
        }

        // targetSize 근처에서 문장 끝 찾기
        let cutPoint = targetSize;

        // 문장 끝 패턴: 마침표, 물음표, 느낌표 + 공백/줄바꿈
        // 또는 줄바꿈이 두 번 연속 (단락 구분)
        const searchStart = Math.max(0, targetSize - 500); // 500자 여유 범위
        const searchEnd = Math.min(remaining.length, targetSize + 200);
        const searchRange = remaining.slice(searchStart, searchEnd);

        // 문장 끝 패턴들
        const sentenceEnds = [
          /[.!?]\s+/g,      // 마침표/물음표/느낌표 + 공백
          /[.!?]\n/g,       // 마침표/물음표/느낌표 + 줄바꿈
          /\n\n/g,          // 빈 줄 (단락 구분)
          /[.!?]$/g,        // 마침표/물음표/느낌표 (검색 범위 끝)
        ];

        let bestCut = -1;
        for (const pattern of sentenceEnds) {
          let match;
          while ((match = pattern.exec(searchRange)) !== null) {
            const absolutePos = searchStart + match.index + match[0].length;
            // targetSize에 가장 가까운 위치 선택
            if (absolutePos <= targetSize + 200) {
              bestCut = absolutePos;
            }
          }
          if (bestCut > searchStart) break; // 적절한 위치를 찾았으면 중단
        }

        if (bestCut > searchStart) {
          cutPoint = bestCut;
        } else {
          // 문장 끝을 못 찾으면 공백에서 자르기
          const lastSpace = remaining.lastIndexOf(' ', targetSize);
          const lastNewline = remaining.lastIndexOf('\n', targetSize);
          cutPoint = Math.max(lastSpace, lastNewline);
          if (cutPoint <= searchStart) {
            cutPoint = targetSize; // 공백도 없으면 그냥 자르기
          }
        }

        chunks.push(remaining.slice(0, cutPoint).trim());
        // 오버랩: cutPoint에서 overlapSize만큼 앞에서부터 시작 (문맥 연결)
        const overlapStart = Math.max(0, cutPoint - overlapSize);
        remaining = remaining.slice(overlapStart).trim();
      }
    }
  }

  // 빈 청크 제거 및 너무 작은 청크 병합
  const result: string[] = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;

    if (result.length > 0 && chunk.length < 500 && result[result.length - 1].length + chunk.length <= targetSize * 1.2) {
      // 500자 미만의 작은 청크는 이전 청크와 병합 (20% 초과 허용)
      result[result.length - 1] += '\n' + chunk;
    } else {
      result.push(chunk);
    }
  }

  return result;
}
