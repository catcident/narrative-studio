/**
 * Server-side per-user balance cache for /api/analyze
 *
 * Prevents users with zero credits from calling OpenRouter.
 * Fail-open: if billing service is unreachable, analysis proceeds.
 * Only active when AUTH_ENABLED=true.
 */

import { AUTH_ENABLED } from '@/lib/auth';
import { ensureStorygraphSubscription, isConfigBillingBackendError } from '@/lib/billingBackend';

interface CacheEntry {
  balance: number;
  byok: boolean;
  planCode: string;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;

const balanceCache = new Map<string, CacheEntry>();

/** Evict entries older than TTL; if still over limit, evict oldest first */
function evictStaleEntries(): void {
  const now = Date.now();
  for (const [key, entry] of balanceCache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) {
      balanceCache.delete(key);
    }
  }

  if (balanceCache.size > MAX_CACHE_SIZE) {
    const entries = [...balanceCache.entries()].sort(
      (a, b) => a[1].cachedAt - b[1].cachedAt
    );
    const toEvict = entries.slice(0, balanceCache.size - MAX_CACHE_SIZE);
    for (const [key] of toEvict) {
      balanceCache.delete(key);
    }
  }
}

/**
 * Check whether the given user is eligible to run analysis.
 * Returns `null` if OK, or an error message string if blocked.
 * Requires pre-resolved auth (avoids double requireAuth() call in route).
 */
export async function checkAnalyzeEligibility(userId: string, accessToken: string | undefined): Promise<string | null> {
  // Skip check entirely when auth is disabled (public demo)
  if (!AUTH_ENABLED) {
    return null;
  }

  // Check cache first
  const cached = balanceCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    if (cached.balance > 0 || cached.byok) {
      return null;  // fast-pass
    }
    // 캐시된 zero/negative balance → 즉시 차단 (fresh fetch 불필요)
    console.log(`[analyze] Blocked zero-balance user (cached): ${userId}`);
    return 'Insufficient credits. Please purchase more credits to continue.';
  }

  // Fetch fresh subscription info (balance + byok) from billing service
  try {
    if (!accessToken) {
      return null;
    }

    const subscription = await ensureStorygraphSubscription(accessToken);
    if (!subscription) {
      return null;
    }
    const balance = subscription.credit_balance;
    const byok = subscription.features?.byok ?? false;
    const planCode = subscription.plan?.code ?? 'free';

    // Cache all balances (including zero/negative) to enable fast blocking.
    // Admin-added credits take effect after TTL (5min) — security over immediacy.
    evictStaleEntries();
    balanceCache.set(userId, { balance, byok, planCode, cachedAt: Date.now() });

    if (balance <= 0 && !byok) {
      console.log(`[analyze] Blocked zero-balance user: ${userId}`);
      return 'Insufficient credits. Please purchase more credits to continue.';
    }

    return null;
  } catch (err: unknown) {
    if (isConfigBillingBackendError(err)) {
      console.error(`[analyze] Billing configuration error: ${err.message}`);
      return 'Billing is unavailable for this service. Please contact support.';
    }

    // Network error or timeout — fail-open
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analyze] Balance check failed (allowing analysis): ${message}`);
    return null;
  }
}

/** deduct 응답 후 캐시 즉시 갱신 (byok 플래그는 기존 캐시에서 유지) */
export function updateBalanceCache(userId: string, balance: number): void {
  if (typeof balance !== 'number' || !Number.isFinite(balance)) {
    console.warn(`[analyze] Invalid balance value for cache update: ${balance}`);
    return;
  }
  const existing = balanceCache.get(userId);
  const byok = existing?.byok ?? false;
  const planCode = existing?.planCode ?? 'free';
  // Zero/negative balance도 캐싱하여 hold 직후 즉시 차단 가능
  evictStaleEntries();
  balanceCache.set(userId, { balance, byok, planCode, cachedAt: Date.now() });
}

/**
 * 캐시에서 BYOK 플래그 조회.
 * Fail-open: 캐시 미스 시 true 반환 (개인 키 사용 → 서버 비용 없음).
 * checkAnalyzeEligibility()가 먼저 실행되어 캐시를 갱신하므로,
 * 캐시 미스는 billing 서비스 장애를 의미 → fail-open 정책 적용.
 * AUTH_ENABLED=false 시 항상 false.
 */
export function isCachedByokEnabled(userId: string): boolean {
  if (!AUTH_ENABLED) return false;
  const cached = balanceCache.get(userId);
  if (!cached || Date.now() - cached.cachedAt > CACHE_TTL_MS) return true; // fail-open
  return cached.byok;
}

/** 캐시에서 planCode 조회. 캐시 미스 시 undefined 반환. */
export function getCachedPlanCode(userId: string): string | undefined {
  const cached = balanceCache.get(userId);
  if (!cached || Date.now() - cached.cachedAt > CACHE_TTL_MS) return undefined;
  return cached.planCode;
}
