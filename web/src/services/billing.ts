/**
 * Billing API 클라이언트 서비스
 * 서버 사이드 프록시 (/api/billing/)를 통해 catcident billing API에 접근
 *
 * 과금 흐름: /api/analyze가 OpenRouter 호출 후 즉시 청크별 크레딧 차감.
 * 클라이언트는 잔액 사전 확인 + UI 표시용 콜백만 담당.
 */

import type {
  CreditTransaction,
  PlanFeatures,
  ChunkUsage,
} from '../types';
import {
  CHARS_PER_TOKEN, CHUNK_SIZE, CHUNK_OVERLAP, OUTPUT_RATIO,
  getModelCosts, tokenCostUsd, costUsdToCredits,
} from '@/lib/modelCosts';

const BASE = '/api/billing';

// ==================== 공통 fetcher ====================

async function billingFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, init);
    if (!res.ok) {
      console.error(`[billing] ${path} HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error(`[billing] ${path} error:`, error);
    return null;
  }
}

async function billingFetchList<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) {
      console.error(`[billing] ${path} HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.results || data;
  } catch (error) {
    console.error(`[billing] ${path} error:`, error);
    return [];
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

export async function getSubscription(): Promise<SubscriptionInfo | null> {
  return billingFetch<SubscriptionInfo>('/subscription');
}

// ==================== 크레딧 ====================

export async function getCreditBalance(): Promise<{ balance: number; plan: string } | null> {
  return billingFetch<{ balance: number; plan: string }>('/credits/balance');
}

// ==================== 거래 내역 ====================

export interface TransactionsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: CreditTransaction[];
}

export async function getUsageHistory(page: number = 1): Promise<TransactionsResponse | null> {
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

export async function getPlans(): Promise<ServicePlan[]> {
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

export async function getCreditPackages(): Promise<CreditPackage[]> {
  return billingFetchList<CreditPackage>('/packages');
}

// ==================== 로컬 추정 (순수 함수) ====================

export interface UsageEstimate {
  estimated_credits: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: number;
  chunks: number;
}

/**
 * 로컬에서 예상 사용량을 동기 계산 (API 호출 없음)
 * 동기화 대상: catcident-backend apps/business/billing/services/estimator.py StorygraphEstimator
 */
export function estimateUsageLocally(charCount: number, model: string): UsageEstimate {
  if (charCount <= 0) {
    return { estimated_credits: 0, estimated_input_tokens: 0, estimated_output_tokens: 0, estimated_cost_usd: 0, chunks: 0 };
  }

  const effectiveChunk = CHUNK_SIZE - CHUNK_OVERLAP;
  const chunks = Math.max(1, Math.ceil(charCount / effectiveChunk));
  // 백엔드 StorygraphEstimator와 동일: input = char/1.5, output = input * 0.45
  const inputTokens = Math.ceil(charCount / CHARS_PER_TOKEN);
  const outputTokens = Math.ceil(inputTokens * OUTPUT_RATIO);

  const { inputCost, outputCost } = getModelCosts(model);
  const costUsd = tokenCostUsd(inputTokens, outputTokens, inputCost, outputCost);

  return {
    estimated_credits: costUsdToCredits(costUsd),
    estimated_input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    estimated_cost_usd: costUsd,
    chunks,
  };
}

/**
 * 실제 토큰 사용량에서 크레딧 역산 (UsageSummary용)
 * 동기화 대상: catcident-backend apps/business/billing/services/estimator.py StorygraphEstimator
 */
export function calculateCreditsFromTokens(promptTokens: number, completionTokens: number, model: string): number {
  if (promptTokens <= 0 && completionTokens <= 0) return 0;

  const { inputCost, outputCost } = getModelCosts(model);
  return costUsdToCredits(tokenCostUsd(promptTokens, completionTokens, inputCost, outputCost));
}

// ==================== 잔액 사전 확인 ====================

/** 분석 전 잔액 사전 확인 (잔액 > 0 여부만 확인) */
export async function checkSufficientBalance(): Promise<
  { sufficient: true } | { sufficient: false; error: string }
> {
  const balanceInfo = await getCreditBalance();
  if (!balanceInfo) return { sufficient: true }; // billing 비활성 시 통과
  if (balanceInfo.balance <= 0) {
    return { sufficient: false, error: '크레딧이 부족합니다.' };
  }
  return { sufficient: true };
}

// ==================== Billing 콜백 ====================

/** extractKnowledgeGraph에 전달할 billing 콜백 생성 (실시간 잔액 업데이트 지원) */
export function createBillingCallback(
  addChunkUsage: (chunk: ChunkUsage) => void,
  updateCreditBalance?: (n: number) => void,
): (chunkIndex: number, billing: { prompt_tokens: number; completion_tokens: number; model: string; balance_after?: number | null }) => void {
  return (chunkIndex, billing) => {
    addChunkUsage({
      chunkIndex,
      promptTokens: billing.prompt_tokens,
      completionTokens: billing.completion_tokens,
      model: billing.model,
    });
    if (updateCreditBalance && billing.balance_after != null) {
      updateCreditBalance(billing.balance_after);
    }
  };
}

/** 혼합 모델 대응: 청크별 개별 크레딧 계산 후 합산 */
export function calculateCreditsFromChunks(chunks: ChunkUsage[]): number {
  if (chunks.length === 0) return 0;
  return chunks.reduce((sum, chunk) =>
    sum + calculateCreditsFromTokens(chunk.promptTokens, chunk.completionTokens, chunk.model),
  0);
}
