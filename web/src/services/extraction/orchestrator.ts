/**
 * 지식 그래프 추출 서비스 — 메인 오케스트레이션
 */

import type { NovelKnowledgeGraph, PartialAnalysisInfo } from '../../types';
import { DEFAULT_MODEL, FALLBACK_MODELS } from '../../types';
import type { KnownEntity, ChunkExtractedData, ExtractionProgress, ExtractionOptions, RawLoreEntry } from './types';
import { EMPTY_CHUNK_DATA, getEffectiveApiKey, getByokMode } from './types';
import { splitIntoSmartChunksWithSource } from './chunker';
import { selectRelevantEntities, filterEntitiesByNames, buildAccumulatedGraph } from './selector';
import { extractFromChunk, extractLorebook } from './extractor';
import { mergeExtractions, reviewEntityMerges, inferMissingRelationships, buildKnowledgeGraph, mergeLoreEntries } from './merger';

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
  const { text, title, onProgress, resumeFrom, model, fileNames, existingGraph, onChunkBilling, availableModelIds, byokMode: optByokMode, creditBalance } = options;

  // BYOK 모드에 따른 유효 API 키 결정 (세션 시작 시 1회)
  const byokMode = optByokMode ?? getByokMode();
  const effectiveApiKey = getEffectiveApiKey(byokMode, creditBalance ?? null);
  // 텍스트를 스마트하게 청크로 분할 (장/화 경계, 문장 끝 기준)
  const CHUNK_SIZE = 5000;
  let chunks: string[] = [];
  let chunkSourceFileIndices: number[] = [];  // 각 청크가 어느 파일에서 왔는지 추적
  let allExtracted: ChunkExtractedData[] = [];
  let allExtractedLore: RawLoreEntry[][] = [];  // 청크별 로어북 결과
  let knownEntities: KnownEntity[] = [];
  let startChunk = 0;

  // 모델 유효성 검증: availableModelIds 우선, 없으면 FALLBACK_MODELS 정적 폴백
  const validModelIds = availableModelIds ?? FALLBACK_MODELS.map((m) => m.id);
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
    allExtractedLore = resumeFrom.allExtractedLore || [];
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
      allExtractedLore,
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
        const { names: selectedNames, billing: selectionBilling } = await selectRelevantEntities(chunks[i], accumulatedGraph, useModel, effectiveApiKey);

        // selector billing 추적 (토큰 사용량 누적)
        if (selectionBilling && onChunkBilling) {
          onChunkBilling(i, selectionBilling);
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

      // LLM A (관계 추출) + LLM B (로어북 추출) 병렬 호출
      const [extractionResult, lorebookResult] = await Promise.all([
        extractFromChunk(chunks[i], i + 1, entitiesToUse, useModel, effectiveApiKey),
        extractLorebook(chunks[i], i + 1, entitiesToUse, useModel, effectiveApiKey).catch(err => {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[lorebook] 청크 ${i + 1} 로어북 추출 실패:`, errMsg);
          return { data: [] as RawLoreEntry[], billing: null };
        }),
      ]);

      const extracted = extractionResult.data;
      const billing = extractionResult.billing;

      if (extracted) {
        // billing 정보를 콜백으로 전달 (토큰 사용량 누적)
        if (billing && onChunkBilling) {
          onChunkBilling(i, billing);
        }
        if (lorebookResult.billing && onChunkBilling) {
          onChunkBilling(i, lorebookResult.billing);
        }

        // 로어북 결과 축적
        const loreCount = lorebookResult.data?.length ?? 0;
        if (loreCount > 0) {
          allExtractedLore.push(lorebookResult.data);
          const loreScenes = [...new Set(lorebookResult.data.map(e => e.scene))].sort((a, b) => a - b);
          console.log(`[lorebook] 청크 ${i + 1}: ${loreCount}개 로어 엔트리, 장면번호=[${loreScenes.join(',')}]`);
        } else {
          allExtractedLore.push([]);  // 빈 배열이라도 인덱스 맞추기
          console.log(`[lorebook] 청크 ${i + 1}: 로어 엔트리 없음`);
        }

        allExtracted.push(extracted);
        failedChunkCount = 0; // 성공 시 연속 실패 카운터 초기화

        // LLM A 장면 정보 로그
        const llmASceneIds = (extracted.scenes || []).map(s => s.id);
        console.log(`[extraction] 청크 ${i + 1}: LLM A 장면 id=[${llmASceneIds.join(',')}] (${llmASceneIds.length}개)`);

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
        allExtractedLore.push([]);  // 로어북도 빈 배열로 인덱스 맞추기

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

  // LLM 병합 검토: 같은 대상인데 다른 이름으로 추출된 것을 병합
  onProgress?.('엔티티 병합 검토 중...');
  const { result: reviewed, billing: mergerBilling } = await reviewEntityMerges(merged, useModel, effectiveApiKey);

  // merger review billing 추적 (토큰 사용량 누적)
  if (mergerBilling && onChunkBilling) {
    onChunkBilling(totalChunks, mergerBilling);
  }

  // 후처리: 누락된 관계 자동 생성
  onProgress?.('관계 검증 및 보완 중...');
  const validated = inferMissingRelationships(reviewed);

  // 이어하기인 경우 저장된 원본 텍스트/파일명 사용
  const finalText = resumeFrom?.originalText || text;
  const finalFileNames = resumeFrom?.fileNames || fileNames;

  // 로어북 병합: 엔티티 병합 결과를 반영하여 entityName 매핑
  onProgress?.('로어북 정보 병합 중...');
  const entityNameMapping: Record<string, string> = {};
  for (const entity of reviewed.entities) {
    for (const alias of (entity.aliases || [])) {
      if (alias !== entity.name) {
        entityNameMapping[alias] = entity.name;
      }
    }
  }

  // 1인칭 대명사 → 화자 엔티티 자동 매핑
  // LLM B가 "나"로 추출한 엔트리를 실제 화자 캐릭터에 연결
  // 조건: character 엔티티 중 aliases에 "나" 등 대명사가 있는 것을 찾아 매핑
  const NARRATOR_PRONOUNS = ['나', '저', '우리', '화자', '주인공'];
  const characterEntities = reviewed.entities.filter(e => e.category === 'character' || e.category === 'creature');
  for (const pronoun of NARRATOR_PRONOUNS) {
    if (entityNameMapping[pronoun]) continue; // 이미 매핑됨
    // aliases에 대명사가 포함된 캐릭터 찾기
    const narrator = characterEntities.find(e =>
      e.aliases?.some(a => a === pronoun || a.toLowerCase() === pronoun)
    );
    if (narrator) {
      entityNameMapping[pronoun] = narrator.name;
      console.log(`[lorebook] 대명사 매핑: "${pronoun}" → "${narrator.name}" (aliases에서 발견)`);
    }
  }
  // 대명사 매핑이 하나도 없고 character가 정확히 1명이면 → 그 캐릭터가 화자일 가능성 높음
  if (!NARRATOR_PRONOUNS.some(p => entityNameMapping[p]) && characterEntities.length === 1) {
    for (const pronoun of NARRATOR_PRONOUNS) {
      entityNameMapping[pronoun] = characterEntities[0].name;
    }
    console.log(`[lorebook] 대명사 매핑 (단일 캐릭터): 모든 대명사 → "${characterEntities[0].name}"`);
  }

  // 장면 ID 매핑: 글로벌 번호 → S-format (buildKnowledgeGraph와 동일)
  // 이것은 글로벌 scene.id → "S0001" 형식
  const globalSceneIdMapping: Record<number, string> = {};
  for (const scene of validated.scenes) {
    globalSceneIdMapping[scene.id] = `S${String(scene.id).padStart(4, '0')}`;
  }

  // 로어북용: 청크별 로컬→글로벌→S-format 매핑 구축
  // chunkSceneOffsets[chunkIdx] = { localSceneId → globalSceneId }
  // globalSceneIdMapping = { globalSceneId → "S0001" }
  // 합치면: chunkLocalToSFormat[chunkIdx] = { localSceneId → "S0001" }
  const chunkSceneOffsets = merged.chunkSceneOffsets || [];
  const chunkLocalToSFormat: Array<Record<number, string>> = [];
  for (let ci = 0; ci < chunkSceneOffsets.length; ci++) {
    const localToGlobal = chunkSceneOffsets[ci];
    const localToS: Record<number, string> = {};
    for (const [localStr, globalId] of Object.entries(localToGlobal)) {
      const local = Number(localStr);
      localToS[local] = globalSceneIdMapping[globalId] || `S${String(globalId).padStart(4, '0')}`;
    }
    chunkLocalToSFormat.push(localToS);
  }

  // 알려진 엔티티 이름 목록 (로어북 엔티티명 보정용)
  const knownEntityNames = validated.entities.map(e => e.name);

  // 디버그: 장면 매핑 상태 확인
  console.log(`[lorebook] 장면 매핑 배열 길이: offsets=${chunkSceneOffsets.length}, SFormat=${chunkLocalToSFormat.length}, lore=${allExtractedLore.length}`);
  console.log(`[lorebook] 청크별 장면 매핑 수: ${chunkLocalToSFormat.map((m, i) => `청크${i + 1}=${Object.keys(m).length}개`).join(', ')}`);
  for (let ci = 0; ci < chunkLocalToSFormat.length; ci++) {
    console.log(`[lorebook] 청크${ci + 1} 매핑:`, JSON.stringify(chunkLocalToSFormat[ci]));
  }
  if (chunkLocalToSFormat.length > 0) {
    const first = chunkLocalToSFormat[0];
    console.log(`[lorebook] 청크1 매핑 예시:`, JSON.stringify(first));
  }
  console.log(`[lorebook] 로어 청크 수: ${allExtractedLore.length}, 각 청크별 엔트리 수: ${allExtractedLore.map((l, i) => `청크${i + 1}=${l.length}`).join(', ')}`);

  const mergedLore = mergeLoreEntries(
    allExtractedLore,
    chunkSourceFileIndices,
    chunkLocalToSFormat,
    entityNameMapping,
    finalFileNames,
    undefined,
    knownEntityNames,
  );
  console.log(`[extraction] 로어북 병합: ${mergedLore.length}개 엔트리`);

  return buildKnowledgeGraph(validated, title, useModel, finalFileNames, finalText, existingGraph, mergedLore);
}

/**
 * localStorage의 진행상황을 store.partialAnalysis와 동기화.
 * extractKnowledgeGraph() 완료 후 호출하여 부분 분석 상태를 반영.
 */
export function syncPartialAnalysis(
  setPartialAnalysis: (info: PartialAnalysisInfo | null) => void,
): void {
  const progress = loadProgress();
  if (progress) {
    setPartialAnalysis({
      processedChunks: progress.processedChunks,
      totalChunks: progress.totalChunks,
      title: progress.title,
      timestamp: progress.timestamp,
      model: progress.model,
    });
  } else {
    setPartialAnalysis(null);
  }
}
