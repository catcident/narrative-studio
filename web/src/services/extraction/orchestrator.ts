/**
 * 지식 그래프 추출 서비스 — 메인 오케스트레이션
 */

import type { NovelKnowledgeGraph } from '../../types';
import { DEFAULT_MODEL } from '../../types';
import type { KnownEntity, ExtractionProgress, ExtractionOptions } from './types';
import { splitIntoSmartChunks } from './chunker';
import { selectRelevantEntities, filterEntitiesByNames, buildAccumulatedGraph } from './selector';
import { extractFromChunk } from './extractor';
import { mergeExtractions, inferMissingRelationships, buildKnowledgeGraph } from './merger';

// localStorage 키
const PROGRESS_KEY = 'novel-extraction-progress';

// 중간 결과 저장
export function saveProgress(progress: ExtractionProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    console.log(`[extraction] 진행상황 저장: ${progress.processedChunks}/${progress.totalChunks}`);
  } catch (err: unknown) {
    console.warn('[extraction] 진행상황 저장 실패:', err instanceof Error ? err.message : err);
  }
}

// 저장된 진행상황 불러오기
export function loadProgress(): ExtractionProgress | null {
  try {
    const saved = localStorage.getItem(PROGRESS_KEY);
    if (saved) {
      const progress = JSON.parse(saved) as ExtractionProgress;
      // 24시간 이내의 것만 복원
      if (Date.now() - progress.timestamp < 24 * 60 * 60 * 1000) {
        // 구 형식 호환: knownEntities가 없으면 빈 배열로 초기화
        if (!progress.knownEntities) {
          progress.knownEntities = [];
        }
        return progress;
      }
    }
  } catch (e) {
    console.warn('[extraction] 진행상황 불러오기 실패:', e);
  }
  return null;
}

// 진행상황 삭제
export function clearProgress(): void {
  localStorage.removeItem(PROGRESS_KEY);
}

export async function extractKnowledgeGraph(options: ExtractionOptions): Promise<NovelKnowledgeGraph> {
  const { text, title, onProgress, resumeFrom, model, fileName, existingGraph, onChunkBilling } = options;
  // 텍스트를 스마트하게 청크로 분할 (장/화 경계, 문장 끝 기준)
  const CHUNK_SIZE = 5000;
  let chunks: string[] = [];
  let allExtracted: any[] = [];
  let knownEntities: KnownEntity[] = [];
  let startChunk = 0;

  // 사용할 모델 결정: 이어하기면 저장된 모델, 아니면 파라미터 또는 기본값
  const useModel = resumeFrom?.model || model || DEFAULT_MODEL;

  // 이어하기인 경우
  if (resumeFrom) {
    chunks = resumeFrom.chunks;
    allExtracted = resumeFrom.allExtracted;
    knownEntities = [...resumeFrom.knownEntities];
    startChunk = resumeFrom.processedChunks;
    console.log(`[extraction] 이어하기: ${startChunk}/${resumeFrom.totalChunks}부터 재개 (모델: ${useModel})`);
    onProgress?.(`이어하기: ${startChunk}/${resumeFrom.totalChunks}부터 재개...`);
  } else {
    // 새로 시작: 스마트 청크 분할 사용
    chunks = splitIntoSmartChunks(text, CHUNK_SIZE);

    // 기존 지식그래프가 있으면 LLM 선별 방식 사용 예정
    // knownEntities는 비워두고, 각 청크 처리 시 선별하여 전달
    if (existingGraph) {
      const entityCount = Object.keys(existingGraph.entities).length;
      console.log(`[extraction] 기존 지식그래프 감지: ${entityCount}개 엔티티 (청크별 LLM 선별 사용)`);
    }

    console.log(`[extraction] 분석 시작 (모델: ${useModel})`);
  }

  const totalChunks = chunks.length;

  if (!resumeFrom) {
    console.log(`[extraction] 텍스트를 ${totalChunks}개 청크로 분할`);
    onProgress?.(`텍스트를 ${totalChunks}개 부분으로 분할...`);
  }

  let chunkTimes: number[] = [];
  let chunkStartTime = Date.now();

  const saveCurrentProgress = (processedChunks: number) => {
    saveProgress({
      title,
      totalChunks,
      processedChunks,
      allExtracted,
      knownEntities,
      chunks,
      timestamp: Date.now(),
      model: useModel,
      originalText: resumeFrom?.originalText || text,
      fileName: resumeFrom?.fileName || fileName,
    });
  };

  let loopCompleted = true;

  for (let i = startChunk; i < chunks.length; i++) {
    const remaining = totalChunks - i;
    const avgTime = chunkTimes.length > 0 ? chunkTimes.reduce((a, b) => a + b, 0) / chunkTimes.length : 0;
    const estimatedRemaining = avgTime > 0 ? Math.ceil((remaining * avgTime) / 60000) : null;
    const timeText = estimatedRemaining !== null ? ` (예상 ${estimatedRemaining}분 남음)` : '';
    const msg = `청크 ${i + 1}/${totalChunks} 분석 중...${timeText}`;
    console.log(`[extraction] ${msg}`);
    const characterCount = knownEntities.filter(e => e.category === 'character').length;
    console.log(`[extraction] 청크 ${i + 1}: 현재까지 알려진 엔티티: ${knownEntities.length}개 (인물 ${characterCount}명)`);
    onProgress?.(msg, i + 1, totalChunks, estimatedRemaining);

    chunkStartTime = Date.now();

    try {
      // 축적 그래프 생성: existingGraph + 이전 청크 결과 (allExtracted)
      // 한번에 올리기/따로 올리기 모두 동일한 방식으로 처리
      const accumulatedGraph = buildAccumulatedGraph(allExtracted, existingGraph);
      const totalKnownCount = Object.keys(accumulatedGraph.entities).length;

      let entitiesToUse: KnownEntity[] = [];

      // 2개 이상의 알려진 엔티티가 있으면 LLM 선별 사용
      if (totalKnownCount > 1) {
        onProgress?.(`청크 ${i + 1}: 관련 엔티티 선별 중...`, i + 1, totalChunks, estimatedRemaining);

        // LLM으로 관련 엔티티 선별
        const { names: selectedNames, billing: selectionBilling } = await selectRelevantEntities(chunks[i], accumulatedGraph, useModel);

        // selector billing 추적
        if (selectionBilling && onChunkBilling) {
          onChunkBilling(i, selectionBilling);
        }

        // 잔액 소진 체크 (selector에서 감지)
        if (selectionBilling?.insufficient_balance) {
          console.warn(`[extraction] 잔액 소진 (selector): 청크 ${i + 1}에서 중단`);
          onProgress?.(`크레딧 부족으로 중단 (${i}/${totalChunks} 완료). 이어하기로 재개할 수 있습니다.`);
          saveCurrentProgress(i);
          loopCompleted = false;
          break;
        }

        // 선별된 이름으로 필터링
        entitiesToUse = filterEntitiesByNames(accumulatedGraph, selectedNames);

        console.log(`[extraction] 청크 ${i + 1}: LLM 선별: 축적 그래프 ${totalKnownCount}개 중 ${entitiesToUse.length}개 선택`);
      } else {
        // 알려진 엔티티가 1개 이하면 그냥 전체 사용 (accumulatedGraph에서 가져옴)
        entitiesToUse = filterEntitiesByNames(accumulatedGraph, Object.values(accumulatedGraph.entities).map((e: any) => e.name));
        console.log(`[extraction] 청크 ${i + 1}: 선별 스킵 (알려진 엔티티 ${totalKnownCount}개)`);
      }

      console.log(`[extraction] 청크 ${i + 1}: 프롬프트에 전달할 엔티티: ${entitiesToUse.length}개`);
      const { data: extracted, billing } = await extractFromChunk(chunks[i], i + 1, entitiesToUse, useModel);

      // 잔액 소진 체크 (extractor에서 감지)
      if (billing?.insufficient_balance) {
        console.warn(`[extraction] 잔액 소진 (extractor): 청크 ${i + 1}에서 중단`);
        onProgress?.(`크레딧 부족으로 중단 (${i}/${totalChunks} 완료). 이어하기로 재개할 수 있습니다.`);
        if (billing && onChunkBilling) onChunkBilling(i, billing);
        saveCurrentProgress(i);
        loopCompleted = false;
        break;
      }

      if (extracted) {
        // billing 정보를 콜백으로 전달
        if (billing && onChunkBilling) {
          onChunkBilling(i, billing);
        }
        allExtracted.push(extracted);

        // 이 청크에서 발견된 모든 엔티티를 다음 청크를 위해 저장
        const newEntities: string[] = [];
        for (const entity of (extracted.entities || [])) {
          const existing = knownEntities.find(e =>
            e.name === entity.name ||
            e.aliases?.includes(entity.name) ||
            entity.aliases?.includes(e.name)
          );
          if (existing) {
            // 설명 업데이트
            if (entity.description && !existing.description.includes(entity.description)) {
              existing.description = (existing.description + ' ' + entity.description).slice(0, 200);
            }
            // 별칭 병합
            if (entity.aliases) {
              existing.aliases = [...new Set([...(existing.aliases || []), ...entity.aliases])];
            }
          } else {
            knownEntities.push({
              name: entity.name,
              description: (entity.description || '').slice(0, 100),
              category: entity.category || 'character',
              aliases: entity.aliases || []
            });
            newEntities.push(`${entity.name}(${entity.category})`);
          }
        }
        const extractedCharacters = (extracted.entities || []).filter((e: any) => e.category === 'character');
        console.log(`[extraction] 청크 ${i + 1}: 추출된 인물: ${extractedCharacters.map((e: any) => e.name).join(', ')}`);
        console.log(`[extraction] 청크 ${i + 1}: 새로 발견된 엔티티: ${newEntities.join(', ') || '없음'}`);
        console.log(`[extraction] 청크 ${i + 1}: 누적 엔티티 수: ${knownEntities.length}개`);

        // 청크 처리 시간 측정
        chunkTimes.push(Date.now() - chunkStartTime);

        // 매 청크 후 진행상황 저장
        saveCurrentProgress(i + 1);
      }
    } catch (error: unknown) {
      console.error(`[extraction] 청크 ${i + 1} 처리 실패:`, error);

      // 타임아웃이나 API 오류는 스킵하고 계속 진행
      const errMsg = error instanceof Error ? error.message : '';
      const errName = error instanceof Error ? error.name : '';
      const isTimeout = errMsg.includes('timeout') || errMsg.includes('AbortError') || errName === 'AbortError';
      const isApiError = errMsg.includes('API');

      if (isTimeout || isApiError) {
        console.warn(`[extraction] 청크 ${i + 1} 스킵 (타임아웃/API 오류), 계속 진행...`);
        onProgress?.(`청크 ${i + 1} 스킵 (오류), 계속 진행...`);

        // 빈 결과로 추가 (장면 번호 유지를 위해)
        allExtracted.push({ chapters: [], scenes: [], entities: [], relationships: [] });

        // 진행상황 저장 (실패한 청크도 처리됨으로 표시)
        saveCurrentProgress(i + 1);
        continue; // 다음 청크로 계속
      }

      // 다른 종류의 에러는 진행상황 저장 후 중단
      saveCurrentProgress(i);
      throw new Error(`청크 ${i + 1}/${totalChunks} 처리 실패: ${errMsg || '알 수 없는 오류'}. 이어하기로 재시도할 수 있습니다.`);
    }
  }

  // 완전히 완료된 경우에만 진행상황 삭제 (잔액 부족 중단 시 이어하기 위해 보존)
  if (loopCompleted) {
    clearProgress();
  }
  onProgress?.('인물 정보 병합 중...');

  // 결과 병합
  const merged = mergeExtractions(allExtracted);

  // 후처리: 누락된 관계 자동 생성
  onProgress?.('관계 검증 및 보완 중...');
  const validated = inferMissingRelationships(merged);

  // 이어하기인 경우 저장된 원본 텍스트/파일명 사용
  const finalText = resumeFrom?.originalText || text;
  const finalFileName = resumeFrom?.fileName || fileName;
  return buildKnowledgeGraph(validated, title, useModel, finalFileName, finalText, existingGraph);
}
