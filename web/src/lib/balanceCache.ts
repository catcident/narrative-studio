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

  // Check cache first — only positive balances are cached
  const cached = balanceCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS && cached.balance > 0) {
    return null;
  }

  // Fetch fresh balance from billing service
  try {
    const response = await proxyToCatcident(
      '/credits/balance/?service=storygraph',
      accessToken
    );

    if (!response.ok) {
      // Billing service returned an error — fail-open
      console.error(`[analyze] Balance check upstream error ${response.status}, allowing analysis`);
      return null;
    }

    const data: { balance: number } = await response.json();

    // Only cache positive balances — zero/negative must always be re-checked
    // so that admin-added credits take effect immediately
    if (data.balance > 0) {
      evictStaleEntries();
      balanceCache.set(userId, {
        balance: data.balance,
        cachedAt: Date.now(),
      });
    } else {
      balanceCache.delete(userId);
    }

    if (data.balance <= 0) {
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

/** deduct 응답 후 캐시 즉시 갱신 */
export function updateBalanceCache(userId: string, balance: number): void {
  if (typeof balance !== 'number' || !Number.isFinite(balance)) {
    console.warn(`[analyze] Invalid balance value for cache update: ${balance}`);
    return;
  }
  if (balance > 0) {
    balanceCache.set(userId, { balance, cachedAt: Date.now() });
  } else {
    balanceCache.delete(userId);
  }
}

