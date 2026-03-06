/**
 * Billing API 클라이언트 서비스
 * 서버 사이드 프록시 (/api/billing/)를 통해 catcident billing API에 접근
 *
 * 과금 흐름 (세션 hold/settle/release):
 *   holdCredits(예상) → /api/analyze (토큰 정보만) → settleCredits(실제) / releaseCredits(취소)
 *
 * 크레딧 추정: creditsPerChunk/creditsPerChat 기반 (서버가 사전 계산한 값 사용)
 */

import type {
  BillingSubscription,
  CreditTransaction,
  PlanFeatures,
  ChunkUsage,
  ModelInfo,
} from '../types';
import { DEFAULT_MODEL, FALLBACK_MODELS, DEFAULT_CREDITS_PER_CHUNK, DEFAULT_CREDITS_PER_CHUNK_NO_LORE, DEFAULT_CREDITS_PER_CHAT } from '../types';
import type { ChunkBillingCallback } from './extraction/types';
import { countSmartChunks } from './extraction';
import {
  CHARS_PER_TOKEN, CHUNK_SIZE, CHUNK_OVERLAP, OUTPUT_RATIO,
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
  purchased_credit_balance: number;
  credit_reset_at: string | null;
  features: PlanFeatures;
  started_at: string;
  expires_at: string | null;
}

export async function getSubscription(): Promise<BillingResult<SubscriptionInfo>> {
  return billingFetch<SubscriptionInfo>('/subscription');
}

export function isBillingTestSubscription(
  subscription: Pick<BillingSubscription, 'plan'> | null | undefined,
): boolean {
  return subscription?.plan === 'billing-test';
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

/** 플랜 features → UI 표시용 문자열 배열 (SubscriptionPage, PricingSection 공용) */
export function buildPlanFeatureStrings(f: PlanFeatures): string[] {
  const out: string[] = [];

  if (f.models === 'all') {
    out.push('모든 AI 모델 사용');
  } else if (Array.isArray(f.models)) {
    out.push(`${f.models.length}개 AI 모델 사용`);
  }

  out.push(`최대 ${f.max_file_size_mb}MB 파일`);

  if (f.max_saved_graphs !== undefined) {
    out.push(f.max_saved_graphs === -1 ? '관계도 무제한 저장' : `관계도 ${f.max_saved_graphs.toLocaleString()}개 저장`);
  }

  if (f.max_chats_per_analysis !== undefined && f.max_chats_per_analysis !== -1) {
    out.push(`분석당 채팅 ${f.max_chats_per_analysis}회`);
  } else if (f.max_chats_per_analysis === -1) {
    out.push('채팅 횟수 무제한');
  }

  if (f.export_formats && f.export_formats.length > 0) {
    out.push(`${f.export_formats.map(s => s.toUpperCase()).join(', ')} 내보내기`);
  }

  if (f.can_purchase_credits) out.push('추가 크레딧 구매 가능');
  if (f.byok) out.push('개인 API 키 사용 (BYOK)');

  return out;
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
  chunks: number;
}

const ZERO_ESTIMATE: UsageEstimate = {
  estimated_credits: 0,
  estimated_input_tokens: 0,
  estimated_output_tokens: 0,
  chunks: 0,
};

/** 모델 정보 조회 (dynamicModels 우선, FALLBACK_MODELS 폴백) */
export function findModel(model: string, dynamicModels?: ModelInfo[]): ModelInfo | undefined {
  return dynamicModels?.find(m => m.id === model)
    ?? FALLBACK_MODELS.find(m => m.id === model);
}

/** 청크 수 → UsageEstimate 변환 (공통 헬퍼) */
function buildEstimate(chunks: number, model: string, dynamicModels?: ModelInfo[], enableLorebook: boolean = true): UsageEstimate {
  const modelInfo = findModel(model, dynamicModels);
  const cpc = enableLorebook
    ? (modelInfo?.creditsPerChunk ?? DEFAULT_CREDITS_PER_CHUNK)
    : (modelInfo?.creditsPerChunkNoLore ?? DEFAULT_CREDITS_PER_CHUNK_NO_LORE);
  const estimated_credits = Math.max(1, Math.ceil(cpc * chunks));

  const inputTokensPerChunk = Math.ceil(CHUNK_SIZE / CHARS_PER_TOKEN);
  const outputTokensPerChunk = Math.ceil(inputTokensPerChunk * OUTPUT_RATIO);

  return {
    estimated_credits,
    estimated_input_tokens: chunks * inputTokensPerChunk,
    estimated_output_tokens: chunks * outputTokensPerChunk,
    chunks,
  };
}

/**
 * 로컬에서 예상 사용량을 동기 계산 (API 호출 없음)
 *
 * creditsPerChunk 기반 추정 (USD 계산 없이 단순 곱셈).
 * 텍스트가 없는 경로(파일 미읽음, 이어하기)에서 폴백으로 사용.
 */
export function estimateUsageLocally(charCount: number, model: string, dynamicModels?: ModelInfo[], enableLorebook: boolean = true): UsageEstimate {
  if (charCount <= 0) return ZERO_ESTIMATE;

  const effectiveChunk = CHUNK_SIZE - CHUNK_OVERLAP;
  const chunks = Math.max(1, Math.ceil(charCount / effectiveChunk));

  return buildEstimate(chunks, model, dynamicModels, enableLorebook);
}

/**
 * 텍스트 기반 예상 사용량 계산 (스마트 청커 사용 — 정확한 청크 수)
 *
 * 실제 텍스트를 스마트 청커에 전달하여 장/화 경계 분할을 반영한 정확한 청크 수를 산출.
 * 텍스트가 있는 경로(직접 입력, 파일 읽기 후 hold, 추가 분석, 배치)에서 사용.
 */
export function estimateUsageFromText(text: string, model: string, dynamicModels?: ModelInfo[], enableLorebook: boolean = true): UsageEstimate {
  if (!text.trim()) return ZERO_ESTIMATE;

  const chunks = countSmartChunks(text);

  return buildEstimate(chunks, model, dynamicModels, enableLorebook);
}

// ==================== 크레딧 충분성 체크 ====================

export type CreditCheckLevel = 'ok' | 'caution' | 'warning' | 'blocked';

export interface CreditCheckResult {
  level: CreditCheckLevel;
  message?: string;
}

/**
 * 크레딧 충분성을 4단계로 판정.
 * - blocked: 진행 불가 (구독 미로딩 또는 잔액 0)
 * - warning: 잔액 < 추정 비용 (중단 가능성)
 * - caution: 잔액 < 2× 추정 비용 (넉넉하지 않음)
 * - ok: 충분
 */
export function checkCreditSufficiency(
  subscription: BillingSubscription | null,
  authEnabled?: boolean | null,
  estimatedCredits?: number,
): CreditCheckResult {
  // billing 비활성
  if (!subscription) {
    if (authEnabled !== false) {
      return { level: 'blocked', message: '구독 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.' };
    }
    return { level: 'ok' };
  }

  if (estimatedCredits === undefined || estimatedCredits <= 0) return { level: 'ok' };

  const balance = subscription.creditBalance;

  if (balance <= 0) {
    return { level: 'blocked', message: '크레딧이 없습니다.' };
  }

  if (balance < estimatedCredits) {
    return { level: 'warning', message: '크레딧이 부족하여 작업이 중단될 수 있습니다.' };
  }

  if (balance < 2 * estimatedCredits) {
    return { level: 'caution', message: '예상 비용에 비해 넉넉하지 않습니다 — 추정은 부정확할 수 있습니다.' };
  }

  return { level: 'ok' };
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
 * 구독이 활성화된 경우 잔액 부족(0) 시 에러를 throw.
 * subscription=null + authEnabled=false → billing 비활성 → 통과 (Railway 데모).
 * subscription=null + authEnabled=true → 구독 로딩 미완료/실패 → 에러 (프로덕션 보호).
 *
 * estimatedCredits 비교는 checkCreditSufficiency()가 사전 확인 담당.
 * 이 함수는 balance <= 0 체크 + subscription null 가드만 유지.
 */
export async function ensureSufficientBalance(
  subscription: BillingSubscription | null,
  authEnabled?: boolean | null,
): Promise<void> {
  if (!subscription) {
    if (authEnabled !== false) {
      throw new Error('구독 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
    }
    return;
  }
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

// ==================== 세션 정산 헬퍼 ====================

/** ChunkUsage[] → settle API에 전달할 형태로 변환 */
export function chunkUsageToSettleChunks(
  chunks: ChunkUsage[],
): Array<{ model: string; prompt_tokens: number; completion_tokens: number }> {
  return chunks.map(c => ({
    model: c.model,
    prompt_tokens: c.promptTokens,
    completion_tokens: c.completionTokens,
  }));
}

/** settle/release 결과 */
export interface FinalizeHoldResult {
  actualCredits: number | null;  // settle 시 실제 차감 크레딧, release 시 null
}

export async function finalizeHold(
  holdToken: string,
  chunks: ChunkUsage[],
  description: string,
  updateBalance: (balance: number) => void,
): Promise<FinalizeHoldResult> {
  if (chunks.length > 0) {
    const result = await settleCredits(holdToken, chunkUsageToSettleChunks(chunks), description);
    if (result.ok && result.data.balance_after !== null) {
      updateBalance(result.data.balance_after);
    }
    return { actualCredits: result.ok ? result.data.actual_credits : null };
  } else {
    const result = await releaseCredits(holdToken);
    if (result.ok && result.data.balance_after !== null) {
      updateBalance(result.data.balance_after);
    }
    return { actualCredits: null };
  }
}

// ==================== 잔액 알림 ====================

export type BalanceAlertLevel = 'none' | 'info' | 'warning' | 'critical';

export function getBalanceAlertLevel(
  creditBalance: number,
  monthlyCredits: number,
): BalanceAlertLevel {
  if (monthlyCredits <= 0) return 'none';
  if (creditBalance <= 0) return 'critical';
  const usedPercent = ((monthlyCredits - creditBalance) / monthlyCredits) * 100;
  if (usedPercent >= 90) return 'warning';
  if (usedPercent >= 75) return 'info';
  return 'none';
}

/**
 * 세션 수준 크레딧 계산 (고유 청크 수 × creditsPerChunk 기반 근사).
 * creditsPerChunk가 이미 extractor+selector+lorebook+merger 비용을 포함하므로,
 * 고유 청크 인덱스 수만으로 계산하여 이중 계산 방지.
 *
 * 정확도 참고: 실제 정산은 서버 settle이 수행. 이 함수는 UI 표시용 근사치(폴백).
 * 0토큰 엔트리(402 실패 청크)와 merger review sentinel은 제외하여 과추정 방지.
 */
export function calculateSessionCreditsFromChunks(chunks: ChunkUsage[], dynamicModels?: ModelInfo[]): number {
  if (chunks.length === 0) return 0;

  // 실제 토큰 사용이 있는 엔트리만 필터 (402 실패로 0토큰인 청크 제외)
  const effectiveChunks = chunks.filter(c => c.promptTokens > 0 || c.completionTokens > 0);
  if (effectiveChunks.length === 0) return 0;

  // 고유 청크 인덱스 수 = 실제 분석 성공한 청크 수
  const chunkIndices = new Set(effectiveChunks.map(c => c.chunkIndex));

  // 가장 많이 사용된 모델의 creditsPerChunk 사용
  const modelCounts = new Map<string, number>();
  for (const chunk of effectiveChunks) {
    modelCounts.set(chunk.model, (modelCounts.get(chunk.model) ?? 0) + 1);
  }
  let dominantModel = '';
  let maxCount = 0;
  for (const [model, count] of modelCounts) {
    if (count > maxCount) { dominantModel = model; maxCount = count; }
  }

  const modelInfo = findModel(dominantModel, dynamicModels);
  const cpc = modelInfo?.creditsPerChunk ?? DEFAULT_CREDITS_PER_CHUNK;

  return Math.max(1, Math.ceil(cpc * chunkIndices.size));
}

// ==================== 로어북 전용 비용 추정 ====================

/**
 * 로어북만 추출할 때의 비용 추정.
 * creditsPerChunk와 creditsPerChunkNoLore의 차이로 로어북 비용만 산출.
 */
export function estimateLorebookOnlyCost(
  charCount: number,
  model: string,
  dynamicModels?: ModelInfo[],
): { credits: number; chunks: number } {
  if (charCount <= 0) return { credits: 0, chunks: 0 };

  const effectiveChunk = CHUNK_SIZE - CHUNK_OVERLAP;
  const chunks = Math.max(1, Math.ceil(charCount / effectiveChunk));

  const modelInfo = findModel(model, dynamicModels);
  const cpc = modelInfo?.creditsPerChunk ?? DEFAULT_CREDITS_PER_CHUNK;
  const cpcNoLore = modelInfo?.creditsPerChunkNoLore ?? DEFAULT_CREDITS_PER_CHUNK_NO_LORE;
  const loreCostPerChunk = Math.max(0, cpc - cpcNoLore);

  return {
    credits: Math.max(1, Math.ceil(loreCostPerChunk * chunks)),
    chunks,
  };
}

// ==================== 검증 비용 추정 ====================

/**
 * 검증 비용 추정 (파일 수 기반).
 * 첫 파일은 자동 통과 → 실제 LLM 호출은 (fileCount - 1)회.
 */
export function estimateValidationCost(
  fileCount: number,
  model?: string,
  dynamicModels?: ModelInfo[],
): number {
  const callCount = Math.max(0, fileCount - 1); // 첫 파일 자동 통과
  if (callCount === 0) return 0;

  const validationModel = model ?? DEFAULT_MODEL;
  const modelInfo = findModel(validationModel, dynamicModels);
  return Math.max(1, Math.ceil((modelInfo?.creditsPerChunk ?? DEFAULT_CREDITS_PER_CHUNK) * callCount));
}
