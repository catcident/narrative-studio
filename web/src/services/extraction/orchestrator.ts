/**
 * 지식 그래프 추출 서비스 — 메인 오케스트레이션
 */

import type { NovelKnowledgeGraph } from '../../types';
import { DEFAULT_MODEL, AVAILABLE_MODELS } from '../../types';
import type { KnownEntity, ChunkExtractedData, ExtractionProgress, ExtractionOptions } from './types';
import { EMPTY_CHUNK_DATA } from './types';
import { splitIntoSmartChunksWithSource } from './chunker';
import { selectRelevantEntities, filterEntitiesByNames, buildAccumulatedGraph } from './selector';
import { extractFromChunk } from './extractor';
import { mergeExtractions, inferMissingRelationships, buildKnowledgeGraph } from './merger';

// localStorage 키
const PROGRESS_KEY = 'novel-extraction-progress';

/**
 * 남은 시간 추정.
 * - 1~2개 데이터: 평균 청크 시간 × 남은 청크 수 (단순 추정)
 * - 3개 이상: 선형 회귀 t(i) = a + b·i 모델로 남은 청크별 시간 합산
 *
 * @returns 남은 시간(ms) 또는 null (데이터 없음)
 */
function estimateRemainingMs(chunkTimes: number[], startChunkIndex: number, totalChunks: number): number | null {
  const n = chunkTimes.length;
  if (n === 0) return null;

  const nextAbsIndex = startChunkIndex + n;
  const remainingChunks = totalChunks - nextAbsIndex;
  if (remainingChunks <= 0) return 0;

  // 1~2개: 평균 기반 단순 추정
  if (n < 3) {
    const avg = chunkTimes.reduce((a, b) => a + b, 0) / n;
    return Math.max(0, avg * remainingChunks);
  }

  // 3개 이상: 선형 회귀
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let k = 0; k < n; k++) {
    const x = startChunkIndex + k;
    sumX += x;
    sumY += chunkTimes[k];
    sumXY += x * chunkTimes[k];
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  const slope = Math.max(0, (n * sumXY - sumX * sumY) / denom);
  const intercept = (sumY - slope * sumX) / n;

  const lastObserved = chunkTimes[n - 1];
  let remainingMs = 0;
  for (let j = nextAbsIndex; j < totalChunks; j++) {
    const predicted = intercept + slope * j;
    remainingMs += Math.max(predicted, lastObserved);
  }

  return Math.max(0, remainingMs);
}

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
  } catch (err: unknown) {
    console.warn('[extraction] 진행상황 불러오기 실패:', err);
  }
  return null;
}

// 진행상황 삭제
export function clearProgress(): void {
  localStorage.removeItem(PROGRESS_KEY);
}

export async function extractKnowledgeGraph(options: ExtractionOptions): Promise<NovelKnowledgeGraph> {
  const { text, title, onProgress, resumeFrom, model, fileNames, existingGraph, onChunkBilling, availableModelIds } = options;
  // 텍스트를 스마트하게 청크로 분할 (장/화 경계, 문장 끝 기준)
  const CHUNK_SIZE = 5000;
  let chunks: string[] = [];
  let chunkSourceFileIndices: number[] = [];  // 각 청크가 어느 파일에서 왔는지 추적
  let allExtracted: ChunkExtractedData[] = [];
  let knownEntities: KnownEntity[] = [];
  let startChunk = 0;

  // 모델 유효성 검증: availableModelIds 우선, 없으면 AVAILABLE_MODELS 정적 폴백
  const validModelIds = availableModelIds ?? AVAILABLE_MODELS.map((m) => m.id);
  const candidateModel = resumeFrom?.model || model || DEFAULT_MODEL;
  const isValidModel = validModelIds.includes(candidateModel);

  let useModel: string;
  if (isValidModel) {
    useModel = candidateModel;
  } else if (resumeFrom) {
    // 이어하기 시 만료 모델 → 사용자 선택 유도를 위해 throw
    throw new Error(`모델 "${candidateModel}"이(가) 더 이상 사용할 수 없습니다. 현재 선택된 모델로 이어하기를 다시 시도해주세요.`);
  } else {
    // 새 분석 시 유효하지 않으면 DEFAULT_MODEL로 폴백 + 경고
    useModel = DEFAULT_MODEL;
    console.warn(`[extraction] 모델 "${candidateModel}"이(가) 유효하지 않음, "${DEFAULT_MODEL}"로 대체`);
    onProgress?.(`선택한 모델을 사용할 수 없어 기본 모델(${DEFAULT_MODEL})로 진행합니다.`);
  }

  // 이어하기인 경우
  if (resumeFrom) {
    chunks = resumeFrom.chunks;
    chunkSourceFileIndices = resumeFrom.chunkSourceFileIndices || chunks.map(() => 0);
    allExtracted = resumeFrom.allExtracted;
    knownEntities = [...resumeFrom.knownEntities];
    startChunk = resumeFrom.processedChunks;
    console.log(`[extraction] 이어하기: ${startChunk}/${resumeFrom.totalChunks}부터 재개 (모델: ${useModel})`);
    onProgress?.(`이어하기: ${startChunk}/${resumeFrom.totalChunks}부터 재개...`);
  } else {
    // 새로 시작: 스마트 청크 분할 사용 (파일 인덱스 추적 포함)
    const chunksWithSource = splitIntoSmartChunksWithSource(text, CHUNK_SIZE);
    chunks = chunksWithSource.map(c => c.content);
    chunkSourceFileIndices = chunksWithSource.map(c => c.sourceFileIndex);

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
  let chunkStartTime = 0;
  let failedChunkCount = 0;
  let lastFailureReason = '';

  const saveCurrentProgress = (processedChunks: number) => {
    saveProgress({
      title,
      totalChunks,
      processedChunks,
      allExtracted,
      knownEntities,
      chunks,
      chunkSourceFileIndices,
      timestamp: Date.now(),
      model: useModel,
      originalText: resumeFrom?.originalText || text,
      fileNames: resumeFrom?.fileNames || fileNames,
    });
  };

  let loopCompleted = true;

  for (let i = startChunk; i < chunks.length; i++) {
    // 남은 시간 추정 (1개 이상 완료 시부터 표시, 3개 이상이면 선형 회귀)
    const estimatedRemainingMs = estimateRemainingMs(chunkTimes, startChunk, totalChunks);
    const estimatedRemainingSeconds = estimatedRemainingMs !== null ? Math.round(estimatedRemainingMs / 1000) : null;
    const timeText = estimatedRemainingSeconds !== null
      ? estimatedRemainingSeconds < 60
        ? ` (예상 ${estimatedRemainingSeconds}초 남음)`
        : ` (예상 ${Math.floor(estimatedRemainingSeconds / 60)}분 ${estimatedRemainingSeconds % 60}초 남음)`
      : '';
    const msg = `청크 ${i + 1}/${totalChunks} 분석 중...${timeText}`;
    console.log(`[extraction] ${msg}`);
    const characterCount = knownEntities.filter(e => e.category === 'character').length;
    console.log(`[extraction] 청크 ${i + 1}: 현재까지 알려진 엔티티: ${knownEntities.length}개 (인물 ${characterCount}명)`);
    onProgress?.(msg, i + 1, totalChunks, estimatedRemainingSeconds);

    chunkStartTime = Date.now();

    try {
      // 축적 그래프 생성: 이전 청크 결과만 사용 (allExtracted)
      // 중요: existingGraph는 LLM 분석에 전달하지 않음
      // - 파일 업로드 순서에 따라 결과가 달라지는 것을 방지
      // - 예: 2화 업로드 → 1화 추가 시, 2화의 엔티티가 LLM에 전달되면 1화 분석 결과가 달라짐
      // - 병합은 buildKnowledgeGraph에서 처리 (같은 이름의 엔티티는 기존 ID 재사용)
      const accumulatedGraph = buildAccumulatedGraph(allExtracted);
      const totalKnownCount = Object.keys(accumulatedGraph.entities).length;

      let entitiesToUse: KnownEntity[] = [];

      // 2개 이상의 알려진 엔티티가 있으면 LLM 선별 사용
      if (totalKnownCount > 1) {
        onProgress?.(`청크 ${i + 1}: 관련 엔티티 선별 중...`, i + 1, totalChunks, estimatedRemainingSeconds);

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
        entitiesToUse = filterEntitiesByNames(accumulatedGraph, Object.values(accumulatedGraph.entities).map((e) => e.name));
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
        failedChunkCount = 0; // 성공 시 연속 실패 카운터 초기화

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
        const extractedCharacters = (extracted.entities || []).filter((e) => e.category === 'character');
        console.log(`[extraction] 청크 ${i + 1}: 추출된 인물: ${extractedCharacters.map((e) => e.name).join(', ')}`);
        console.log(`[extraction] 청크 ${i + 1}: 새로 발견된 엔티티: ${newEntities.join(', ') || '없음'}`);
        console.log(`[extraction] 청크 ${i + 1}: 누적 엔티티 수: ${knownEntities.length}개`);

        // 청크 처리 시간 측정
        chunkTimes.push(Date.now() - chunkStartTime);

        // 매 청크 후 진행상황 저장
        saveCurrentProgress(i + 1);
      }
    } catch (err: unknown) {
      console.error(`[extraction] 청크 ${i + 1} 처리 실패:`, err);

      // 타임아웃이나 API 오류는 스킵하고 계속 진행
      const errMsg = err instanceof Error ? err.message : '';
      const errName = err instanceof Error ? err.name : '';
      const isTimeout = errMsg.includes('timeout') || errMsg.includes('AbortError') || errName === 'AbortError';
      const isApiError = errMsg.includes('API');

      if (isTimeout || isApiError) {
        failedChunkCount++;
        lastFailureReason = errMsg;
        console.warn(`[extraction] 청크 ${i + 1} 스킵 (타임아웃/API 오류), 연속 실패: ${failedChunkCount}회`);
        onProgress?.(`청크 ${i + 1} 스킵 (오류), 계속 진행...`);

        // 빈 결과로 추가 (장면 번호 유지를 위해)
        allExtracted.push(EMPTY_CHUNK_DATA);

        // 진행상황 저장 (실패한 청크도 처리됨으로 표시)
        saveCurrentProgress(i + 1);

        // 연속 3회 이상 실패 시 조기 중단 (동일 오류 반복 방지)
        if (failedChunkCount >= 3) {
          console.error(`[extraction] 연속 ${failedChunkCount}회 실패, 분석 중단. 원인: ${errMsg}`);
          onProgress?.(`연속 ${failedChunkCount}회 실패로 분석 중단 (${i + 1}/${totalChunks}). 이어하기로 재개할 수 있습니다.`);
          loopCompleted = false;
          break;
        }

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

  // 모든 청크가 실패(빈 결과)인 경우 에러로 처리
  const hasAnyData = allExtracted.some(ext =>
    (ext.entities?.length ?? 0) > 0 || (ext.scenes?.length ?? 0) > 0
  );
  if (allExtracted.length > 0 && !hasAnyData) {
    const attempted = allExtracted.length;
    const countInfo = attempted < totalChunks
      ? `${totalChunks}개 중 ${attempted}개 시도 모두`
      : `${totalChunks}개 모두`;
    const reason = lastFailureReason
      ? `\n원인: ${lastFailureReason}`
      : '';
    throw new Error(`청크 ${countInfo} 분석에 실패했습니다.${reason}`);
  }

  onProgress?.('인물 정보 병합 중...');

  // 결과 병합 (청크별 파일 인덱스 전달)
  const merged = mergeExtractions(allExtracted, chunkSourceFileIndices);

  // 후처리: 누락된 관계 자동 생성
  onProgress?.('관계 검증 및 보완 중...');
  const validated = inferMissingRelationships(merged);

  // 이어하기인 경우 저장된 원본 텍스트/파일명 사용
  const finalText = resumeFrom?.originalText || text;
  const finalFileNames = resumeFrom?.fileNames || fileNames;
  return buildKnowledgeGraph(validated, title, useModel, finalFileNames, finalText, existingGraph);
}
