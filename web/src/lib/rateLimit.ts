/**
 * 서버 사이드 인메모리 Rate Limiter
 *
 * 슬라이딩 윈도우 방식으로 사용자별 API 호출을 제한한다.
 */

interface RateWindow {
  timestamps: number[];
}

const windows = new Map<string, RateWindow>();

const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_WINDOW_MS = 60_000; // 1분
const MAX_ENTRIES = 10_000;

/** 플랜별 분당 요청 제한 */
const PLAN_RATE_LIMITS: Record<string, number> = {
  free: 30,
  basic: 60,
  pro: 120,
  business: 240,
};

/** planCode에 해당하는 분당 요청 제한 반환 */
export function getRateLimitForPlan(planCode?: string): number {
  if (!planCode) return DEFAULT_MAX_REQUESTS;
  return PLAN_RATE_LIMITS[planCode] ?? DEFAULT_MAX_REQUESTS;
}

function evict(windowMs: number): void {
  if (windows.size <= MAX_ENTRIES) return;
  const cutoff = Date.now() - windowMs * 2;
  for (const [key, win] of windows) {
    if (win.timestamps.length === 0 || win.timestamps[win.timestamps.length - 1] < cutoff) {
      windows.delete(key);
    }
  }
}

/**
 * Rate limit 체크.
 * @returns null이면 통과, { retryAfterMs }이면 제한
 */
export function checkRateLimit(
  key: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
): { retryAfterMs: number } | null {
  const now = Date.now();
  const cutoff = now - windowMs;

  let win = windows.get(key);
  if (!win) {
    win = { timestamps: [] };
    windows.set(key, win);
  }

  win.timestamps = win.timestamps.filter(t => t > cutoff);

  if (win.timestamps.length >= maxRequests) {
    const oldestInWindow = win.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    return { retryAfterMs: Math.max(0, retryAfterMs) };
  }

  win.timestamps.push(now);
  evict(windowMs);
  return null;
}
