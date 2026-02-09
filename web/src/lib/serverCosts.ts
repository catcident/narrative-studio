/**
 * 서버 전용 비용 계산 모듈
 *
 * USD 기반 토큰 단가, 마크업, 크레딧 계산 등 원가 정보를 포함.
 * 클라이언트 번들에 포함되지 않도록 `server-only` 사용.
 *
 * settle 정산 로직은 이 모듈의 함수를 사용.
 */

import 'server-only';

import {
  CHUNK_SIZE,
  CHARS_PER_TOKEN,
  OUTPUT_RATIO,
  SELECTOR_PROMPT_CHARS,
  SELECTOR_OUTPUT_TOKENS,
  SELECTOR_MODEL,
  MERGER_REVIEW_PROMPT_CHARS,
  MERGER_REVIEW_OUTPUT_TOKENS,
  MERGER_REVIEW_MODEL,
  LOREBOOK_OUTPUT_RATIO,
} from './modelCosts';
import type { ModelInfo } from '@/types';

// ==================== 서버 전용 상수 ====================

export const USD_TO_KRW = 1500;
export const KRW_PER_CREDIT = 10;
export const DEFAULT_INPUT_COST = 1.0; // per 1M tokens
export const DEFAULT_OUTPUT_COST = 5.0; // per 1M tokens

// 연속 마크업 상수
export const MAX_MARKUP = 10.0;
export const MIN_MARKUP = 5.0;
export const COST_MIN = 0.00070;  // Flash Lite 청크 원가 USD
export const COST_MAX = 0.03252;  // Sonnet 청크 원가 USD

// Embedding 추정 상수
export const EMBEDDING_INPUT_COST = 0.02; // openai/text-embedding-3-small per 1M tokens
export const AVG_ENTITY_TOKENS = 50;
export const AVG_CHUNK_EMBED_TOKENS = 3000;

// ==================== 서버 전용 타입 ====================

export interface TokenBilling {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ServerModelInfo extends ModelInfo {
  inputCost: number;
  outputCost: number;
}

// ==================== 서버 전용 모델 비용 데이터 ====================

/** 정적 폴백 비용 데이터 (API 불가 시 사용) */
export const SERVER_MODEL_COSTS: Record<string, { inputCost: number; outputCost: number }> = {
  'google/gemini-2.0-flash-001': { inputCost: 0.10, outputCost: 0.40 },
  'openai/gpt-4o-mini': { inputCost: 0.15, outputCost: 0.60 },
  'anthropic/claude-3-haiku': { inputCost: 0.25, outputCost: 1.25 },
  'openai/gpt-4o': { inputCost: 2.50, outputCost: 10.00 },
  'anthropic/claude-sonnet-4': { inputCost: 3.00, outputCost: 15.00 },
  'google/gemini-2.5-flash-lite': { inputCost: 0.075, outputCost: 0.30 },
  'deepseek/deepseek-chat': { inputCost: 0.14, outputCost: 0.28 },
  'qwen/qwen-2.5-72b-instruct': { inputCost: 0.12, outputCost: 0.39 },
  'google/gemini-2.5-flash': { inputCost: 0.15, outputCost: 0.60 },
  'anthropic/claude-3.5-sonnet': { inputCost: 3.00, outputCost: 15.00 },
};

// ==================== 서버 전용 함수 ====================

/** 모델 비용 조회: dynamicModels 우선, 없으면 SERVER_MODEL_COSTS, 없으면 기본값 */
export function getModelCosts(model: string, dynamicModels?: ServerModelInfo[]): { inputCost: number; outputCost: number } {
  if (dynamicModels) {
    const found = dynamicModels.find((m) => m.id === model);
    if (found) return { inputCost: found.inputCost, outputCost: found.outputCost };
  }
  const staticCost = SERVER_MODEL_COSTS[model];
  if (staticCost) return staticCost;
  return { inputCost: DEFAULT_INPUT_COST, outputCost: DEFAULT_OUTPUT_COST };
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
export function calculateChunkCostUsd(model: string, dynamicModels?: ServerModelInfo[]): number {
  const { inputCost, outputCost } = getModelCosts(model, dynamicModels);
  const inputTokens = Math.ceil(CHUNK_SIZE / CHARS_PER_TOKEN);
  const outputTokens = Math.ceil(inputTokens * OUTPUT_RATIO);
  return tokenCostUsd(inputTokens, outputTokens, inputCost, outputCost);
}

/** USD 비용에서 크레딧으로 변환 (모델 기반 연속 마크업, 최소 1) */
export function costUsdToCredits(costUsd: number, model: string, dynamicModels?: ServerModelInfo[]): number {
  const chunkCost = calculateChunkCostUsd(model, dynamicModels);
  return Math.max(1, Math.ceil((costUsd * calculateMarkup(chunkCost) * USD_TO_KRW) / KRW_PER_CREDIT));
}

/**
 * 혼합 모델 세션의 크레딧 계산 (서버 settle 로직).
 * 각 청크의 costUsd에 해당 모델의 마크업을 적용 후 합산 → 1회 ceil.
 */
export function calculateMixedSessionCredits(
  chunks: { costUsd: number; model: string }[],
  dynamicModels?: ServerModelInfo[],
): number {
  if (chunks.length === 0) return 0;
  let totalKrw = 0;
  for (const chunk of chunks) {
    const chunkCostUsd = calculateChunkCostUsd(chunk.model, dynamicModels);
    totalKrw += chunk.costUsd * calculateMarkup(chunkCostUsd) * USD_TO_KRW;
  }
  return Math.max(1, Math.ceil(totalKrw / KRW_PER_CREDIT));
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

// ==================== 서버 전용 크레딧 사전 계산 ====================

/** 서버 전용: 모델의 분석 청크당 크레딧 (extractor + lorebook + selector + merger 오버헤드 + embedding 포함) */
export function computeCreditsPerChunk(model: string, dynamicModels?: ServerModelInfo[]): number {
  const extractorCosts = getModelCosts(model, dynamicModels);
  const selectorCosts = getModelCosts(SELECTOR_MODEL, dynamicModels);
  const mergerCosts = getModelCosts(MERGER_REVIEW_MODEL, dynamicModels);

  // Extractor cost per chunk
  const extInputTokens = Math.ceil(CHUNK_SIZE / CHARS_PER_TOKEN);
  const extOutputTokens = Math.ceil(extInputTokens * OUTPUT_RATIO);
  const extCost = tokenCostUsd(extInputTokens, extOutputTokens, extractorCosts.inputCost, extractorCosts.outputCost);

  // Lorebook cost per chunk (parallel call, same model + similar input as extractor)
  const loreOutputTokens = Math.ceil(extInputTokens * LOREBOOK_OUTPUT_RATIO);
  const loreCost = tokenCostUsd(extInputTokens, loreOutputTokens, extractorCosts.inputCost, extractorCosts.outputCost);

  // Selector cost (avg: ~1 call per chunk for chunks > 1)
  const selInputTokens = Math.ceil(SELECTOR_PROMPT_CHARS / CHARS_PER_TOKEN);
  const selCost = tokenCostUsd(selInputTokens, SELECTOR_OUTPUT_TOKENS, selectorCosts.inputCost, selectorCosts.outputCost);

  // Merger review amortized (~1 call per 3 chunks)
  const mergerInputTokens = Math.ceil(MERGER_REVIEW_PROMPT_CHARS / CHARS_PER_TOKEN);
  const mergerCost = tokenCostUsd(mergerInputTokens, MERGER_REVIEW_OUTPUT_TOKENS, mergerCosts.inputCost, mergerCosts.outputCost);
  const mergerPerChunk = mergerCost / 3;

  // Embedding cost per chunk
  const estimatedEntities = 3;
  const embedTokens = estimatedEntities * AVG_ENTITY_TOKENS + AVG_CHUNK_EMBED_TOKENS;
  const embedCost = (embedTokens / 1_000_000) * EMBEDDING_INPUT_COST;

  const totalCostPerChunk = extCost + loreCost + selCost + mergerPerChunk + embedCost;

  // Markup based on extractor chunk cost only
  const markup = calculateMarkup(extCost);
  return Math.max(1, Math.ceil((totalCostPerChunk * markup * USD_TO_KRW) / KRW_PER_CREDIT));
}

/** 서버 전용: 모델의 기본 채팅 1회 크레딧 (4회 LLM 호출 기준) */
export function computeCreditsPerChat(model: string, dynamicModels?: ServerModelInfo[]): number {
  const flashCosts = getModelCosts(SELECTOR_MODEL, dynamicModels); // Flash model
  const modelCosts = getModelCosts(model, dynamicModels);

  // ① 의도분석 (Flash)
  const call1In = Math.ceil(800 / CHARS_PER_TOKEN);
  const call1Out = Math.ceil(100 / CHARS_PER_TOKEN);

  // ② 데이터선별 (Flash)
  const call2In = Math.ceil(3000 / CHARS_PER_TOKEN);
  const call2Out = Math.ceil(200 / CHARS_PER_TOKEN);

  // ③ 최종 답변 (사용자 모델): ~30K chars context
  const call3In = Math.ceil(30000 / CHARS_PER_TOKEN);
  const call3Out = Math.ceil(2000 / CHARS_PER_TOKEN);

  // ④ 연결노드판단 (Flash)
  const call4In = Math.ceil(2000 / CHARS_PER_TOKEN);
  const call4Out = Math.ceil(100 / CHARS_PER_TOKEN);

  const chunks = [
    { costUsd: tokenCostUsd(call1In, call1Out, flashCosts.inputCost, flashCosts.outputCost), model: SELECTOR_MODEL },
    { costUsd: tokenCostUsd(call2In, call2Out, flashCosts.inputCost, flashCosts.outputCost), model: SELECTOR_MODEL },
    { costUsd: tokenCostUsd(call3In, call3Out, modelCosts.inputCost, modelCosts.outputCost), model },
    { costUsd: tokenCostUsd(call4In, call4Out, flashCosts.inputCost, flashCosts.outputCost), model: SELECTOR_MODEL },
  ];

  return calculateMixedSessionCredits(chunks, dynamicModels);
}
