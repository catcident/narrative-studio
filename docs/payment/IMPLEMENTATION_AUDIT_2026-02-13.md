# 결제/구독 구현 감사 보고서

> 원본 작성일: 2026-02-13
> 현행 갱신일: 2026-03-19

## 1. 문서 목적과 범위

이 문서는 `narrative-studio`의 결제/구독 UI와 프록시 API를 현재 코드 기준으로 다시 정리한 감사 문서다.

- 점검 기준일: 2026-03-19
- 기준 backend: `catcident-backend main@2355e73`
- 점검 범위:
  - `web/src/components/SubscriptionPage.tsx`
  - `web/src/components/CreditBadge.tsx`
  - `web/src/components/UsageHistory.tsx`
  - `web/src/services/billing.ts`
  - `web/src/lib/billingBackend.ts`
  - `web/src/services/billingProxy.ts`
  - `web/src/app/api/billing/*`
  - `web/src/app/api/session/*`
  - `web/src/store.ts`

## 2. 현재 구조 요약

`narrative-studio`는 결제 승인이나 구독 생성 로직을 직접 처리하지 않는다. 진실 원천은 `catcident-backend` billing/payment 앱이다.

- 브라우저/클라이언트:
  - 공개 pricing 조회
  - 현재 구독/잔액 렌더링
  - 외부 billing portal 새 창 이동
- Next.js 서버 라우트:
  - `/api/billing/public-pricing`로 공개 pricing 프록시
  - `/api/billing/subscription`과 `/api/billing/credits/balance`에서 backend 응답을 StoryGraph 전용 shape로 정규화
  - `/api/session/*`에서 hold/settle/release 오케스트레이션
- 실제 구독/결제/원장:
  - `catcident-backend`의 `billing`/`payment` 앱에서 처리

현재 StoryGraph가 맞춘 backend 계약:

- `GET /api/v1/billing/public/pricing/?service=storygraph`
- `GET /api/v1/billing/subscriptions/`
- `GET /api/v1/billing/credits/wallet/`
- `GET /api/v1/billing/credits/transactions/?service=storygraph`
- `POST /api/v1/billing/credits/hold/`
- `POST /api/v1/billing/credits/settle/`
- `POST /api/v1/billing/credits/release/`

## 3. 사용자 기능 구현 현황

### 3.1 제공 중인 기능

- 공개 pricing 카탈로그
  - 랜딩과 구독 모달이 모두 `/api/billing/public-pricing`를 사용
  - 플랜과 top-up 패키지가 동일 source에서 렌더링됨
- 구독 정보 로드
  - 로그인 후 `loadSubscription()` 호출
  - 포커스/탭 복귀 시 재조회
  - backend `subscriptions/`에 `storygraph` row가 없으면 free fallback 합성
- 플랜 비교 UI
  - 현재 플랜 강조
  - 유료 플랜 선택 시 `https://catcident.com/ko/billing/services/storygraph/subscribe/`로 이동
- 크레딧 패키지 UI
  - 공개 pricing의 `topup_packages` 사용
  - 구매 버튼으로 `https://catcident.com/ko/billing/credits/checkout/` 이동
- 크레딧 사용 내역
  - `billing/credits/transactions` 기반 원장 테이블 제공
- 헤더 배지
  - 현재 크레딧 표시
  - 클릭 시 구독 관리 모달
- BYOK 탭
  - 개인 API 키 저장/검증/삭제
  - 크레딧 우선 vs 항상 개인 키 모드 선택
- 세션 과금 흐름
  - 분석 시작 전 hold
  - 완료 후 settle
  - 취소/실패 시 release

### 3.2 미제공 또는 부분 제공 기능

- 결제 내역(카드 결제 트랜잭션) 조회 UI 없음
  - 현재 제공되는 내역은 `CreditLedger` 중심
- 결제 수단 관리 UI 없음
  - backend billing portal에는 존재하지만 storygraph 내부 진입점은 없음
- 구독 해지/자동갱신 중지/재개 UI 없음
- `payment_enabled` 같은 런타임 플래그 연동 없음
  - `SubscriptionPage`의 테스트 모드 배너는 현재 정적 표시

## 4. API/정규화 계층 상세

### 4.1 `/api/billing/*`

- `GET /api/billing/public-pricing`
  - 업스트림: `/api/v1/billing/public/pricing/?service=storygraph`
  - 인증 불필요
- `GET /api/billing/subscription`
  - 업스트림: `/api/v1/billing/subscriptions/`
  - `service_code === "storygraph"` row를 선택해 normalized subscription 반환
  - row가 없으면 공개 pricing의 free 플랜 + wallet grants로 fallback 합성
- `GET /api/billing/credits/balance`
  - 위와 동일한 정규화 결과에서 `{ balance, plan }` 스냅샷 반환
- `GET /api/billing/credits/transactions?page=N`
  - 업스트림 거래 내역 페이지네이션 프록시

공통 구현 포인트:

- 공개 라우트는 인증 없이 `proxyToCatcident()` 사용
- 인증 라우트는 `requireAuth()`로 access token 획득
- `billingBackend.ts`가 raw backend 응답과 UI normalized type 사이의 어댑터 역할을 수행

### 4.2 `/api/session/*`

- `POST /api/session/hold`
  - BYOK면 hold 생략(`hold_token: null`)
  - 일반 모드면 예상 크레딧 기준 hold 생성
- `POST /api/session/settle`
  - 클라이언트 청크 usage를 받아 서버에서 실제 크레딧 재계산
  - settle 성공 시 balance cache 갱신
- `POST /api/session/release`
  - hold 취소 및 잔액 캐시 갱신

중요한 점:

- `/api/analyze` 자체는 과금하지 않는다
- 실제 원장 변경은 `hold/settle/release`를 통해 backend billing API에서 발생한다

## 5. 상태관리/UI 결합

- `store.subscription`은 normalized subscription을 기반으로 유지
- `SubscriptionPage` 탭:
  - `플랜 비교`, `크레딧 구매`, `사용 내역`, `API 키`
- `CreditBadge` 클릭으로 모달 오픈
- `PricingSection`과 `SubscriptionPage`는 동일 pricing source 사용

## 6. 확인된 사용자 동선

- 업그레이드/구매 의도
  - `SubscriptionPage` 버튼 클릭
- 외부 결제 페이지 이동
  - 구독: `catcident.com/ko/billing/services/storygraph/subscribe/`
  - 충전: `catcident.com/ko/billing/credits/checkout/`
- 결제 완료 후 앱 복귀
  - 포커스 이벤트로 구독 정보 재조회
  - 잔액/플랜 반영

## 7. 현재 리스크 및 구현 공백

### 7.1 [High] 셀프서비스 결제 관리 부족

storygraph는 결제 포털 진입만 제공한다.

- 카드 이력 조회
- 결제 수단 관리
- 자동 갱신 해지/재개

위 기능은 backend billing portal에 있으나 storygraph 내부 연결은 아직 약하다.

### 7.2 [Medium] 테스트 모드 표기의 동적 제어 부재

테스트 배너가 정적으로 표시된다. 실제 결제 전환 시 UI와 운영 상태가 쉽게 어긋날 수 있다.

### 7.3 [Medium] 분석 차단 로직의 fail-open 정책

`checkAnalyzeEligibility()`는 billing 서비스 장애 시 분석을 허용한다.

- 장점: 장애 전파 완화
- 단점: 과금 시스템 장애 시 비용 통제 약화

### 7.4 [Medium] free fallback 경로 자동화 검증 부족

`subscriptions/`에 `storygraph` row가 없는 신규 사용자에 대한 fallback은 구현되어 있으나, 전용 회귀 테스트는 아직 없다.

## 8. 확인된 제거 사항

이번 정렬 작업으로 아래 레거시 전제는 제거됐다.

- `/api/billing/plans`
- `/api/billing/packages`
- upstream singular `/api/v1/billing/subscription/?service=storygraph`
- 외부 portal 구독 URL `/ko/billing/subscribe/`
- 외부 portal 충전 URL `/ko/billing/checkout/`

## 9. 참고 파일 인덱스

- `web/src/lib/billingBackend.ts`
- `web/src/services/billing.ts`
- `web/src/services/billingProxy.ts`
- `web/src/components/SubscriptionPage.tsx`
- `web/src/components/landing/PricingSection.tsx`
- `web/src/components/UsageHistory.tsx`
- `web/src/components/CreditBadge.tsx`
- `web/src/store.ts`
- `web/src/app/api/billing/public-pricing/route.ts`
- `web/src/app/api/billing/subscription/route.ts`
- `web/src/app/api/billing/credits/balance/route.ts`
- `web/src/app/api/billing/credits/transactions/route.ts`
- `web/src/app/api/session/hold/route.ts`
- `web/src/app/api/session/settle/route.ts`
- `web/src/app/api/session/release/route.ts`
- `web/src/lib/balanceCache.ts`
