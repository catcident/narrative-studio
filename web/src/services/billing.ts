/**
 * Billing API 클라이언트 서비스
 * 서버 사이드 프록시 (/api/billing/)를 통해 catcident billing API에 접근
 *
 * 과금 흐름: /api/analyze가 OpenRouter 호출 후 즉시 청크별 크레딧 차감.
 * 클라이언트는 잔액 사전 확인 + UI 표시용 콜백만 담당.
 */

import type {
  BillingSubscription,
  CreditTransaction,
  PlanFeatures,
  ChunkUsage,
  ModelInfo,
} from '../types';
import type { ChunkBillingCallback } from './extraction/types';
import {
  CHARS_PER_TOKEN, CHUNK_SIZE, CHUNK_OVERLAP, OUTPUT_RATIO,
  SELECTOR_PROMPT_CHARS, SELECTOR_OUTPUT_TOKENS, SELECTOR_MODEL,
  getModelCosts, tokenCostUsd, costUsdToCredits,
  calculateSessionCredits, calculateChunkCostUsd,
} from '@/lib/modelCosts';

const BASE = '/api/billing';

// ==================== 공통 타입 ====================

export type BillingResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'auth' | 'error'; status?: number; message?: string };

export type BillingListResult<T> =
  | { ok: true; data: T[] }
  | { ok: false; reason: 'auth' | 'error'; status?: number; message?: string };

// ==================== 공통 fetcher ====================

async function billingFetch<T>(path: string, init?: RequestInit): Promise<BillingResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, init);
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, reason: 'auth', status: 401 };
      }
      return { ok: false, reason: 'error', status: res.status };
    }
    return { ok: true, data: await res.json() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[billing] ${path} error:`, message);
    return { ok: false, reason: 'error', message };
  }
}

async function billingFetchList<T>(path: string): Promise<BillingListResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, reason: 'auth', status: 401 };
      }
      return { ok: false, reason: 'error', status: res.status };
    }
    const data = await res.json();
    return { ok: true, data: data.results || data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[billing] ${path} error:`, message);
    return { ok: false, reason: 'error', message };
  }
}

// ==================== 세션 API 타입 ====================

export interface HoldResult {
  hold_token: string | null;
  amount: number;
  expires_at: string | null;
  balance_after: number | null;
  byok?: boolean;
}

export interface SettleResult {
  balance_after: number | null;
  amount_deducted: number;
  refunded: number;
  actual_credits: number;
  byok?: boolean;
}

export interface ReleaseResult {
  balance_after: number | null;
  refunded: number;
}

// ==================== 세션 API fetcher ====================

async function sessionFetch<T>(path: string, init?: RequestInit): Promise<BillingResult<T>> {
  try {
    const res = await fetch(`/api/session${path}`, init);
    if (!res.ok) {
      if (res.status === 401) return { ok: false, reason: 'auth', status: 401 };
      if (res.status === 402) return { ok: false, reason: 'error', status: 402, message: '크레딧이 부족합니다.' };
      return { ok: false, reason: 'error', status: res.status };
    }
    return { ok: true, data: await res.json() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[billing] session${path} error:`, message);
    return { ok: false, reason: 'error', message };
  }
}

// ==================== 구독 ====================

export interface SubscriptionInfo {
  subscription_id: number;
  service_code: string;
  plan: {
    code: string;
    name: string;
    monthly_credits: number;
    price_krw: number;
  };
  status: string;
  credit_balance: number;
  credit_reset_at: string | null;
  features: PlanFeatures;
  started_at: string;
  expires_at: string | null;
}

export async function getSubscription(): Promise<BillingResult<SubscriptionInfo>> {
  return billingFetch<SubscriptionInfo>('/subscription');
}

// ==================== 크레딧 ====================

export async function getCreditBalance(): Promise<BillingResult<{ balance: number; plan: string }>> {
  return billingFetch<{ balance: number; plan: string }>('/credits/balance');
}

// ==================== 거래 내역 ====================

export interface TransactionsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: CreditTransaction[];
}

export async function getUsageHistory(page: number = 1): Promise<BillingResult<TransactionsResponse>> {
  return billingFetch<TransactionsResponse>(`/credits/transactions?page=${page}`);
}

// ==================== 요금제 / 상품 ====================

export interface ServicePlan {
  id: number;
  service_code: string;
  code: string;
  name: string;
  monthly_credits: number;
  price_krw: number;
  features: PlanFeatures;
  sort_order: number;
  is_active: boolean;
}

export async function getPlans(): Promise<BillingListResult<ServicePlan>> {
  return billingFetchList<ServicePlan>('/plans');
}

export interface CreditPackage {
  id: number;
  service_code: string;
  name: string;
  credits: number;
  price_krw: number;
  bonus_pct: number;
  sort_order: number;
}

export async function getCreditPackages(): Promise<BillingListResult<CreditPackage>> {
  return billingFetchList<CreditPackage>('/packages');
}

// ==================== 세션 API 함수 ====================

/** 분석 시작 전 예상 크레딧 선차감 (hold) */
export async function holdCredits(
  estimatedCredits: number,
  model: string,
  totalChunks: number,
  metadata?: Record<string, unknown>,
): Promise<BillingResult<HoldResult>> {
  return sessionFetch<HoldResult>('/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      estimated_credits: estimatedCredits,
      model,
      total_chunks: totalChunks,
      metadata,
    }),
  });
}

/** 분석 완료 후 실제 사용량으로 정산 (settle) */
export async function settleCredits(
  holdToken: string,
  chunks: Array<{ model: string; prompt_tokens: number; completion_tokens: number }>,
  description?: string,
  metadata?: Record<string, unknown>,
): Promise<BillingResult<SettleResult>> {
  return sessionFetch<SettleResult>('/settle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hold_token: holdToken, chunks, description, metadata }),
  });
}

/** hold 취소 — 분석 실패/취소 시 전액 환불 (release) */
export async function releaseCredits(holdToken: string): Promise<BillingResult<ReleaseResult>> {
  return sessionFetch<ReleaseResult>('/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hold_token: holdToken }),
  });
}

// ==================== 로컬 추정 (순수 함수) ====================

export interface UsageEstimate {
  estimated_credits: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: number;
  chunks: number;
}

const ZERO_ESTIMATE: UsageEstimate = {
  estimated_credits: 0,
  estimated_input_tokens: 0,
  estimated_output_tokens: 0,
  estimated_cost_usd: 0,
  chunks: 0,
};

/**
 * 로컬에서 예상 사용량을 동기 계산 (API 호출 없음)
 *
 * 세션 수준 크레딧 계산: 전체 세션 비용을 합산한 뒤 calculateSessionCredits() 1회 호출.
 * (기존: 청크별 costUsdToCredits 호출 → 올림 N회 → 과다 추정)
 * - extractor: 매 청크 1회 호출
 * - selector: 청크 2부터 1회 호출 (엔티티 선별)
 */
export function estimateUsageLocally(charCount: number, model: string, dynamicModels?: ModelInfo[]): UsageEstimate {
  if (charCount <= 0) return ZERO_ESTIMATE;

  const effectiveChunk = CHUNK_SIZE - CHUNK_OVERLAP;
  const chunks = Math.max(1, Math.ceil(charCount / effectiveChunk));

  const extractorCosts = getModelCosts(model, dynamicModels);
  const selectorCosts = getModelCosts(SELECTOR_MODEL, dynamicModels);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (let i = 0; i < chunks; i++) {
    const chunkChars = Math.min(CHUNK_SIZE, charCount - i * effectiveChunk);
    const extInputTokens = Math.ceil(chunkChars / CHARS_PER_TOKEN);
    const extOutputTokens = Math.ceil(extInputTokens * OUTPUT_RATIO);
    const extCostUsd = tokenCostUsd(extInputTokens, extOutputTokens, extractorCosts.inputCost, extractorCosts.outputCost);

    totalInputTokens += extInputTokens;
    totalOutputTokens += extOutputTokens;
    totalCostUsd += extCostUsd;

    if (i >= 1) {
      const selInputTokens = Math.ceil(SELECTOR_PROMPT_CHARS / CHARS_PER_TOKEN);
      const selOutputTokens = SELECTOR_OUTPUT_TOKENS;
      const selCostUsd = tokenCostUsd(selInputTokens, selOutputTokens, selectorCosts.inputCost, selectorCosts.outputCost);

      totalInputTokens += selInputTokens;
      totalOutputTokens += selOutputTokens;
      totalCostUsd += selCostUsd;
    }
  }

  // 세션 수준 크레딧 계산 (올림 1회)
  const chunkCostUsd = calculateChunkCostUsd(model, dynamicModels);
  const estimated_credits = calculateSessionCredits(totalCostUsd, chunkCostUsd);

  return {
    estimated_credits,
    estimated_input_tokens: totalInputTokens,
    estimated_output_tokens: totalOutputTokens,
    estimated_cost_usd: totalCostUsd,
    chunks,
  };
}

/**
 * 실제 토큰 사용량에서 크레딧 역산 (UsageSummary용)
 */
export function calculateCreditsFromTokens(promptTokens: number, completionTokens: number, model: string, dynamicModels?: ModelInfo[]): number {
  if (promptTokens <= 0 && completionTokens <= 0) return 0;

  const { inputCost, outputCost } = getModelCosts(model, dynamicModels);
  return costUsdToCredits(tokenCostUsd(promptTokens, completionTokens, inputCost, outputCost), model, dynamicModels);
}

// ==================== 잔액 사전 확인 ====================

/** 분석 전 잔액 사전 확인 (잔액 > 0 여부만 확인) */
export async function checkSufficientBalance(): Promise<
  { sufficient: true } | { sufficient: false; error: string }
> {
  const result = await getCreditBalance();
  if (!result.ok) return { sufficient: true }; // billing 비활성/에러 시 fail-open
  if (result.data.balance <= 0) {
    return { sufficient: false, error: '크레딧이 부족합니다.' };
  }
  return { sufficient: true };
}

/**
 * 구독이 활성화된 경우 잔액 부족 시 에러를 throw.
 * 구독이 없으면 (billing 비활성) 아무 동작 없이 통과.
 */
export async function ensureSufficientBalance(subscription: BillingSubscription | null): Promise<void> {
  if (!subscription) return;
  const result = await checkSufficientBalance();
  if (!result.sufficient) throw new Error(result.error);
}

// ==================== Billing 콜백 ====================

/** extractKnowledgeGraph에 전달할 billing 콜백 생성 (세션 과금 — 잔액은 settle 시 갱신) */
export function createBillingCallback(
  addChunkUsage: (chunk: ChunkUsage) => void,
): ChunkBillingCallback {
  return (chunkIndex, billing) => {
    addChunkUsage({
      chunkIndex,
      promptTokens: billing.prompt_tokens,
      completionTokens: billing.completion_tokens,
      model: billing.model,
    });
  };
}

/** 혼합 모델 대응: 청크별 개별 크레딧 계산 후 합산 */
export function calculateCreditsFromChunks(chunks: ChunkUsage[], dynamicModels?: ModelInfo[]): number {
  if (chunks.length === 0) return 0;
  return chunks.reduce((sum, chunk) =>
    sum + calculateCreditsFromTokens(chunk.promptTokens, chunk.completionTokens, chunk.model, dynamicModels),
  0);
}
