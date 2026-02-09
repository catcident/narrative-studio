# Billing Security Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 분석과 과금의 분리 문제를 해결하여, 크레딧 없이 LLM 분석을 이용하거나 차감을 회피하는 편법을 원천 차단한다.

**Architecture:** 2-Phase 접근. Phase 1은 Next.js 서버만 수정하여 즉시 방어선을 확보한다 (잔액 0 사용자 차단, 차감 실패 표면화, rate limiting). Phase 2는 catcident-backend에 CreditHold 모델을 추가하고 Next.js에 분석 세션 개념을 도입하여, 선차감(hold) → 서버 측 토큰 추적 → 정산(settle) 흐름으로 전환한다. 클라이언트는 차감 금액을 결정하지 않으며, 서버가 OpenRouter 응답에서 직접 토큰을 누적하고 크레딧을 계산한다.

**Tech Stack:** Next.js 15 (App Router), Django 5 (DRF), Zustand, TypeScript 5.9, Celery

**분기 전략:** `feature/billing-integration` 브랜치에서 계속 작업. Phase별 커밋 그룹으로 구분.

---

## 프로젝트 규칙 체크리스트 (모든 Task에 적용)

아래 규칙을 모든 코드 변경에 적용한다. 위반 시 커밋 전에 수정.

### 백엔드 (catcident-backend)
- [ ] 서비스 클래스: `@staticmethod` + `@transaction.atomic` + `select_for_update()`
- [ ] 모델 verbose_name: `'B0N. 한국어명'` 패턴 (기존 B05까지 사용)
- [ ] 상수: 별도 클래스 + `CHOICES` 리스트 패턴 (기존 `SubscriptionStatus` 참조)
- [ ] 시리얼라이저: read-only ModelSerializer / write용 일반 Serializer 분리
- [ ] 뷰: `APIView` (커스텀 로직) 또는 `generics.ListAPIView` (목록)
- [ ] 에러: `ValidationError` 상속, HTTP 402 for 잔액 부족
- [ ] 로깅: `logger.info("한국어: key=%s", value)` 패턴
- [ ] URL: `app_name = 'billing'`, trailing slash 사용

### 프론트엔드 (narrative-studio/web)
- [ ] 프록시: `billingGetHandler`/`billingPostHandler` 팩토리 사용, 불가능하면 동일 패턴의 커스텀 핸들러
- [ ] POST 화이트리스트: `ALLOWED_POST_FIELDS`에 새 경로 등록
- [ ] `service: 'storygraph'` 서버 강제 주입
- [ ] 클라이언트: `billingFetch<T>()` 패턴, 실패 시 `null` 반환, `[billing]` 로깅
- [ ] 에러 메시지: 백엔드 상세 노출 금지, generic 메시지 반환
- [ ] 타입: `catch (err: unknown)` + 타입 가드
- [ ] Discriminated union: type narrowing 후 접근, destructuring 금지
- [ ] Store: 개별 셀렉터 훅, `useStore()` 전체 구독 금지
- [ ] useEffect: `cancelled` 플래그로 stale update 방지
- [ ] 접근성: 아이콘 `aria-hidden="true"`, 모달 `tabIndex={-1}` + Escape
- [ ] Idempotency key: 결정론적 값만, `Date.now()` 금지
- [ ] `AUTH_ENABLED=false` 환경: 모든 billing 기능 graceful 비활성화

---

## Phase 1: 즉시 방어선 확보 (Next.js만 수정)

### Task 1: `/api/analyze`에 서버 측 잔액 체크 추가

**목적:** 잔액 0 이하인 사용자가 OpenRouter API를 호출하지 못하도록 서버에서 차단.

**Files:**
- Create: `web/src/lib/balanceCache.ts`
- Modify: `web/src/app/api/analyze/route.ts`

**Step 1: 잔액 캐시 유틸리티 생성**

`web/src/lib/balanceCache.ts` — 사용자별 잔액을 5분간 캐시하여 매 청크마다 backend 호출을 피한다.

```typescript
// web/src/lib/balanceCache.ts
/**
 * 서버 사이드 사용자별 잔액 캐시
 *
 * /api/analyze 호출 시 매번 catcident-backend에 잔액을 조회하면 지연이 발생하므로,
 * 사용자별로 5분간 캐시한다. 정확한 잔액은 hold/deduct 시점에 backend가 보장.
 */

import { AUTH_ENABLED, requireAuth } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

interface CachedBalance {
  balance: number;
  cachedAt: number;
}

const cache = new Map<string, CachedBalance>();

/** 만료된 캐시 항목 정리 (100개 초과 시) */
function evictStale(): void {
  if (cache.size <= 100) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}

/**
 * 사용자 잔액이 0 이하인지 서버 사이드에서 확인.
 * AUTH_ENABLED=false 이면 항상 통과.
 * 캐시 미스 시 catcident-backend에 1회 조회.
 *
 * @returns null이면 통과, string이면 차단 사유
 */
export async function checkAnalyzeEligibility(): Promise<string | null> {
  if (!AUTH_ENABLED) return null;

  const authResult = await requireAuth();
  if ('error' in authResult) return 'Unauthorized';

  const userId = authResult.userId;
  const now = Date.now();

  // 캐시 히트
  const cached = cache.get(userId);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.balance > 0 ? null : '크레딧이 부족합니다.';
  }

  // 캐시 미스 — backend 조회
  try {
    const response = await proxyToCatcident(
      '/credits/balance/?service=storygraph',
      authResult.accessToken,
    );
    if (!response.ok) {
      // backend 에러 시 통과 (billing 장애가 분석을 막지 않도록)
      console.error('[analyze] balance check upstream error:', response.status);
      return null;
    }
    const data = await response.json();
    const balance = data.balance ?? 0;

    evictStale();
    cache.set(userId, { balance, cachedAt: now });

    return balance > 0 ? null : '크레딧이 부족합니다.';
  } catch (err: unknown) {
    console.error('[analyze] balance check error:', err instanceof Error ? err.message : err);
    return null; // 장애 시 통과
  }
}

/** 특정 사용자의 캐시를 무효화 (차감/충전 후 호출) */
export function invalidateBalanceCache(userId: string): void {
  cache.delete(userId);
}
```

**설계 결정:**
- 장애 시 통과(fail-open): billing 서비스 장애가 분석 기능을 중단시키지 않음
- 캐시 TTL 5분: hold 시스템 도입 전까지의 임시 방어선, 정확한 검증은 deduct 시점
- `requireAuth()` 재사용: 기존 인증 패턴 준수
- `proxyToCatcident()` 재사용: 기존 프록시 함수로 backend 통신

**Step 2: `/api/analyze` 라우트에 잔액 체크 통합**

`web/src/app/api/analyze/route.ts` — POST 핸들러 상단에 잔액 체크 추가.

```typescript
// route.ts 상단에 import 추가
import { checkAnalyzeEligibility } from '@/lib/balanceCache';

// POST 핸들러 내부, apiKey 검증 후, OpenRouter 호출 전에 추가:
  // 잔액 사전 확인 (AUTH_ENABLED=true일 때만)
  const balanceError = await checkAnalyzeEligibility();
  if (balanceError) {
    return NextResponse.json({ error: balanceError }, { status: 402 });
  }
```

삽입 위치: apiKey 존재 확인 (`if (!apiKey)`) 블록 바로 다음.

**Step 3: 타입 체크 및 빌드 검증**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -v "src/main.tsx"
cd web && npm run build
```

**Step 4: 커밋**

```bash
git add web/src/lib/balanceCache.ts web/src/app/api/analyze/route.ts
git commit -m "feat(billing): add server-side balance check to /api/analyze

Block users with zero credits from calling OpenRouter API.
Uses 5-minute per-user cache to avoid per-chunk backend calls.
Fail-open on billing service errors."
```

---

### Task 2: 차감 실패 시 에러 표면화

**목적:** 현재 `deductAfterSave`가 실패해도 에러가 삼켜져 사용자가 인지하지 못함. 실패를 명시적으로 표면화하여 미정산 상태를 방지.

**Files:**
- Modify: `web/src/services/billing.ts` (`deductUsage` 함수)
- Modify: `web/src/components/FileUpload/FileUpload.tsx` (`saveAndDeduct`, `runExtraction`)

**Step 1: `deductUsage`에서 실패 시 예외 throw 옵션 추가**

`web/src/services/billing.ts` — `deductUsage` 함수 수정:

```typescript
/** 공통 크레딧 차감 헬퍼 — throwOnFail=true이면 차감 실패 시 예외 발생 */
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
```

`deductAfterSave`에 `throwOnFail: true` 전달:

```typescript
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
    true, // ← 정상 완료 경로에서는 차감 실패를 표면화
  );
}
```

`deductPartial`은 변경하지 않음 — 에러 경로에서 추가 에러를 던지면 원래 에러가 가려짐.

**Step 2: FileUpload에서 차감 실패 에러를 사용자에게 표시**

`web/src/components/FileUpload/FileUpload.tsx` — `saveAndDeduct` 함수:

현재 `saveAndDeduct` 내부에서 `deductAfterSave`가 throw하면, `runExtraction`의 catch 블록이 잡아서 `setError()`로 표시함. 이미 그래프는 저장된 상태이므로 저장 결과는 유지되면서 에러 메시지만 표시됨.

**추가 수정**: `runExtraction` catch 블록에서 차감 실패와 분석 실패를 구분:

```typescript
// runExtraction catch 블록 내부, deductPartial 호출 전:
} catch (err: unknown) {
  console.error('[extraction] error:', err);
  const message = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';

  // 차감 실패 에러는 partial deduct를 하지 않음 (이미 save 완료 후 deduct 실패)
  const isDeductError = message.includes('크레딧 차감에 실패');
  if (subscription && !isDeductError) {
    const { currentUsage, loadSubscription } = useStore.getState();
    await deductPartial(title, currentUsage, updateCreditBalance, loadSubscription);
  }
  setError(message);
  resetProgressState(true);
}
```

**Step 3: 타입 체크 및 빌드 검증**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -v "src/main.tsx"
cd web && npm run build
```

**Step 4: 커밋**

```bash
git add web/src/services/billing.ts web/src/components/FileUpload/FileUpload.tsx
git commit -m "feat(billing): surface deduction failures to user

deductAfterSave now throws on failure so users see the error.
deductPartial remains silent (error path should not mask original error).
Distinguish deduction errors from analysis errors in catch block."
```

---

### Task 3: `/api/analyze` Rate Limiting

**목적:** 인증된 사용자가 `/api/analyze`를 무제한 호출하여 OpenRouter 비용을 전가하는 것을 방지.

**Files:**
- Create: `web/src/lib/rateLimit.ts`
- Modify: `web/src/app/api/analyze/route.ts`

**Step 1: Rate limiter 유틸리티 생성**

`web/src/lib/rateLimit.ts` — 슬라이딩 윈도우 기반 사용자별 rate limiter.

```typescript
// web/src/lib/rateLimit.ts
/**
 * 서버 사이드 인메모리 Rate Limiter
 *
 * 슬라이딩 윈도우 방식으로 사용자별 API 호출을 제한한다.
 * Next.js 서버 프로세스 내 메모리에 저장되므로 서버 재시작 시 초기화.
 */

interface RateWindow {
  timestamps: number[];
}

const windows = new Map<string, RateWindow>();

const DEFAULT_MAX_REQUESTS = 60;  // 윈도우당 최대 요청
const DEFAULT_WINDOW_MS = 60_000; // 1분 윈도우
const MAX_ENTRIES = 10_000;       // 메모리 상한

/** 오래된 엔트리 정리 */
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
 *
 * @param key 사용자 식별자 (userId)
 * @param maxRequests 윈도우 내 최대 요청 수
 * @param windowMs 윈도우 크기 (ms)
 * @returns null이면 통과, { retryAfterMs } 이면 제한
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

  // 윈도우 밖 타임스탬프 제거
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
```

**Step 2: `/api/analyze`에 rate limiting 적용**

`web/src/app/api/analyze/route.ts` — 잔액 체크 바로 뒤에 추가:

```typescript
import { checkRateLimit } from '@/lib/rateLimit';
import { AUTH_ENABLED, getAuthUserId } from '@/lib/auth';

// POST 핸들러 내부, balanceCheck 후:
  // Rate limiting (AUTH_ENABLED=true일 때만)
  if (AUTH_ENABLED) {
    const userId = await getAuthUserId();
    const limited = checkRateLimit(userId);
    if (limited) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) } },
      );
    }
  }
```

**설계 결정:**
- `AUTH_ENABLED=false` 환경에서는 rate limiting 비활성 (공개 데모)
- 분당 60회: 청크당 2회 LLM 호출 × 최대 30청크 = 충분한 여유
- 메모리 상한 10,000 엔트리: 서버 메모리 보호
- `Retry-After` 헤더: HTTP 429 표준 준수

**Step 3: 타입 체크 및 빌드 검증**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -v "src/main.tsx"
cd web && npm run build
```

**Step 4: 커밋**

```bash
git add web/src/lib/rateLimit.ts web/src/app/api/analyze/route.ts
git commit -m "feat(billing): add per-user rate limiting to /api/analyze

Sliding window rate limiter: 60 requests/minute per user.
Only active when AUTH_ENABLED=true.
Returns 429 with Retry-After header when exceeded."
```

---

## Phase 2: Credit Hold/Settle 시스템 + 서버 측 토큰 추적

### Task 4: Backend — CreditHold 모델 + 마이그레이션

**목적:** 분석 시작 전 예상 크레딧을 선차감(hold)하고, 분석 완료 후 실제 사용량으로 정산(settle)하기 위한 모델.

**Files:**
- Modify: `catcident-backend/apps/business/billing/models.py`
- Run: `python manage.py makemigrations billing`

**Step 1: HoldStatus 상수 + CreditHold 모델 추가**

`models.py` 파일 끝에 추가:

```python
class HoldStatus:
    """크레딧 예약 상태"""
    HELD = 'held'
    SETTLED = 'settled'
    RELEASED = 'released'
    EXPIRED = 'expired'

    CHOICES = [
        (HELD, '예약 중'),
        (SETTLED, '정산 완료'),
        (RELEASED, '예약 취소'),
        (EXPIRED, '만료'),
    ]


class CreditHold(BaseModel):
    """
    크레딧 예약 (Hold)

    분석 시작 전 예상 크레딧을 잔액에서 선차감하고,
    분석 완료 후 실제 사용량으로 정산(settle)하거나 취소(release)한다.
    TTL 초과 시 Celery 태스크가 자동 만료 처리.
    """
    subscription = models.ForeignKey(
        ServiceSubscription,
        on_delete=models.CASCADE,
        related_name='credit_holds',
        verbose_name='구독',
    )
    amount = models.IntegerField(verbose_name='예약 금액')
    status = models.CharField(
        max_length=20,
        choices=HoldStatus.CHOICES,
        default=HoldStatus.HELD,
        verbose_name='상태',
    )
    hold_token = models.UUIDField(
        unique=True,
        default=uuid.uuid4,
        verbose_name='예약 토큰',
    )
    metadata = models.JSONField(default=dict, blank=True, verbose_name='메타데이터')
    expires_at = models.DateTimeField(verbose_name='만료 시각')
    settled_amount = models.IntegerField(
        null=True, blank=True, verbose_name='정산 금액',
    )

    class Meta:
        verbose_name = 'B06. 크레딧 예약'
        verbose_name_plural = 'B06. 크레딧 예약'
        indexes = [
            models.Index(fields=['status', 'expires_at']),
            models.Index(fields=['subscription', '-created_at']),
        ]

    def __str__(self):
        return f'Hold {self.hold_token} ({self.status}): {self.amount}'
```

파일 상단에 `import uuid` 추가 필요.

**Step 2: Admin 등록**

`admin.py`에 추가:

```python
@admin.register(CreditHold)
class CreditHoldAdmin(admin.ModelAdmin):
    list_display = ('hold_token', 'subscription', 'amount', 'status', 'expires_at', 'created_at')
    list_filter = ('status',)
    readonly_fields = ('hold_token', 'created_at', 'updated_at')
    raw_id_fields = ('subscription',)
```

**Step 3: 마이그레이션 생성 및 적용**

```bash
cd /Users/idencosmos/Projects/catcident-backend
docker compose run --rm api python manage.py makemigrations billing
docker compose run --rm api python manage.py migrate billing
```

**Step 4: 커밋**

```bash
git add apps/business/billing/models.py apps/business/billing/admin.py apps/business/billing/migrations/
git commit -m "feat(billing): add CreditHold model for credit reservation

Hold/settle/release lifecycle with 30-minute TTL.
UUID hold_token for secure identification.
Indexes on (status, expires_at) for Celery expiry task."
```

---

### Task 5: Backend — HoldService 구현

**목적:** hold/settle/release/expire 비즈니스 로직을 서비스 레이어에 구현.

**Files:**
- Create: `catcident-backend/apps/business/billing/services/hold_service.py`
- Modify: `catcident-backend/apps/business/billing/services/__init__.py` (필요 시)

**Step 1: HoldService 구현**

```python
# apps/business/billing/services/hold_service.py
"""
크레딧 예약(Hold) 서비스

분석 시작 전 예상 크레딧을 선차감하고,
분석 완료 후 실제 사용량으로 정산한다.
"""

import logging

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from datetime import timedelta

from ..models import (
    CreditHold,
    CreditLedger,
    HoldStatus,
    ServiceSubscription,
    TransactionType,
)
from .credit_service import InsufficientCreditsError

logger = logging.getLogger(__name__)

DEFAULT_HOLD_TTL_MINUTES = 30


class HoldService:
    """크레딧 예약/정산/취소 서비스"""

    @staticmethod
    @transaction.atomic
    def hold(subscription_id, amount, metadata=None, ttl_minutes=DEFAULT_HOLD_TTL_MINUTES):
        """
        크레딧 예약 — 잔액에서 예상 금액을 선차감.

        Args:
            subscription_id: ServiceSubscription PK
            amount: 예약할 크레딧 (양수)
            metadata: 추가 메타데이터 (model, char_count 등)
            ttl_minutes: 예약 유효 시간 (분)

        Returns:
            CreditHold

        Raises:
            InsufficientCreditsError: 잔액 부족
        """
        if amount <= 0:
            raise ValidationError('예약 금액은 양수여야 합니다.')

        subscription = ServiceSubscription.objects.select_for_update().get(
            pk=subscription_id
        )

        if subscription.credit_balance < amount:
            raise InsufficientCreditsError(
                f'크레딧 잔액이 부족합니다. 필요: {amount}, 잔액: {subscription.credit_balance}'
            )

        subscription.credit_balance -= amount
        subscription.save(update_fields=['credit_balance', 'updated_at'])

        hold = CreditHold.objects.create(
            subscription=subscription,
            amount=amount,
            metadata=metadata or {},
            expires_at=timezone.now() + timedelta(minutes=ttl_minutes),
        )

        logger.info(
            "크레딧 예약: subscription_id=%s, amount=%d, balance=%d, hold_token=%s",
            subscription_id, amount, subscription.credit_balance, hold.hold_token,
        )
        return hold

    @staticmethod
    @transaction.atomic
    def settle(hold_token, actual_amount, description, metadata=None, idempotency_key=None):
        """
        예약 정산 — 실제 사용량으로 정산하고 차액을 환불/추가 차감.

        실제 금액 < 예약 금액: 차액을 잔액에 환불
        실제 금액 > 예약 금액: 추가 차감 시도 (잔액 부족 시 잔액만큼만)
        실제 금액 = 0: 전액 환불 (사실상 release와 동일)

        Args:
            hold_token: CreditHold UUID
            actual_amount: 실제 사용 크레딧 (0 이상)
            description: 원장 기록용 설명
            metadata: 원장 메타데이터
            idempotency_key: 중복 정산 방지 키

        Returns:
            dict: { balance_after, amount_deducted, refunded, hold_token }
        """
        if actual_amount < 0:
            raise ValidationError('정산 금액은 0 이상이어야 합니다.')

        # 멱등성 키 확인
        if idempotency_key:
            existing = CreditLedger.objects.filter(idempotency_key=idempotency_key).first()
            if existing:
                logger.info("중복 정산 요청 무시: idempotency_key=%s", idempotency_key)
                return {
                    'balance_after': existing.balance_after,
                    'amount_deducted': abs(existing.amount),
                    'refunded': 0,
                    'hold_token': str(hold_token),
                }

        hold = CreditHold.objects.select_for_update().get(
            hold_token=hold_token, status=HoldStatus.HELD,
        )
        subscription = ServiceSubscription.objects.select_for_update().get(
            pk=hold.subscription_id
        )

        diff = hold.amount - actual_amount
        refunded = 0

        if diff > 0:
            # 예약보다 적게 사용 → 차액 환불
            subscription.credit_balance += diff
            refunded = diff
        elif diff < 0:
            # 예약보다 많이 사용 → 추가 차감 (잔액 한도 내)
            extra_needed = -diff
            extra_charge = min(extra_needed, subscription.credit_balance)
            subscription.credit_balance -= extra_charge
            actual_amount = hold.amount + extra_charge  # 실제 차감액 조정

        subscription.save(update_fields=['credit_balance', 'updated_at'])

        # 원장 기록 (실제 차감 금액 기준)
        ledger = CreditLedger.objects.create(
            subscription=subscription,
            amount=-actual_amount,
            balance_after=subscription.credit_balance,
            tx_type=TransactionType.USAGE,
            description=description,
            metadata=metadata or {},
            idempotency_key=idempotency_key,
        )

        hold.status = HoldStatus.SETTLED
        hold.settled_amount = actual_amount
        hold.save(update_fields=['status', 'settled_amount', 'updated_at'])

        logger.info(
            "크레딧 정산: hold_token=%s, held=%d, actual=%d, refunded=%d, balance=%d",
            hold_token, hold.amount, actual_amount, refunded, subscription.credit_balance,
        )
        return {
            'balance_after': subscription.credit_balance,
            'amount_deducted': actual_amount,
            'refunded': refunded,
            'hold_token': str(hold_token),
            'ledger_id': ledger.id,
        }

    @staticmethod
    @transaction.atomic
    def release(hold_token):
        """
        예약 취소 — 전액 환불.

        Args:
            hold_token: CreditHold UUID

        Returns:
            dict: { balance_after, refunded, hold_token }
        """
        hold = CreditHold.objects.select_for_update().get(
            hold_token=hold_token, status=HoldStatus.HELD,
        )
        subscription = ServiceSubscription.objects.select_for_update().get(
            pk=hold.subscription_id
        )

        subscription.credit_balance += hold.amount
        subscription.save(update_fields=['credit_balance', 'updated_at'])

        hold.status = HoldStatus.RELEASED
        hold.settled_amount = 0
        hold.save(update_fields=['status', 'settled_amount', 'updated_at'])

        logger.info(
            "크레딧 예약 취소: hold_token=%s, refunded=%d, balance=%d",
            hold_token, hold.amount, subscription.credit_balance,
        )
        return {
            'balance_after': subscription.credit_balance,
            'refunded': hold.amount,
            'hold_token': str(hold_token),
        }

    @staticmethod
    def expire_stale_holds():
        """
        만료된 Hold를 자동 정산 — 예약 금액 전액을 사용한 것으로 처리.

        Celery daily task에서 호출.

        Returns:
            int: 처리된 Hold 수
        """
        now = timezone.now()
        expired = CreditHold.objects.filter(
            status=HoldStatus.HELD, expires_at__lte=now,
        )
        count = 0

        for hold in expired:
            try:
                with transaction.atomic():
                    # 재조회 (select_for_update)
                    h = CreditHold.objects.select_for_update().get(
                        pk=hold.pk, status=HoldStatus.HELD,
                    )
                    h.status = HoldStatus.EXPIRED
                    h.settled_amount = h.amount  # 전액 사용 처리
                    h.save(update_fields=['status', 'settled_amount', 'updated_at'])

                    # 원장 기록
                    sub = ServiceSubscription.objects.get(pk=h.subscription_id)
                    CreditLedger.objects.create(
                        subscription=sub,
                        amount=-h.amount,
                        balance_after=sub.credit_balance,
                        tx_type=TransactionType.USAGE,
                        description=f'분석 세션 만료 (자동 정산)',
                        metadata={'hold_token': str(h.hold_token), 'expired': True},
                    )
                    count += 1
            except CreditHold.DoesNotExist:
                continue  # 다른 프로세스가 이미 처리
            except Exception:
                logger.exception("Hold 만료 처리 실패: hold_id=%s", hold.pk)

        if count > 0:
            logger.info("만료 Hold 처리 완료: %d건", count)
        return count
```

**설계 결정:**
- `settle` 시 추가 차감이 잔액 초과하면 잔액만큼만 차감 (마이너스 잔액 방지)
- `expire_stale_holds`는 예약 전액을 사용한 것으로 처리 (보수적 정책 — 실제 LLM 호출이 발생했을 가능성)
- 멱등성 키를 settle에도 적용 (기존 `CreditLedger.idempotency_key` 재활용)
- `select_for_update` 순서: hold → subscription (데드락 방지를 위해 항상 동일 순서)

**Step 2: 커밋**

```bash
git add apps/business/billing/services/hold_service.py
git commit -m "feat(billing): implement HoldService for credit reservation

hold(): pre-deduct estimated credits from balance
settle(): adjust to actual usage, refund difference
release(): cancel hold, full refund
expire_stale_holds(): auto-settle expired holds as fully used"
```

---

### Task 6: Backend — Views, Serializers, URLs

**목적:** Hold/Settle/Release API 엔드포인트 구현.

**Files:**
- Modify: `catcident-backend/apps/business/billing/serializers.py`
- Modify: `catcident-backend/apps/business/billing/views.py`
- Modify: `catcident-backend/apps/business/billing/urls.py`

**Step 1: Serializers 추가**

`serializers.py`에 추가:

```python
class HoldRequestSerializer(serializers.Serializer):
    service = serializers.CharField(default='storygraph')
    amount = serializers.IntegerField(min_value=1)
    metadata = serializers.DictField(required=False, default=dict)

class SettleRequestSerializer(serializers.Serializer):
    service = serializers.CharField(default='storygraph')
    hold_token = serializers.UUIDField()
    actual_amount = serializers.IntegerField(min_value=0)
    description = serializers.CharField(max_length=200)
    metadata = serializers.DictField(required=False, default=dict)
    idempotency_key = serializers.CharField(
        max_length=100, required=False, allow_null=True,
    )

class ReleaseRequestSerializer(serializers.Serializer):
    service = serializers.CharField(default='storygraph')
    hold_token = serializers.UUIDField()

class CreditHoldSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditHold
        fields = (
            'id', 'hold_token', 'amount', 'status',
            'settled_amount', 'expires_at', 'created_at',
        )
        read_only_fields = fields
```

**Step 2: Views 추가**

`views.py`에 추가:

```python
from .services.hold_service import HoldService

class CreditHoldView(APIView):
    """크레딧 예약 (Hold)"""
    permission_classes = [IsAuthenticated, ServiceKeyRequired]

    def post(self, request):
        serializer = HoldRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            subscription = CreditService.get_or_create_subscription(
                request.user, data['service']
            )
            hold = HoldService.hold(
                subscription.id,
                data['amount'],
                metadata=data.get('metadata'),
            )
            return Response({
                'hold_token': str(hold.hold_token),
                'amount': hold.amount,
                'expires_at': hold.expires_at.isoformat(),
                'balance_after': subscription.credit_balance,
            })
        except InsufficientCreditsError as e:
            return Response(
                {'error': str(e.message)},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class CreditSettleView(APIView):
    """크레딧 정산 (Settle)"""
    permission_classes = [IsAuthenticated, ServiceKeyRequired]

    def post(self, request):
        serializer = SettleRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            result = HoldService.settle(
                hold_token=data['hold_token'],
                actual_amount=data['actual_amount'],
                description=data['description'],
                metadata=data.get('metadata'),
                idempotency_key=data.get('idempotency_key'),
            )
            return Response(result)
        except CreditHold.DoesNotExist:
            return Response(
                {'error': '유효한 예약을 찾을 수 없습니다.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class CreditReleaseView(APIView):
    """크레딧 예약 취소 (Release)"""
    permission_classes = [IsAuthenticated, ServiceKeyRequired]

    def post(self, request):
        serializer = ReleaseRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            result = HoldService.release(hold_token=data['hold_token'])
            return Response(result)
        except CreditHold.DoesNotExist:
            return Response(
                {'error': '유효한 예약을 찾을 수 없습니다.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
```

**참고:** `CreditHold` import를 views.py 상단에 추가, `HoldRequestSerializer` 등도 import.

**Step 3: URLs 추가**

`urls.py`의 `urlpatterns`에 추가:

```python
path('credits/hold/', CreditHoldView.as_view(), name='credit-hold'),
path('credits/settle/', CreditSettleView.as_view(), name='credit-settle'),
path('credits/release/', CreditReleaseView.as_view(), name='credit-release'),
```

**Step 4: Celery 태스크에 hold 만료 추가**

`tasks.py`에 추가:

```python
from .services.hold_service import HoldService

@shared_task
def expire_stale_holds():
    """만료된 크레딧 예약 자동 정산 (5분 간격 권장)"""
    try:
        count = HoldService.expire_stale_holds()
        logger.info("만료 Hold 정리: %d건 처리", count)
    except Exception:
        logger.exception("만료 Hold 정리 실패")
```

**Step 5: 커밋**

```bash
git add apps/business/billing/serializers.py apps/business/billing/views.py \
       apps/business/billing/urls.py apps/business/billing/tasks.py
git commit -m "feat(billing): add hold/settle/release API endpoints

ServiceKeyRequired permission for service-to-service auth.
Settle supports idempotency key and partial usage.
Celery task for expired hold auto-settlement."
```

---

### Task 7: Frontend — 분석 세션 스토어 (서버 사이드)

**목적:** `/api/analyze` 호출 시 OpenRouter 응답의 토큰 사용량을 서버 메모리에 누적. 클라이언트가 토큰 수를 조작할 수 없게 함.

**Files:**
- Create: `web/src/lib/analysisSession.ts`

**Step 1: 분석 세션 스토어 구현**

```typescript
// web/src/lib/analysisSession.ts
/**
 * 서버 사이드 분석 세션 관리
 *
 * /api/analyze 호출마다 OpenRouter 응답의 토큰 사용량을 서버 메모리에 누적한다.
 * settle 시 서버가 직접 크레딧을 계산하므로, 클라이언트의 토큰 수 조작을 방지한다.
 *
 * ⚠️ 인메모리 저장: 서버 재시작 시 세션이 사라짐.
 * → 만료된 hold는 backend Celery 태스크가 자동 정산하므로 크레딧 유실 없음.
 */

import { randomUUID } from 'crypto';

interface TokenRecord {
  promptTokens: number;
  completionTokens: number;
  model: string;
}

interface AnalysisSession {
  userId: string;
  holdToken: string;
  model: string;
  tokens: TokenRecord[];
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, AnalysisSession>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30분 (hold TTL과 동일)
const MAX_SESSIONS = 1000;

/** 만료 세션 정리 */
function evictExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}

/** 분석 세션 생성 */
export function createAnalysisSession(
  userId: string,
  holdToken: string,
  model: string,
): string {
  if (sessions.size >= MAX_SESSIONS) {
    evictExpired();
  }
  const sessionId = randomUUID();
  const now = Date.now();
  sessions.set(sessionId, {
    userId,
    holdToken,
    model,
    tokens: [],
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return sessionId;
}

/** 세션에 토큰 사용량 추가 (OpenRouter 응답에서 추출) */
export function addSessionTokens(
  sessionId: string,
  record: TokenRecord,
): boolean {
  const session = sessions.get(sessionId);
  if (!session || Date.now() > session.expiresAt) return false;
  session.tokens.push(record);
  return true;
}

/** 세션 조회 (userId 일치 검증 포함) */
export function getAnalysisSession(
  sessionId: string,
  userId: string,
): AnalysisSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.userId !== userId) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

/** 세션 삭제 (settle/release 후 정리) */
export function deleteAnalysisSession(sessionId: string): void {
  sessions.delete(sessionId);
}
```

**설계 결정:**
- `userId` 검증: 다른 사용자의 세션에 토큰을 주입하는 것 방지
- `expiresAt`: hold TTL과 동일 (30분), Celery 만료 태스크와 동기화
- `MAX_SESSIONS`: 메모리 상한 1000개 (동시 분석 세션 수 제한)
- `randomUUID()`: 세션 ID는 예측 불가능해야 함 (보안)

**Step 2: 커밋**

```bash
git add web/src/lib/analysisSession.ts
git commit -m "feat(billing): add server-side analysis session store

In-memory token accumulation per analysis session.
Prevents client-side token count manipulation.
30-minute TTL synced with backend hold expiry."
```

---

### Task 8: Frontend — 분석 세션 API 라우트

**목적:** 분석 세션 시작/정산/취소 API 엔드포인트.

**Files:**
- Create: `web/src/app/api/analysis-session/route.ts`
- Create: `web/src/app/api/analysis-session/settle/route.ts`
- Create: `web/src/app/api/analysis-session/release/route.ts`
- Modify: `web/src/services/billingProxy.ts` (ALLOWED_POST_FIELDS 추가)

**Step 1: ALLOWED_POST_FIELDS 확장**

`web/src/services/billingProxy.ts` — 화이트리스트에 새 경로 추가:

```typescript
const ALLOWED_POST_FIELDS: Record<string, string[]> = {
  '/credits/deduct/': ['amount', 'description', 'metadata', 'idempotency_key'],
  '/credits/hold/': ['amount', 'metadata'],
  '/credits/settle/': ['hold_token', 'actual_amount', 'description', 'metadata', 'idempotency_key'],
  '/credits/release/': ['hold_token'],
};
```

**Step 2: 세션 시작 라우트**

`web/src/app/api/analysis-session/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';
import { createAnalysisSession } from '@/lib/analysisSession';
import { invalidateBalanceCache } from '@/lib/balanceCache';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { amount, model, metadata } = body as {
      amount?: number;
      model?: string;
      metadata?: Record<string, unknown>;
    };

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Backend에 hold 요청
    const holdBody = JSON.stringify({
      service: 'storygraph',
      amount,
      metadata: metadata ?? {},
    });

    const response = await proxyToCatcident('/credits/hold/', authResult.accessToken, {
      method: 'POST',
      body: holdBody,
    });

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      const errorMsg = response.status === 402
        ? '크레딧이 부족합니다.'
        : 'Billing service error';
      return NextResponse.json({ error: errorMsg }, { status });
    }

    const holdResult = await response.json();

    // 서버 사이드 분석 세션 생성
    const sessionId = createAnalysisSession(
      authResult.userId,
      holdResult.hold_token,
      (model as string) ?? '',
    );

    // 잔액 캐시 무효화 (hold로 잔액이 변경됨)
    invalidateBalanceCache(authResult.userId);

    console.log(`[billing] analysis session started: session=${sessionId}, hold=${holdResult.hold_token}`);

    return NextResponse.json({
      session_id: sessionId,
      hold_token: holdResult.hold_token,
      amount: holdResult.amount,
      balance_after: holdResult.balance_after,
      expires_at: holdResult.expires_at,
    });
  } catch (error: unknown) {
    console.error('[billing] analysis-session start error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 3: 정산 라우트**

`web/src/app/api/analysis-session/settle/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';
import { getAnalysisSession, deleteAnalysisSession } from '@/lib/analysisSession';
import { invalidateBalanceCache } from '@/lib/balanceCache';

// 크레딧 계산 상수 (catcident-backend StorygraphEstimator와 동기화)
const MARGIN = 3.0;
const USD_TO_KRW = 1400;
const KRW_PER_CREDIT = 10;

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.60 },
  'anthropic/claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
};

const DEFAULT_COST = { input: 1.0, output: 5.0 };

function calculateCredits(tokens: Array<{ promptTokens: number; completionTokens: number; model: string }>): number {
  if (tokens.length === 0) return 0;
  return tokens.reduce((sum, t) => {
    const costs = MODEL_COSTS[t.model] ?? DEFAULT_COST;
    const costUsd =
      (t.promptTokens / 1_000_000) * costs.input +
      (t.completionTokens / 1_000_000) * costs.output;
    return sum + Math.max(1, Math.ceil(costUsd * USD_TO_KRW * MARGIN / KRW_PER_CREDIT));
  }, 0);
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { session_id, title, idempotency_key } = body as {
      session_id?: string;
      title?: string;
      idempotency_key?: string;
    };

    if (!session_id) {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    }

    // 세션 조회 + userId 검증
    const session = getAnalysisSession(session_id, authResult.userId);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 404 });
    }

    // 서버 측 크레딧 계산 (클라이언트 금액 불신)
    const actualCredits = calculateCredits(session.tokens);
    const models = [...new Set(session.tokens.map(t => t.model))];
    const totalTokens = session.tokens.reduce(
      (sum, t) => sum + t.promptTokens + t.completionTokens, 0
    );

    // Backend settle 요청
    const settleBody = JSON.stringify({
      service: 'storygraph',
      hold_token: session.holdToken,
      actual_amount: actualCredits,
      description: title ? `소설 분석: ${title}` : '소설 분석',
      metadata: { models, chunks: session.tokens.length, totalTokens },
      idempotency_key: idempotency_key ?? null,
    });

    const response = await proxyToCatcident('/credits/settle/', authResult.accessToken, {
      method: 'POST',
      body: settleBody,
    });

    // 세션 정리
    deleteAnalysisSession(session_id);
    invalidateBalanceCache(authResult.userId);

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      console.error(`[billing] settle upstream error: ${response.status}`);
      return NextResponse.json({ error: 'Billing service error' }, { status });
    }

    const result = await response.json();

    console.log(
      `[billing] analysis session settled: session=${session_id}, actual=${actualCredits}, refunded=${result.refunded ?? 0}`,
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[billing] analysis-session settle error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 4: 취소 라우트**

`web/src/app/api/analysis-session/release/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { proxyToCatcident } from '@/services/billingProxy';
import { getAnalysisSession, deleteAnalysisSession } from '@/lib/analysisSession';
import { invalidateBalanceCache } from '@/lib/balanceCache';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if ('error' in authResult) return authResult.error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { session_id } = body as { session_id?: string };

    if (!session_id) {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    }

    const session = getAnalysisSession(session_id, authResult.userId);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 404 });
    }

    const releaseBody = JSON.stringify({
      service: 'storygraph',
      hold_token: session.holdToken,
    });

    const response = await proxyToCatcident('/credits/release/', authResult.accessToken, {
      method: 'POST',
      body: releaseBody,
    });

    deleteAnalysisSession(session_id);
    invalidateBalanceCache(authResult.userId);

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      return NextResponse.json({ error: 'Billing service error' }, { status });
    }

    const result = await response.json();
    console.log(`[billing] analysis session released: session=${session_id}`);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[billing] analysis-session release error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 5: 커밋**

```bash
git add web/src/services/billingProxy.ts \
       web/src/app/api/analysis-session/route.ts \
       web/src/app/api/analysis-session/settle/route.ts \
       web/src/app/api/analysis-session/release/route.ts
git commit -m "feat(billing): add analysis session API routes

POST /api/analysis-session — start session with hold
POST /api/analysis-session/settle — settle with server-calculated credits
POST /api/analysis-session/release — cancel session, refund hold
Server-side credit calculation from accumulated tokens."
```

---

### Task 9: Frontend — `/api/analyze` 세션 통합

**목적:** `/api/analyze`가 session_id를 받아 서버 측에 토큰을 누적하도록 수정.

**Files:**
- Modify: `web/src/app/api/analyze/route.ts`

**Step 1: 세션 토큰 추적 추가**

```typescript
// import 추가
import { addSessionTokens } from '@/lib/analysisSession';

// POST 핸들러 — request body에서 sessionId 추출
const { prompt, apiKey: userApiKey, model: requestedModel, sessionId } = await request.json();

// OpenRouter 응답 성공 후, _billing 추출 부분 바로 뒤에:
  // 서버 측 토큰 누적 (세션이 있을 때만)
  if (sessionId && data.usage) {
    const tracked = addSessionTokens(sessionId, {
      promptTokens: data.usage.prompt_tokens ?? 0,
      completionTokens: data.usage.completion_tokens ?? 0,
      model: actualModel,
    });
    if (!tracked) {
      console.warn(`[analyze] session token tracking failed: session=${sessionId}`);
    }
  }
```

**참고:** `sessionId`는 선택적. `AUTH_ENABLED=false`이거나 기존 클라이언트는 `sessionId` 없이 호출 → 기존 동작 유지. Phase 2 클라이언트 코드에서 `sessionId`를 전달하도록 수정.

**Step 2: 타입 체크**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -v "src/main.tsx"
```

**Step 3: 커밋**

```bash
git add web/src/app/api/analyze/route.ts
git commit -m "feat(billing): track token usage per analysis session in /api/analyze

When sessionId is provided, accumulate tokens server-side.
Backward compatible: no sessionId = existing behavior."
```

---

### Task 10: Frontend — billing.ts 클라이언트 서비스 확장

**목적:** 분석 세션 시작/정산/취소를 위한 클라이언트 함수 추가.

**Files:**
- Modify: `web/src/services/billing.ts`

**Step 1: 세션 관련 타입 및 함수 추가**

`billing.ts` 파일 끝에 추가:

```typescript
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

/**
 * 분석 세션 시작 — 예상 크레딧을 선차감(hold)하고 세션 ID를 반환.
 *
 * @returns 세션 정보 또는 null (billing 비활성/에러)
 */
export async function startAnalysisSession(
  estimatedCredits: number,
  model: string,
  metadata?: Record<string, unknown>,
): Promise<AnalysisSessionResult | null> {
  return billingFetch<AnalysisSessionResult>('/api/analysis-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: estimatedCredits, model, metadata }),
  });
}

/**
 * 분석 세션 정산 — 서버가 누적한 실제 토큰으로 크레딧 계산 및 정산.
 *
 * @returns 정산 결과 또는 null
 */
export async function settleAnalysisSession(
  sessionId: string,
  title: string,
  idempotencyKey: string,
): Promise<SettleResult | null> {
  return billingFetch<SettleResult>('/api/analysis-session/settle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      title,
      idempotency_key: idempotencyKey,
    }),
  });
}

/**
 * 분석 세션 취소 — hold 전액 환불.
 */
export async function releaseAnalysisSession(sessionId: string): Promise<ReleaseResult | null> {
  return billingFetch<ReleaseResult>('/api/analysis-session/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
}
```

**설계 결정:**
- `billingFetch<T>()` 재사용: 기존 에러 처리 패턴 (null 반환, `[billing]` 로깅) 준수
- `billingFetch`의 BASE는 `/api/billing`이므로, 새 함수들은 `/api/analysis-session` 경로를 사용. `billingFetch`의 base path 처리를 확인하고, 필요하면 전체 경로를 직접 사용.

**⚠️ 주의**: `billingFetch`가 `/api/billing` prefix를 자동 추가하는 경우, 새 엔드포인트는 prefix가 다르므로 직접 fetch를 사용하거나 base path를 파라미터화해야 함. 기존 코드를 확인하여 적절히 조정.

**Step 2: 커밋**

```bash
git add web/src/services/billing.ts
git commit -m "feat(billing): add analysis session client functions

startAnalysisSession(): hold credits, get session_id
settleAnalysisSession(): server-side settle with actual tokens
releaseAnalysisSession(): cancel hold, full refund"
```

---

### Task 11: Frontend — Orchestrator + FileUpload 흐름 전환

**목적:** 기존 "클라이언트 측 차감" 흐름을 "서버 측 hold/settle" 흐름으로 전환.

**Files:**
- Modify: `web/src/services/extraction/orchestrator.ts` (sessionId를 /api/analyze에 전달)
- Modify: `web/src/services/extraction/types.ts` (ExtractionOptions에 sessionId 추가)
- Modify: `web/src/components/FileUpload/FileUpload.tsx` (hold/settle 흐름)

**Step 1: ExtractionOptions에 sessionId 추가**

`web/src/services/extraction/types.ts`:

```typescript
// ExtractionOptions 인터페이스에 추가:
  /** 분석 세션 ID (서버 측 토큰 추적용, Phase 2 billing) */
  sessionId?: string;
```

**Step 2: Orchestrator에서 sessionId를 /api/analyze에 전달**

`web/src/services/extraction/orchestrator.ts` — `extractKnowledgeGraph` 함수:

ExtractionOptions에서 `sessionId`를 받아서, `extractFromChunk`와 `selectRelevantEntities`에 전달. 이 함수들이 `/api/analyze`를 호출할 때 `sessionId`를 body에 포함.

`web/src/services/extraction/extractor.ts` — `extractFromChunk` 함수의 fetch body에 `sessionId` 추가:

```typescript
// extractFromChunk 파라미터에 sessionId?: string 추가
// fetch body에 sessionId 포함:
body: JSON.stringify({
  prompt: userPrompt,
  model,
  sessionId, // ← 추가
}),
```

`web/src/services/extraction/selector.ts` — 동일 패턴 적용.

**Step 3: FileUpload 흐름 전환**

`web/src/components/FileUpload/FileUpload.tsx`:

`saveAndDeduct` → `holdAndSettle` 패턴으로 전환:

```typescript
// 기존: runExtraction → extractKnowledgeGraph → saveAndDeduct (save + deduct)
// 신규: holdCredits → extractKnowledgeGraph(sessionId) → save → settleSession

const saveAndSettle = useCallback(
  async (
    graph: NovelKnowledgeGraph,
    title: string,
    sessionId: string | null,
    existingId?: string,
  ): Promise<{ id: string }> => {
    setProgress('저장 중...');
    const saved = await saveKnowledgeGraph(graph, undefined, undefined, existingId);

    if (subscription && sessionId) {
      setProgress('크레딧 정산 중...');
      const idempotencyKey = `storygraph-${saved.id}-settle`;
      const result = await settleAnalysisSession(sessionId, title, idempotencyKey);
      if (result) {
        updateCreditBalance(result.balance_after);
      } else {
        // 정산 실패 — 구독 재로드 (hold는 만료 시 자동 정산됨)
        const { loadSubscription } = useStore.getState();
        loadSubscription();
        throw new Error('크레딧 정산에 실패했습니다. 예약된 크레딧은 자동으로 처리됩니다.');
      }
    }

    return saved;
  },
  [subscription, updateCreditBalance],
);
```

`runExtraction` 내부 수정:

```typescript
const runExtraction = useCallback(
  async (title: string, work: (sessionId: string | null) => Promise<boolean>) => {
    setLocalLoading(true);
    setLoading(true);
    setError(null);
    resetCurrentUsage();

    let sessionId: string | null = null;

    try {
      // billing 활성 시 hold
      if (subscription) {
        // 예상 크레딧은 work 내부에서 결정 → work에 sessionId를 전달
        // 실제로는 work 시작 전에 charCount를 알아야 하므로,
        // hold를 work 내부로 이동하거나 2단계로 분리
      }

      const completed = await work(sessionId);
      if (completed) {
        setShowUsageSummary(true);
      }
    } catch (err: unknown) {
      console.error('[extraction] error:', err);
      const message = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';

      // 세션이 있으면 release (분석 실패 시 hold 환불)
      if (sessionId) {
        await releaseAnalysisSession(sessionId).catch(() => {});
      } else if (subscription) {
        // 세션 없이 실패 (hold 전 에러) — 기존 partial deduct
        const { currentUsage, loadSubscription } = useStore.getState();
        await deductPartial(title, currentUsage, updateCreditBalance, loadSubscription);
      }

      setError(message);
      resetProgressState(true);
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  },
  [setLoading, setError, resetCurrentUsage, setShowUsageSummary, subscription, updateCreditBalance, resetProgressState],
);
```

`handleRegister` (및 다른 분석 진입점) 내부:

```typescript
await runExtraction(title, async (sessionIdFromRunner) => {
  // ... 텍스트 읽기 ...

  // 잔액 확인 + hold
  let sessionId: string | null = null;
  if (subscription) {
    const estimate = estimateUsageLocally(text.length, currentModel);
    const sessionResult = await startAnalysisSession(
      estimate.estimated_credits,
      currentModel,
      { charCount: text.length },
    );
    if (!sessionResult) {
      throw new Error('크레딧 예약에 실패했습니다. 잔액을 확인해주세요.');
    }
    sessionId = sessionResult.session_id;
    updateCreditBalance(sessionResult.balance_after);
  }

  setProgress('분석 중...');
  const newKnowledgeGraph = await extractKnowledgeGraph({
    text,
    title,
    onProgress: makeProgressCallback(),
    model: currentModel,
    fileName: sourceFileName,
    onChunkBilling: createBillingCallback(addChunkUsage),
    sessionId, // ← 서버 측 토큰 추적용
  });

  // ... metadata 설정 ...

  const saved = await saveAndSettle(newKnowledgeGraph, title, sessionId);

  // ... 상태 초기화 ...
  return true;
});
```

**⚠️ 구현 참고:**
- `handleDrop`, `handleResume`, `executeAddFile` 등 모든 분석 진입점에 동일 패턴 적용
- `checkSufficientBalance` 호출은 `startAnalysisSession`으로 대체 (hold 자체가 잔액 검증)
- `deductAfterSave`/`deductPartial` 호출은 `settleAnalysisSession`/`releaseAnalysisSession`으로 대체
- `onChunkBilling` 콜백은 UI 표시용으로 유지 (UsageSummary 모달에서 사용)

**Step 2: 타입 체크 및 빌드**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -v "src/main.tsx"
cd web && npm run build
```

**Step 3: 커밋**

```bash
git add web/src/services/extraction/types.ts \
       web/src/services/extraction/orchestrator.ts \
       web/src/services/extraction/extractor.ts \
       web/src/services/extraction/selector.ts \
       web/src/components/FileUpload/FileUpload.tsx
git commit -m "feat(billing): switch to hold/settle flow in analysis pipeline

Replace client-side deduction with server-side hold/settle.
sessionId passed through extraction pipeline to /api/analyze.
Hold on start, settle after save, release on failure."
```

---

### Task 12: Frontend — Store + 타입 업데이트

**목적:** Zustand store에 분석 세션 상태 추가, 기존 billing 타입 정리.

**Files:**
- Modify: `web/src/types.ts` (분석 세션 관련 타입이 필요한 경우)
- Modify: `web/src/store.ts` (세션 상태는 불필요할 수 있음 — 검토 후 결정)

**Step 1: 검토**

분석 세션 상태(`sessionId`)는 `FileUpload` 컴포넌트의 `runExtraction` 로컬 변수로 관리되므로, store에 추가할 필요 없음. `currentUsage`는 UI 표시용으로 유지.

변경이 필요한 경우에만 수정. 불필요한 store 확장은 하지 않는다 (YAGNI).

**Step 2: 기존 `deductAfterSave`/`deductPartial` 코드 정리**

Phase 2 완료 후, `billing.ts`의 `deductAfterSave`, `deductPartial`, `deductUsage`는 더 이상 사용되지 않을 수 있음. 단, `AUTH_ENABLED=false` 환경과의 호환성을 위해 즉시 삭제하지 않고, 다음 정리 단계에서 제거.

**Step 3: 커밋 (변경이 있는 경우에만)**

---

### Task 13: 문서 업데이트

**목적:** CLAUDE.md 및 서비스 문서에 새로운 billing 흐름 반영.

**Files:**
- Modify: `web/CLAUDE.md` — API 엔드포인트 테이블에 analysis-session 추가
- Modify: `web/src/services/CLAUDE.md` — billing 흐름 설명 업데이트
- Modify: `web/src/lib/CLAUDE.md` — balanceCache, rateLimit, analysisSession 문서화

**Step 1: 각 CLAUDE.md에 새 모듈/엔드포인트 추가**

`web/CLAUDE.md` API 엔드포인트 테이블:

```markdown
| `POST /api/analysis-session` | 분석 세션 시작 (크레딧 hold) |
| `POST /api/analysis-session/settle` | 분석 세션 정산 (서버 측 크레딧 계산) |
| `POST /api/analysis-session/release` | 분석 세션 취소 (hold 환불) |
| `POST /api/billing/credits/hold` | 크레딧 예약 (catcident 프록시) |
| `POST /api/billing/credits/settle` | 크레딧 정산 (catcident 프록시) |
| `POST /api/billing/credits/release` | 크레딧 예약 취소 (catcident 프록시) |
```

`web/src/services/CLAUDE.md` billing 흐름:

```markdown
### Billing 흐름 (Phase 2: Hold/Settle)

1. `startAnalysisSession(estimatedCredits, model)` → hold 생성 + session_id 반환
2. `extractKnowledgeGraph({ ..., sessionId })` → /api/analyze에 sessionId 전달
3. /api/analyze: 서버 측에서 OpenRouter 응답 토큰을 세션에 누적
4. `settleAnalysisSession(sessionId, title, idempotencyKey)` → 서버가 실제 크레딧 계산 + 정산
5. 실패 시: `releaseAnalysisSession(sessionId)` → hold 전액 환불
```

`web/src/lib/CLAUDE.md`:

```markdown
## balanceCache.ts — 잔액 캐시

/api/analyze에서 사용하는 사용자별 잔액 캐시 (5분 TTL).
잔액 0 사용자의 OpenRouter 호출을 서버 측에서 차단.

## rateLimit.ts — Rate Limiter

슬라이딩 윈도우 방식 사용자별 API 호출 제한.
/api/analyze에서 분당 60회 제한 (AUTH_ENABLED=true일 때만).

## analysisSession.ts — 분석 세션 스토어

서버 사이드 인메모리 분석 세션 관리.
/api/analyze 호출마다 OpenRouter 토큰 사용량을 누적.
settle 시 서버가 직접 크레딧 계산 (클라이언트 금액 조작 방지).
```

**Step 2: 커밋**

```bash
git add web/CLAUDE.md web/src/services/CLAUDE.md web/src/lib/CLAUDE.md
git commit -m "docs: update CLAUDE.md for billing security (hold/settle, rate limit, balance cache)"
```

---

## 검증 계획 (Phase 완료 후)

### Phase 1 검증

```bash
# 타입 체크
cd web && npx tsc --noEmit 2>&1 | grep -v "src/main.tsx"

# 빌드
cd web && npm run build
```

수동 테스트:
- [ ] AUTH_ENABLED=false: 기존 동작 유지 (billing 없이 분석 가능)
- [ ] AUTH_ENABLED=true, 잔액 > 0: 분석 정상 동작
- [ ] AUTH_ENABLED=true, 잔액 = 0: `/api/analyze` 호출 시 402 반환
- [ ] 차감 실패 시 사용자에게 에러 메시지 표시
- [ ] Rate limit 초과 시 429 반환

### Phase 2 검증

```bash
# Backend 테스트
cd /Users/idencosmos/Projects/catcident-backend
docker compose run --rm api python manage.py test apps.business.billing

# Frontend 타입 체크 + 빌드
cd /Users/idencosmos/Projects/narrative-studio/web
docker compose build storygraph
```

수동 테스트:
- [ ] 분석 시작 시 hold 생성 확인 (잔액 감소)
- [ ] 분석 완료 시 settle 확인 (실제 사용량 정산, 차액 환불)
- [ ] 분석 실패 시 release 확인 (전액 환불)
- [ ] `/api/analyze`를 직접 호출해도 sessionId 없이는 토큰 추적 안 됨
- [ ] 세션 만료(30분) 후 Celery 태스크가 자동 정산
- [ ] AUTH_ENABLED=false: 전체 흐름 기존과 동일 (hold/settle 비활성)

### 보안 테스트

- [ ] 잔액 0인 사용자가 `/api/analyze` 직접 호출 → 402
- [ ] 차감 금액을 클라이언트에서 조작해도 서버가 실제 토큰으로 재계산
- [ ] hold 없이 settle 호출 → 404
- [ ] 다른 사용자의 sessionId로 토큰 추적 → userId 불일치로 실패
- [ ] 분당 60회 초과 호출 → 429

---

## 아키텍처 준수 확인표

| 항목 | 준수 여부 | 설명 |
|------|----------|------|
| 프록시 팩토리 패턴 | ✅ | `billingPostHandler` 확장, 커스텀 라우트도 동일 에러 처리 패턴 |
| POST 화이트리스트 | ✅ | `ALLOWED_POST_FIELDS`에 hold/settle/release 등록 |
| `service: 'storygraph'` 강제 | ✅ | 모든 backend 요청에 서버 측 주입 |
| 에러 메시지 sanitization | ✅ | generic 에러만 클라이언트에 반환 |
| `[billing]`/`[analyze]` 로깅 | ✅ | 모든 새 코드에 적용 |
| `catch (err: unknown)` | ✅ | 타입 가드 사용 |
| Discriminated union | ✅ | `requireAuth()` 결과 type narrowing |
| Zustand 개별 셀렉터 | ✅ | store 변경 최소화, 세션 상태는 로컬 변수 |
| `AUTH_ENABLED=false` 호환 | ✅ | 모든 billing 관련 코드에 조건부 비활성화 |
| 결정론적 idempotency key | ✅ | `storygraph-${savedId}-settle` 패턴 |
| Backend `@transaction.atomic` | ✅ | hold/settle/release 모두 atomic |
| Backend `select_for_update()` | ✅ | 동시성 제어 |
| Backend verbose_name 번호 | ✅ | `B06. 크레딧 예약` |
| Serializer read-only/write 분리 | ✅ | 기존 패턴 준수 |
| 모달 접근성 | N/A | 새 모달 추가 없음 |
| `ModalOverlay` 공통 컴포넌트 | N/A | 기존 모달 변경 없음 |
