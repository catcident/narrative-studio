/**
 * 모델 비용 상수 및 크레딧 계산 유틸리티 (공유 모듈)
 *
 * 단일 진실 공급원(single source of truth): AVAILABLE_MODELS (types.ts)
 * 클라이언트(billing.ts)와 서버(/api/analyze) 양쪽에서 사용.
 *
 * 마크업 정책: 모델 청크 원가에 따라 연속 마크업 (로그 보간)
 * - 저가 모델(Flash Lite): MAX_MARKUP(10x) → 소액 거래 최소 마진 확보
 * - 고가 모델(Sonnet): MIN_MARKUP(5x) → 대량 소비 시 경쟁력 유지
 */

import { AVAILABLE_MODELS, type ModelInfo } from '@/types';

// 상수
export const USD_TO_KRW = 1500;
export const KRW_PER_CREDIT = 10;
// 한국어 텍스트는 ~1.0 char/token이지만, 시스템 프롬프트(영문)와 혼합되므로 보수적으로 1.5 사용.
export const CHARS_PER_TOKEN = 1.5;
export const CHUNK_SIZE = 5000;
export const CHUNK_OVERLAP = 300;
export const OUTPUT_RATIO = 0.45;
export const DEFAULT_INPUT_COST = 1.0; // per 1M tokens
export const DEFAULT_OUTPUT_COST = 5.0; // per 1M tokens

// 연속 마크업 상수
export const MAX_MARKUP = 10.0;
export const MIN_MARKUP = 5.0;
export const COST_MIN = 0.00070;  // Flash Lite 청크 원가 USD
export const COST_MAX = 0.03252;  // Sonnet 청크 원가 USD

// Selector 추정 상수 (estimateUsageLocally에서 selector 호출 비용 추정용)
// ENTITY_SELECTION_PROMPT(~500자) + textPreview(1000자) + SYSTEM_PROMPT(~250자) + entitySummaries 평균(~1000자)
export const SELECTOR_PROMPT_CHARS = 2750;
export const SELECTOR_OUTPUT_TOKENS = 100;
export const SELECTOR_MODEL = 'google/gemini-2.0-flash-001';

/** 모델 비용 조회: dynamicModels 우선, 없으면 AVAILABLE_MODELS, 없으면 기본값 */
export function getModelCosts(model: string, dynamicModels?: ModelInfo[]): { inputCost: number; outputCost: number } {
  const found = dynamicModels?.find((m) => m.id === model)
    ?? AVAILABLE_MODELS.find((m) => m.id === model);
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

/** 모델의 청크 원가에서 연속 마크업 계산 (로그 보간, clamped [MIN_MARKUP, MAX_MARKUP]) */
export function calculateMarkup(chunkCostUsd: number): number {
  if (chunkCostUsd <= COST_MIN) return MAX_MARKUP;
  if (chunkCostUsd >= COST_MAX) return MIN_MARKUP;
  const t = Math.log(chunkCostUsd / COST_MIN) / Math.log(COST_MAX / COST_MIN);
  return MAX_MARKUP - (MAX_MARKUP - MIN_MARKUP) * t;
}

/** 모델의 단일 청크(5000자) 원가 USD */
export function calculateChunkCostUsd(model: string, dynamicModels?: ModelInfo[]): number {
  const { inputCost, outputCost } = getModelCosts(model, dynamicModels);
  const inputTokens = Math.ceil(CHUNK_SIZE / CHARS_PER_TOKEN);
  const outputTokens = Math.ceil(inputTokens * OUTPUT_RATIO);
  return tokenCostUsd(inputTokens, outputTokens, inputCost, outputCost);
}

/** 세션 전체 크레딧 계산 (마크업은 추출 모델 청크 원가 기반) */
export function calculateSessionCredits(totalSessionCostUsd: number, chunkCostUsd: number): number {
  return Math.max(1, Math.ceil((totalSessionCostUsd * calculateMarkup(chunkCostUsd) * USD_TO_KRW) / KRW_PER_CREDIT));
}

/** USD 비용에서 크레딧으로 변환 (모델 기반 연속 마크업, 최소 1) */
export function costUsdToCredits(costUsd: number, model: string, dynamicModels?: ModelInfo[]): number {
  const chunkCost = calculateChunkCostUsd(model, dynamicModels);
  return Math.max(1, Math.ceil((costUsd * calculateMarkup(chunkCost) * USD_TO_KRW) / KRW_PER_CREDIT));
}

// ==================== 서버 공유 타입/함수 ====================

export interface TokenBilling {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface DeductResult {
  balance_after: number;
  amount_deducted: number;
}

/** usage 필드가 있으면 그대로 사용, 없으면 텍스트 길이에서 토큰 추정 */
export function resolveTokenBilling(
  data: Record<string, unknown>,
  promptLength: number,
  logPrefix: string,
): TokenBilling | null {
  if (data.usage) {
    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number };
    return {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
    };
  }

  const content = (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content;
  if (!content) return null;

  const estimatedPrompt = Math.ceil(promptLength / CHARS_PER_TOKEN);
  const estimatedCompletion = Math.ceil(content.length / CHARS_PER_TOKEN);
  console.warn(`${logPrefix} usage 데이터 누락, 추정값 사용: prompt~${estimatedPrompt}, completion~${estimatedCompletion}`);

  return {
    prompt_tokens: estimatedPrompt,
    completion_tokens: estimatedCompletion,
  };
}

