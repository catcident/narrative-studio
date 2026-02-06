/**
 * Server-side per-user balance cache for /api/analyze
 *
 * Prevents users with zero credits from calling OpenRouter.
 * Fail-open: if billing service is unreachable, analysis proceeds.
 * Only active when AUTH_ENABLED=true.
 */

import { AUTH_ENABLED } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';

interface CacheEntry {
  balance: number;
  byok: boolean;
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

  // Check cache first — positive balances or BYOK users pass immediately
  const cached = balanceCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS && (cached.balance > 0 || cached.byok)) {
    return null;
  }

  // Fetch fresh subscription info (balance + byok) from billing service
  try {
    const response = await proxyToCatcident(
      '/subscription/?service=storygraph',
      accessToken
    );

    if (!response.ok) {
      // Billing service returned an error — fail-open
      console.error(`[analyze] Balance check upstream error ${response.status}, allowing analysis`);
      return null;
    }

    const data: { credit_balance: number; features?: { byok?: boolean } } = await response.json();
    const balance = data.credit_balance;
    const byok = data.features?.byok ?? false;

    // Cache positive balances; also cache zero balances if BYOK (they don't need credits).
    // Non-BYOK zero balances are not cached so admin-added credits take effect immediately.
    if (balance > 0 || byok) {
      evictStaleEntries();
      balanceCache.set(userId, { balance, byok, cachedAt: Date.now() });
    } else {
      balanceCache.delete(userId);
    }

    if (balance <= 0 && !byok) {
      console.log(`[analyze] Blocked zero-balance user: ${userId}`);
      return 'Insufficient credits. Please purchase more credits to continue.';
    }

    return null;
  } catch (err: unknown) {
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
  // BYOK 사용자는 zero balance여도 캐시 유지 (크레딧 불필요)
  if (balance > 0 || byok) {
    balanceCache.set(userId, { balance, byok, cachedAt: Date.now() });
  } else {
    balanceCache.delete(userId);
  }
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

