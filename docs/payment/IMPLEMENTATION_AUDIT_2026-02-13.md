# 결제/구독 구현 감사 보고서 (2026-02-13)

## 1. 문서 목적과 범위

이 문서는 `narrative-studio`에서 제공하는 결제/구독 관련 기능(UI + 프록시 API)을 코드 기준으로 점검한 결과를 정리한다.

- 점검 기준일: 2026-02-13
- 점검 범위:
  - `web/src/components/SubscriptionPage.tsx`
  - `web/src/components/CreditBadge.tsx`
  - `web/src/components/UsageHistory.tsx`
  - `web/src/services/billing.ts`
  - `web/src/services/billingProxy.ts`
  - `web/src/app/api/billing/*`
  - `web/src/app/api/session/*`
  - `web/src/store.ts`, `web/src/App.tsx`

## 2. 현재 구조 요약

`narrative-studio`는 결제 로직을 직접 처리하지 않고, `catcident-backend`를 프록시로 호출한다.

- 브라우저/클라이언트:
  - 구독/크레딧 UI 렌더링
  - 결제 시 `catcident.com/ko/billing/*` 페이지를 새 창으로 열어 이동
- Next.js 서버 라우트:
  - `/api/billing/*`로 billing API 프록시
  - `/api/session/*`로 hold/settle/release 오케스트레이션
- 실제 결제 승인/정기결제:
  - `catcident-backend`의 `payment` 앱에서 처리

## 3. 사용자 기능 구현 현황

### 3.1 제공 중인 기능

- 구독 정보 로드
  - 로그인 후 `loadSubscription()` 호출
  - 포커스/탭 복귀 시 재조회
- 플랜 비교 UI
  - 현재 플랜 강조
  - 유료 플랜 선택 시 `catcident.com/ko/billing/subscribe/`로 이동
- 크레딧 패키지 UI
  - 패키지 목록 조회
  - 구매 버튼으로 `catcident.com/ko/billing/checkout/` 이동
- 크레딧 사용 내역
  - `billing/credits/transactions` 기반 원장 테이블 제공
- 헤더 배지
  - 현재 크레딧 표시
  - 클릭 시 구독 관리 모달
- BYOK 탭
  - 개인 API 키 저장/검증/삭제
  - 크레딧 우선 vs 항상 개인키 모드 선택
- 세션 과금 흐름
  - 분석 시작 전 hold
  - 완료 후 settle(서버 재계산)
  - 취소/실패 시 release

### 3.2 미제공 또는 부분 제공 기능

- 결제 내역(카드 결제 트랜잭션) 조회 UI 없음
  - 현재 제공되는 내역은 `CreditLedger`(크레딧 원장) 중심
- 결제 수단(카드) 관리 UI 없음
  - `payment methods` 조회/삭제 화면으로 직접 연결되는 경로 없음
- 구독 해지/재개/자동결제 중지 UI 없음
- 프론트 내 `구독 상태(status, expires_at)` 노출이 제한적
  - 데이터는 로드하지만 사용자 화면에서 적극적으로 안내하지 않음

## 4. API/프록시 계층 상세

### 4.1 `/api/billing/*` (요금제/구독/원장)

- `GET /api/billing/subscription`
  - 업스트림: `/api/v1/billing/subscription/?service=storygraph`
- `GET /api/billing/plans`
  - 공개 라우트(비인증 허용)
- `GET /api/billing/packages`
- `GET /api/billing/credits/balance`
- `GET /api/billing/credits/transactions?page=N`
- `POST /api/billing/credits/deduct`

공통 구현 포인트:

- 인증 라우트는 `requireAuth()`로 액세스 토큰 획득
- `proxyToCatcident()`에서 `X-Service-Key`를 조건부로 주입
- 업스트림 오류 시 상태코드 매핑 및 표준 에러 JSON 반환

### 4.2 `/api/session/*` (분석 세션 정산)

- `POST /api/session/hold`
  - BYOK면 hold 생략(`hold_token: null`)
  - 일반 모드면 잔액 확인 후 hold 생성
- `POST /api/session/settle`
  - 클라이언트 청크 정보를 받아 서버에서 실제 크레딧 재계산
  - 업스트림 settle 성공 시 balance cache 갱신
- `POST /api/session/release`
  - hold 취소 및 잔액 캐시 갱신

## 5. 상태관리/UI 결합

- `store.subscription`에 아래 필드를 유지:
  - `plan`, `planName`, `creditBalance`, `monthlyCredits`, `creditResetAt`, `status`, `features`
- `SubscriptionPage`에서 탭 구성:
  - `플랜 비교`, `크레딧 구매`, `사용 내역`, `API 키`
- `CreditBadge` 클릭으로 모달 오픈
- `App.tsx`에서 로그인/포커스 시 `loadSubscription()` 재실행

## 6. 결제 테스트 모드 현황

- `SubscriptionPage` 상단에 테스트 모드 배너가 항상 렌더링됨
- 하지만 코드상 `PAYMENT_ENABLED/payment_enabled` 설정 연동은 미구현
  - 문서 계획은 존재하나 런타임 플래그 연동은 반영되지 않은 상태

## 7. 리스크 및 구현 공백

### 7.1 [High] 결제 내역/결제수단/해지 관리의 사용자 셀프서비스 부족

현재 narrative-studio는 실제 결제 관리보다 "결제 페이지로 이동" 역할 중심이다.

- 사용자는 앱 내부에서 카드 이력이나 결제 트랜잭션을 직접 조회하기 어렵다.
- 해지/재개 시나리오도 명시적 UI가 없다.

### 7.2 [Medium] 테스트 모드 표기의 동적 제어 부재

배너가 정적으로 표시되므로, 실결제 전환 시에도 UI 문구와 실제 상태가 쉽게 불일치할 수 있다.

### 7.3 [Medium] 분석 차단 로직의 fail-open 정책

`checkAnalyzeEligibility()`는 billing 서비스 장애 시 분석을 허용한다.

- 장점: 장애 전파 완화
- 단점: 과금 시스템 장애 시 비용 통제가 약해질 수 있음

### 7.4 [Low] 구독 상태 정보 활용 부족

`status`/`creditResetAt` 데이터를 저장하지만, 화면에서 적극적으로 안내하지 않는다.

## 8. 확인된 사용자 동선

- 업그레이드/구매 의도 -> `SubscriptionPage` 버튼 클릭
- 외부 결제 페이지(`catcident.com/ko/billing/...`) 새 창 이동
- 결제 완료 후 앱 복귀
- 복귀 시 포커스 이벤트로 구독 정보 재조회 -> 잔액 반영

## 9. 권장 개선 우선순위

1. 결제/구독 관리 범위 정의(앱 내 제공 vs 백엔드 페이지 위임) 확정
2. 테스트 모드 플래그(`payment_enabled`)를 프론트/백엔드 공통으로 도입
3. 결제 내역(카드 결제) 조회 탭 추가 또는 명시적 외부 링크 제공
4. 결제수단 관리/구독 해지 진입점 추가
5. 구독 상태(`active/past_due/expired`) 사용자 안내 강화
6. fail-open 정책에 대한 운영 기준(허용 시간/알림) 문서화

## 10. 참고 파일 인덱스

- `web/src/components/SubscriptionPage.tsx`
- `web/src/components/UsageHistory.tsx`
- `web/src/components/CreditBadge.tsx`
- `web/src/App.tsx`
- `web/src/store.ts`
- `web/src/services/billing.ts`
- `web/src/services/billingProxy.ts`
- `web/src/app/api/billing/subscription/route.ts`
- `web/src/app/api/billing/plans/route.ts`
- `web/src/app/api/billing/packages/route.ts`
- `web/src/app/api/billing/credits/transactions/route.ts`
- `web/src/app/api/session/hold/route.ts`
- `web/src/app/api/session/settle/route.ts`
- `web/src/app/api/session/release/route.ts`
- `web/src/lib/balanceCache.ts`
