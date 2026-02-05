/**
 * Billing API 클라이언트 서비스
 * 서버 사이드 프록시 (/api/billing/)를 통해 catcident billing API에 접근
 */

import type {
  CreditTransaction,
  PlanFeatures,
  CurrentUsage,
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

export interface UsageEstimate {
  estimated_credits: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: number;
  chunks: number;
}

export interface DeductResult {
  balance_after: number;
  amount_deducted: number;
  ledger_id: number;
}

export async function deductCredits(
  amount: number,
  description: string,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<DeductResult | null> {
  return billingFetch<DeductResult>('/credits/deduct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      description,
      metadata,
      idempotency_key: idempotencyKey,
    }),
  });
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

/** 분석 전 잔액 충분 여부 확인 */
export async function checkSufficientBalance(charCount: number, model: string): Promise<{ sufficient: true } | { sufficient: false; error: string }> {
  const balanceInfo = await getCreditBalance();
  if (!balanceInfo) return { sufficient: true }; // billing 비활성 시 통과
  if (balanceInfo.balance <= 0) {
    return { sufficient: false, error: '크레딧이 부족합니다.' };
  }
  const estimate = estimateUsageLocally(charCount, model);
  if (estimate.estimated_credits > balanceInfo.balance) {
    return { sufficient: false, error: `크레딧이 부족합니다. 필요: 약 ${estimate.estimated_credits.toLocaleString()}, 잔액: ${balanceInfo.balance.toLocaleString()}` };
  }
  return { sufficient: true };
}

// ==================== Billing 콜백 / 차감 헬퍼 ====================

/** extractKnowledgeGraph에 전달할 billing 콜백 생성 */
export function createBillingCallback(
  addChunkUsage: (chunk: ChunkUsage) => void
): (chunkIndex: number, billing: { prompt_tokens: number; completion_tokens: number; model: string }) => void {
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
export function calculateCreditsFromChunks(chunks: ChunkUsage[]): number {
  if (chunks.length === 0) return 0;
  return chunks.reduce((sum, chunk) =>
    sum + calculateCreditsFromTokens(chunk.promptTokens, chunk.completionTokens, chunk.model),
  0);
}

/** 공통 크레딧 차감 헬퍼 */
async function deductUsage(
  description: string,
  idempotencyKey: string,
  currentUsage: CurrentUsage,
  updateCreditBalance: (n: number) => void,
  onDeductFailed?: () => void,
  extraMetadata?: Record<string, unknown>,
  throwOnFail = false,
): Promise<void> {
  const totalTokens = currentUsage.totalPromptTokens + currentUsage.totalCompletionTokens;
  if (totalTokens <= 0) return;

  const credits = calculateCreditsFromChunks(currentUsage.chunks);
  if (credits <= 0) return;

  const models = [...new Set(currentUsage.chunks.map(c => c.model))];
  const result = await deductCredits(
    credits,
    description,
    { models, chunks: currentUsage.chunks.length, totalTokens, ...extraMetadata },
    idempotencyKey,
  );
  if (result) {
    updateCreditBalance(result.balance_after);
  } else {
    onDeductFailed?.();
    if (throwOnFail) {
      throw new Error('크레딧 차감에 실패했습니다. 다음 분석 시 자동으로 재시도됩니다.');
    }
  }
}

/** 분석 완료 후 실제 토큰 기반 크레딧 차감 */
export async function deductAfterSave(
  savedId: string,
  title: string,
  currentUsage: CurrentUsage,
  updateCreditBalance: (n: number) => void,
  onDeductFailed?: () => void,
): Promise<void> {
  return deductUsage(
    `소설 분석: ${title}`,
    `storygraph-${savedId}-${currentUsage.chunks.length}`,
    currentUsage,
    updateCreditBalance,
    onDeductFailed,
    undefined,
    true,  // throwOnFail
  );
}

/** 분석 도중 실패 시 부분 차감 */
export async function deductPartial(
  title: string,
  currentUsage: CurrentUsage,
  updateCreditBalance: (n: number) => void,
  onDeductFailed?: () => void,
): Promise<void> {
  return deductUsage(
    `소설 분석 (부분): ${title}`,
    `storygraph-partial-${title.replace(/\s+/g, '-').slice(0, 30)}-${currentUsage.chunks.length}`,
    currentUsage,
    updateCreditBalance,
    onDeductFailed,
    { partial: true },
  );
}

// ==================== 분석 세션 (Hold/Settle) ====================

interface AnalysisSessionResult {
  session_id: string;
  hold_token: string;
  amount: number;
  balance_after: number;
  expires_at: string;
}

interface SettleResult {
  balance_after: number;
  amount_deducted: number;
  refunded: number;
  hold_token: string;
  ledger_id: number;
}

interface ReleaseResult {
  balance_after: number;
  refunded: number;
  hold_token: string;
}

/** 분석 세션 API 공통 POST 헬퍼 */
async function sessionFetch<T>(path: string, body: Record<string, unknown>, label: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/analysis-session${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[billing] analysis-session ${label} HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (error: unknown) {
    console.error(`[billing] analysis-session ${label} error:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * 분석 세션 시작 — 서버가 hold 금액을 계산하여 선차감하고 세션 ID를 반환.
 * 서버는 metadata.charCount + model로 hold 금액을 계산 (클라이언트 amount 무시).
 */
export function startAnalysisSession(
  model: string,
  metadata?: Record<string, unknown>,
): Promise<AnalysisSessionResult | null> {
  return sessionFetch('', { model, metadata }, 'start');
}

/** 분석 세션 정산 — 서버가 누적한 실제 토큰으로 크레딧 계산 및 정산. */
export function settleAnalysisSession(
  sessionId: string,
  title: string,
  idempotencyKey: string,
): Promise<SettleResult | null> {
  return sessionFetch('/settle', {
    session_id: sessionId,
    title,
    idempotency_key: idempotencyKey,
  }, 'settle');
}

/** 분석 세션 취소 — 스마트 릴리스 (토큰 사용 있으면 부분 정산, 없으면 전액 환불). */
export function releaseAnalysisSession(
  sessionId: string,
): Promise<ReleaseResult | null> {
  return sessionFetch('/release', { session_id: sessionId }, 'release');
}
