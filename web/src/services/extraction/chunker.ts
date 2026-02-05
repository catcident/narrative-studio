/**
 * 지식 그래프 추출 서비스 — 텍스트 청크 분할
 */

/**
 * 스마트 청크 분할
 * - 장/화/절 경계에서 우선 분할
 * - 문장 끝(. ! ? 등)에서 분할
 * - 문장 중간에서 끊기지 않도록 함
 * - 청크 간 오버랩으로 문맥 연결 보장
 */
export function splitIntoSmartChunks(text: string, targetSize: number = 5000, overlapSize: number = 300): string[] {
  const chunks: string[] = [];

  // 장/화/절 구분 패턴 (마크다운 헤딩, 제N장, N화, Chapter, ***, --- 등)
  const chapterPattern = /(?=\n#{1,3}\s+.+\n)|(?=\n제?\d+[장화편절])|(?=\nChapter\s+\d+)|(?=\nEpisode\s+\d+)|(?=\n---+\n)|(?=\n\*\s*\*\s*\*\s*\n)|(?=\n\* \* \*\n)/gi;

  // 먼저 장/화 단위로 분할
  const sections = text.split(chapterPattern).filter(s => s.trim());

  for (const section of sections) {
    if (section.length <= targetSize) {
      // 섹션이 목표 크기 이하면 그대로 추가
      if (chunks.length > 0 && chunks[chunks.length - 1].length + section.length <= targetSize) {
        // 이전 청크와 합칠 수 있으면 합침
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
