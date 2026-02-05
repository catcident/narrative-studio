/**
 * Billing API 클라이언트 서비스
 * 서버 사이드 프록시 (/api/billing/)를 통해 catcident billing API에 접근
 */

import type {
  BillingSubscription,
  CreditTransaction,
  PlanFeatures,
} from '../types';
import { AVAILABLE_MODELS } from '../types';

const BASE = '/api/billing';

// ==================== 공통 fetcher ====================

async function billingFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, init);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error(`[billing] ${path} error:`, error);
    return null;
  }
}

async function billingFetchList<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return [];
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

export async function estimateCredits(
  charCount: number,
  model: string
): Promise<UsageEstimate | null> {
  return billingFetch<UsageEstimate>('/credits/estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service: 'storygraph',
      char_count: charCount,
      model,
    }),
  });
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
  idempotencyKey?: string
): Promise<DeductResult | null> {
  try {
    const res = await fetch(`${BASE}/credits/deduct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'storygraph',
        amount,
        description,
        metadata,
        idempotency_key: idempotencyKey,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[billing] deductCredits error:', err);
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error('[billing] deductCredits error:', error);
    return null;
  }
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
// 동기화 대상: catcident-backend apps/business/billing/services/estimator.py StorygraphEstimator

const CHARS_PER_TOKEN = 1.5;
const CHUNK_SIZE = 5000;
const CHUNK_OVERLAP = 300;
const OUTPUT_RATIO = 0.45;
const MARGIN = 3.0;
const USD_TO_KRW = 1400;
const KRW_PER_CREDIT = 10;
const DEFAULT_INPUT_COST = 1.0;  // per 1M tokens
const DEFAULT_OUTPUT_COST = 5.0; // per 1M tokens

function getModelCosts(model: string): { inputCost: number; outputCost: number } {
  const found = AVAILABLE_MODELS.find((m) => m.id === model);
  return found
    ? { inputCost: found.inputCost, outputCost: found.outputCost }
    : { inputCost: DEFAULT_INPUT_COST, outputCost: DEFAULT_OUTPUT_COST };
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
  const totalTokens = Math.ceil(charCount / CHARS_PER_TOKEN);
  const inputTokens = Math.ceil(totalTokens * (1 / (1 + OUTPUT_RATIO)));
  const outputTokens = totalTokens - inputTokens;

  const { inputCost, outputCost } = getModelCosts(model);
  const costUsd = (inputTokens / 1_000_000) * inputCost + (outputTokens / 1_000_000) * outputCost;
  const credits = Math.max(1, Math.ceil(costUsd * USD_TO_KRW * MARGIN / KRW_PER_CREDIT));

  return {
    estimated_credits: credits,
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
  const costUsd = (promptTokens / 1_000_000) * inputCost + (completionTokens / 1_000_000) * outputCost;
  return Math.max(1, Math.ceil(costUsd * USD_TO_KRW * MARGIN / KRW_PER_CREDIT));
}
