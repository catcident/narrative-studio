/**
 * Billing API 클라이언트 서비스
 * 서버 사이드 프록시 (/api/billing/)를 통해 catcident billing API에 접근
 */

import type {
  BillingSubscription,
  CreditTransaction,
  PlanFeatures,
} from '../types';

const BASE = '/api/billing';

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
  try {
    const res = await fetch(`${BASE}/subscription`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('[billing] getSubscription error:', error);
    return null;
  }
}

// ==================== 크레딧 ====================

export async function getCreditBalance(): Promise<{ balance: number; plan: string } | null> {
  try {
    const res = await fetch(`${BASE}/credits/balance`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('[billing] getCreditBalance error:', error);
    return null;
  }
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
  try {
    const res = await fetch(`${BASE}/credits/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'storygraph',
        char_count: charCount,
        model,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('[billing] estimateCredits error:', error);
    return null;
  }
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
  try {
    const res = await fetch(`${BASE}/credits/transactions?page=${page}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('[billing] getUsageHistory error:', error);
    return null;
  }
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
  try {
    const res = await fetch(`${BASE}/plans`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || data;
  } catch (error) {
    console.error('[billing] getPlans error:', error);
    return [];
  }
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
  try {
    const res = await fetch(`${BASE}/packages`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || data;
  } catch (error) {
    console.error('[billing] getCreditPackages error:', error);
    return [];
  }
}
