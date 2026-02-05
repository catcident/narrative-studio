/**
 * 모델 비용 상수 및 크레딧 계산 유틸리티 (공유 모듈)
 *
 * 단일 진실 공급원(single source of truth): AVAILABLE_MODELS (types.ts)
 * 동기화 대상: catcident-backend apps/business/billing/services/estimator.py StorygraphEstimator
 *
 * 클라이언트(billing.ts)와 서버(settle/route.ts, analysis-session/route.ts) 양쪽에서 사용.
 */

import { AVAILABLE_MODELS } from '@/types';

// 상수 (catcident-backend StorygraphEstimator와 동기화)
export const MARGIN = 3.0;
export const USD_TO_KRW = 1400;
export const KRW_PER_CREDIT = 10;
// 한국어 텍스트는 ~1.0 char/token이지만, 시스템 프롬프트(영문)와 혼합되므로 보수적으로 1.5 사용.
// MARGIN=3.0이 한국어 과소추정분을 보상. 동기화 대상: catcident-backend StorygraphEstimator.
export const CHARS_PER_TOKEN = 1.5;
export const CHUNK_SIZE = 5000;
export const CHUNK_OVERLAP = 300;
export const OUTPUT_RATIO = 0.45;
export const DEFAULT_INPUT_COST = 1.0; // per 1M tokens
export const DEFAULT_OUTPUT_COST = 5.0; // per 1M tokens

/** AVAILABLE_MODELS에서 모델 비용 조회 (없으면 기본값) */
export function getModelCosts(model: string): { inputCost: number; outputCost: number } {
  const found = AVAILABLE_MODELS.find((m) => m.id === model);
  return found
    ? { inputCost: found.inputCost, outputCost: found.outputCost }
    : { inputCost: DEFAULT_INPUT_COST, outputCost: DEFAULT_OUTPUT_COST };
}

/** 토큰 수 + 모델 단가에서 USD 비용 계산 */
export function tokenCostUsd(
  promptTokens: number,
  completionTokens: number,
  inputCost: number,
  outputCost: number,
): number {
  return (promptTokens / 1_000_000) * inputCost + (completionTokens / 1_000_000) * outputCost;
}

/** USD 비용에서 크레딧으로 변환 (마진 포함, 최소 1) */
export function costUsdToCredits(costUsd: number): number {
  return Math.max(1, Math.ceil((costUsd * USD_TO_KRW * MARGIN) / KRW_PER_CREDIT));
}

/** 토큰 배열에서 크레딧 계산 (settle 라우트용) */
export function calculateCredits(
  tokens: Array<{ promptTokens: number; completionTokens: number; model: string }>,
): number {
  if (tokens.length === 0) return 0;
  return tokens.reduce((sum, t) => {
    const { inputCost, outputCost } = getModelCosts(t.model);
    return sum + costUsdToCredits(tokenCostUsd(t.promptTokens, t.completionTokens, inputCost, outputCost));
  }, 0);
}

/**
 * 문자 수 + 모델에서 예상 크레딧 추정 (서버 측 hold 금액 계산용)
 *
 * 청크 분할 오버헤드를 반영:
 * - 청크 오버랩으로 인한 재처리 (~6%)
 * - 엔티티 선별 API 호출 (flash 모델로 청크당 1회)
 * - 시스템 프롬프트 + 엔티티 컨텍스트 반복
 * MARGIN=3.0이 추가 버퍼 역할.
 */
export function estimateCreditsFromCharCount(charCount: number, model: string): number {
  if (charCount <= 0) return 0;

  // 청크 분할 고려: 오버랩으로 인해 실제 처리 문자수가 증가
  const effectiveChunk = CHUNK_SIZE - CHUNK_OVERLAP;
  const numChunks = Math.max(1, Math.ceil(charCount / effectiveChunk));

  // 메인 모델: 전체 텍스트 + 청크당 시스템 프롬프트/엔티티 컨텍스트 오버헤드 (~500 tokens/chunk)
  const PER_CHUNK_OVERHEAD_TOKENS = 500;
  const inputTokens = Math.ceil(charCount / CHARS_PER_TOKEN) + numChunks * PER_CHUNK_OVERHEAD_TOKENS;
  const outputTokens = Math.ceil(inputTokens * OUTPUT_RATIO);

  const { inputCost, outputCost } = getModelCosts(model);
  let totalCostUsd = tokenCostUsd(inputTokens, outputTokens, inputCost, outputCost);

  // 엔티티 선별 호출 (3번째 청크부터, flash 모델 사용)
  if (numChunks > 2) {
    const selectionCalls = numChunks - 2;
    const selectionTokensPerCall = 1500; // 프롬프트 + 응답
    const selectionCost = getModelCosts('google/gemini-2.0-flash-001');
    totalCostUsd += selectionCalls * tokenCostUsd(
      selectionTokensPerCall, Math.ceil(selectionTokensPerCall * 0.1),
      selectionCost.inputCost, selectionCost.outputCost,
    );
  }

  return costUsdToCredits(totalCostUsd);
}
