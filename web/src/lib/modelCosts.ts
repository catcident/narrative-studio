/**
 * 모델 비용 상수 및 크레딧 계산 유틸리티 (공유 모듈)
 *
 * 단일 진실 공급원(single source of truth): AVAILABLE_MODELS (types.ts)
 * 클라이언트(billing.ts)와 서버(/api/analyze) 양쪽에서 사용.
 */

import { AVAILABLE_MODELS, type ModelInfo } from '@/types';

// 상수
export const MARGIN = 3.0;
export const USD_TO_KRW = 1400;
export const KRW_PER_CREDIT = 10;
// 한국어 텍스트는 ~1.0 char/token이지만, 시스템 프롬프트(영문)와 혼합되므로 보수적으로 1.5 사용.
// MARGIN=3.0이 한국어 과소추정분을 보상.
export const CHARS_PER_TOKEN = 1.5;
export const CHUNK_SIZE = 5000;
export const CHUNK_OVERLAP = 300;
export const OUTPUT_RATIO = 0.45;
export const DEFAULT_INPUT_COST = 1.0; // per 1M tokens
export const DEFAULT_OUTPUT_COST = 5.0; // per 1M tokens

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

/** USD 비용에서 크레딧으로 변환 (마진 포함, 최소 1) */
export function costUsdToCredits(costUsd: number): number {
  return Math.max(1, Math.ceil((costUsd * USD_TO_KRW * MARGIN) / KRW_PER_CREDIT));
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

