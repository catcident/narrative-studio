# Billing Backend Alignment Plan (2026-03-19)

## 상태

2026-03-19 기준 `narrative-studio` 적용 완료.

- 추가:
  - `web/src/lib/billingBackend.ts`
  - `web/src/app/api/billing/public-pricing/route.ts`
- 갱신:
  - `web/src/app/api/billing/subscription/route.ts`
  - `web/src/app/api/billing/credits/balance/route.ts`
  - `web/src/services/billing.ts`
  - `web/src/components/landing/PricingSection.tsx`
  - `web/src/components/SubscriptionPage.tsx`
  - `web/src/lib/balanceCache.ts`
  - `web/src/lib/versionHistory.ts`
  - `web/src/middleware.ts`
- 제거:
  - `web/src/app/api/billing/plans/route.ts`
  - `web/src/app/api/billing/packages/route.ts`

검증 메모:

- `npm run build` 통과
- `next lint`는 저장소 ESLint 미설정으로 미실행
- `npx tsc --noEmit`는 이번 변경과 무관한 기존 오류로 실패

아래 본문은 구현 직전 분석/계획 기록이며, 위 상태 섹션이 현재 결과를 덮어쓴다.

## 목적

`narrative-studio`를 현재 `catcident-backend` billing 계약에 맞춘다.

- 레거시 `/plans`, `/subscription`, `/packages` 전제를 제거
- 현재 backend의 `billing` 경로/응답에 맞는 adapter를 프론트에 둔다
- 랜딩 페이지 공개 pricing은 backend의 새 공개 endpoint를 사용한다

기준 backend 브랜치/커밋:

- `catcident-backend` `main`
- `2355e73`

## 현재 backend 계약

### 1. 공개 pricing endpoint

비로그인 사용자도 호출 가능:

`GET /api/v1/billing/public/pricing/?service=<service_code>`

예시:

```json
{
  "service": {
    "code": "storygraph",
    "name": "StoryGraph - 인물 관계도",
    "status": "active",
    "base_url": "https://storygraph.catcident.com",
    "allow_platform_topup": true
  },
  "plans": [
    {
      "id": 1,
      "service_code": "storygraph",
      "code": "free",
      "name": "Free",
      "sort_order": 0,
      "monthly_credits": 50,
      "included_service_credits": 50,
      "price_krw": 0,
      "features": { "...": "..." },
      "feature_flags": { "...": "..." },
      "is_public": true
    }
  ],
  "topup_packages": [
    {
      "id": 1,
      "code": "topup-550",
      "service_code": "storygraph",
      "name": "550 크레딧",
      "credits": 550,
      "price_krw": 4900,
      "bonus_pct": 0,
      "scope_type": "platform",
      "bonus_policy": {}
    }
  ]
}
```

### 2. 인증 필요 billing API

- `GET /api/v1/billing/subscriptions/`
  - 사용자 구독 목록
  - StoryGraph는 여기서 `service_code === "storygraph"` 인 row를 선택해야 함
- `GET /api/v1/billing/topup-packages/`
  - 인증 필요 충전 상품 목록
  - 현재는 공개 pricing endpoint의 `topup_packages`를 먼저 쓰고, 필요 시 이 endpoint를 보조적으로 사용할 수 있음
- `GET /api/v1/billing/credits/transactions/?service=storygraph`
- `POST /api/v1/billing/credits/hold/`
- `POST /api/v1/billing/credits/settle/`
- `POST /api/v1/billing/credits/release/`

### 3. 현재 결제/구독 페이지 URL

- 구독 시작:
  - `/ko/billing/services/storygraph/subscribe/?plan=<plan_code>&return_url=<url>`
- 충전 시작:
  - `/ko/billing/credits/checkout/?package=<package_id>&return_url=<url>`
- 레거시 제거됨:
  - `/ko/billing/subscribe/`
  - `/ko/billing/checkout/`
  - `/ko/billing/subscription/`

## 현재 narrative-studio에서 깨진 지점

### 레거시 API 경로

- `web/src/app/api/billing/plans/route.ts`
  - 현재 `/api/v1/billing/plans/?service=storygraph` 전제
- `web/src/app/api/billing/subscription/route.ts`
  - 현재 `/api/v1/billing/subscription/?service=storygraph` 전제
- `web/src/app/api/billing/packages/route.ts`
  - 현재 `/api/v1/billing/packages/?service=storygraph` 전제

### 레거시 checkout URL

- `web/src/components/SubscriptionPage.tsx`
  - 현재 `/ko/billing/subscribe/?plan=...`
  - 현재 `/ko/billing/checkout/?package=...`

### 응답 shape mismatch

현재 프론트가 기대하는 구독 shape:

```ts
{
  subscription_id: number;
  service_code: string;
  plan: {
    code: string;
    name: string;
    monthly_credits: number;
    price_krw: number;
  };
  features: PlanFeatures;
  credit_balance: number;
  purchased_credit_balance: number;
}
```

현재 backend `subscriptions/` row는 flat shape이다:

```ts
{
  id: number;
  service_code: string;
  service_name: string;
  plan_code: string;
  plan_name: string;
  plan_price_krw: number;
  included_service_credits: number;
  feature_flags: PlanFeatures;
  credit_balance: number;
  purchased_credit_balance: number;
  status: string;
  expires_at: string | null;
  renewal_anchor_at: string | null;
  auto_renew: boolean;
}
```

즉, 프론트에서 adapter가 필요하다.

## 권장 구현 방향

backend에 레거시 호환 endpoint를 더 붙이지 말고, `narrative-studio`에서 아래 adapter를 둔다.

### A. 공개 pricing

신규 프록시 route 추가:

- `web/src/app/api/billing/public-pricing/route.ts`

동작:

- backend `/api/v1/billing/public/pricing/?service=storygraph` 프록시
- 인증 불필요

이 route는 아래 두 군데에서 공용 사용:

- `web/src/components/landing/PricingSection.tsx`
- `web/src/components/SubscriptionPage.tsx`

### B. 구독 로딩

`/subscription` singular endpoint를 더 이상 사용하지 않는다.

- `web/src/app/api/billing/subscription/route.ts`
  - backend `/api/v1/billing/subscriptions/` 호출
  - 응답 배열에서 `service_code === "storygraph"`인 row 하나를 선택
  - 없으면 free/default fallback 또는 `null`
  - 선택한 row를 기존 `SubscriptionInfo` shape로 변환해서 반환

권장 adapter 함수 예시:

```ts
function mapBackendSubscriptionRow(row: BackendSubscriptionRow): SubscriptionInfo {
  return {
    subscription_id: row.id,
    service_code: row.service_code,
    plan: {
      code: row.plan_code,
      name: row.plan_name,
      monthly_credits: row.included_service_credits,
      price_krw: row.plan_price_krw,
    },
    status: row.status,
    credit_balance: row.credit_balance,
    purchased_credit_balance: row.purchased_credit_balance,
    credit_reset_at: row.renewal_anchor_at,
    features: row.feature_flags,
    started_at: '',
    expires_at: row.expires_at,
  };
}
```

`started_at`이 현재 backend row에 꼭 필요하지 않다면 타입을 완화하는 편이 낫다.

### C. 플랜/패키지 source 통합

현재 `getPlans()`와 `getCreditPackages()`는 별도 legacy route를 쓴다.

권장:

- `getPlans()`는 `public-pricing` 응답의 `plans` 사용
- `getCreditPackages()`는 `public-pricing` 응답의 `topup_packages` 사용

즉, 요금제/패키지는 하나의 source로 통합한다.

### D. Checkout URL 교체

`web/src/components/SubscriptionPage.tsx`

- 구독 버튼:
  - 기존: `/ko/billing/subscribe/?plan=...`
  - 변경: `/ko/billing/services/storygraph/subscribe/?plan=...`
- 충전 버튼:
  - 기존: `/ko/billing/checkout/?package=...`
  - 변경: `/ko/billing/credits/checkout/?package=...`

## 파일별 작업 계획

### 1. `web/src/services/billing.ts`

수정:

- `getPlans()` 구현 교체
- `getCreditPackages()` 구현 교체
- `SubscriptionInfo` / `ServicePlan` / `CreditPackage` 타입을 새 backend contract와 맞게 재검토
- backend row → UI type adapter 함수 추가

권장:

- backend raw type과 UI normalized type을 분리

### 2. `web/src/app/api/billing/plans/route.ts`

권장:

- 삭제하거나 deprecated 처리
- 대신 `public-pricing/route.ts`로 통합

### 3. `web/src/app/api/billing/packages/route.ts`

권장:

- 삭제하거나 deprecated 처리
- `public-pricing` 기반으로 대체

### 4. `web/src/app/api/billing/public-pricing/route.ts`

신규:

- backend 공개 pricing endpoint 프록시
- 인증 불필요

### 5. `web/src/app/api/billing/subscription/route.ts`

수정:

- `/subscription/` → `/subscriptions/`
- 배열에서 storygraph row 선택
- UI 구독 shape로 normalize

### 6. `web/src/components/landing/PricingSection.tsx`

수정:

- fetch 경로를 `/api/billing/public-pricing`로 변경
- `plans` 배열 parsing을 새 응답 shape에 맞게 단순화

### 7. `web/src/components/SubscriptionPage.tsx`

수정:

- plans/packages source를 `public-pricing` 기반으로 변경
- checkout/subscribe URL 변경
- 현재 구독 표시와 public catalog의 타입 차이를 adapter 기준으로 맞춤

### 8. `web/src/store.ts`

수정:

- `loadSubscription()`가 새 normalized 응답을 안정적으로 반영하도록 유지
- `subscription === null` fallback 동작을 다시 점검

## 구현 순서

1. backend 공개 pricing endpoint를 사용하는 신규 프록시 route 추가
2. `billing.ts`에 raw type / adapter 도입
3. `subscription/route.ts`를 `subscriptions/` 기반으로 교체
4. `PricingSection.tsx`를 신규 공개 pricing route 사용으로 변경
5. `SubscriptionPage.tsx`를 신규 공개 pricing route + 새 checkout URL로 변경
6. 사용되지 않는 legacy plans/packages route 제거 또는 deprecated 처리
7. smoke test

## 검증 체크리스트

### 비로그인

- 랜딩 페이지 pricing 카드 표시
- free/basic/pro 가격 정상 표시
- 플랜 feature 문구 표시

### 로그인

- 헤더 크레딧 배지 표시
- 사용자 메뉴 플랜 배지 표시
- 구독 모달에서 플랜 비교 표시
- 구독 모달에서 충전 패키지 표시
- 구독 버튼이 `/ko/billing/services/storygraph/subscribe/`로 이동
- 충전 버튼이 `/ko/billing/credits/checkout/`로 이동

### 회귀

- hold / settle / release 동작 유지
- mock billing session 모드 유지
- AUTH_ENABLED=false fallback 유지

## 메모

장기적으로는 서비스 프론트 공통으로 사용할 billing client contract를 문서화하는 것이 좋다.

후속 권장:

- `catcident-backend` billing API 계약 문서 추가
- `narrative-studio`에서 `raw backend response`와 `UI state type`을 명확히 분리
