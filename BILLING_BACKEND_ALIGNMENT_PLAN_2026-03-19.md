# Billing Backend Alignment Plan (2026-03-19)

## 현재 결론

`catcident-backend`는 이제 StoryGraph 외부 연동에 필요한 canonical billing 계약을 제공한다.

- `GET /api/v1/billing/public/pricing/?service=storygraph`
- `POST /api/v1/billing/subscriptions/bootstrap/`
- `GET /api/v1/billing/subscriptions/`
- `GET /api/v1/billing/credits/wallet/`

`narrative-studio`는 이미 공개 pricing과 `subscriptions/` read path에는 맞춰져 있지만, **`subscriptions/bootstrap/`는 아직 호출하지 않는다.**
따라서 현재 코드는 로그인 직후에도 real `ServiceSubscription` row가 없을 수 있고, free fallback이 그 상태를 가려 주는 구조다.

이 문서는 현재 코드 기준으로 남은 작업을 정리한 follow-up 계획이다.

## 현재 코드 상태

### 이미 맞춰진 부분

- 랜딩/구독 모달의 공개 pricing source는 `GET /api/billing/public-pricing`
- 이 프록시는 backend `GET /api/v1/billing/public/pricing/?service=storygraph`를 사용
- `GET /api/billing/subscription`은 backend `GET /api/v1/billing/subscriptions/`를 읽고 `storygraph` row를 선택
- `GET /api/billing/credits/balance`도 같은 normalized subscription 어댑터를 사용
- 외부 결제 진입 URL은 현재 billing portal 기준으로 이미 보정되어 있음

### 아직 안 맞춰진 부분

- `web/src/lib/billingBackend.ts`
  - `fetchStorygraphSubscription()`은 `GET /api/v1/billing/subscriptions/`만 읽음
  - `storygraph` row가 없으면 public pricing + wallet summary로 free fallback을 합성함
- `web/src/app/api/billing/subscription/route.ts`
  - authenticated 사용자여도 bootstrap 호출 없이 바로 `fetchStorygraphSubscription()`만 실행함
- `web/src/lib/balanceCache.ts`, `web/src/lib/versionHistory.ts`
  - 같은 helper를 재사용하므로 real row 대신 fallback subscription을 볼 수 있음

### 이 상태의 실제 영향

- 로그인/OIDC 승인만으로 real `ServiceSubscription` row가 보장되지 않음
- 첫 billing 진입이 `hold`가 아니면 signup bonus를 포함한 canonical 상태가 늦게 보일 수 있음
- 현재 UI는 fallback 덕분에 바로 깨지지는 않지만, `subscription_id=0`인 synthetic 상태가 정상 경로를 대신하고 있음
- 새로운 서비스 프론트가 같은 패턴을 복제하면 같은 문제가 다시 생길 수 있음

## 권장 구현 방향

핵심 원칙은 다음과 같다.

1. authenticated 사용자의 정상 경로는 **bootstrap -> read** 순서로 바꾼다.
2. free fallback은 **장애/경계 상황 대비용 보조 경로**로만 남긴다.
3. backend에 side-effect가 있는 GET을 만들지 않고, bootstrap은 명시적 POST로 유지한다.

## 파일별 작업 계획

### 1. `web/src/lib/billingBackend.ts`

추가할 것:

- `bootstrapStorygraphSubscription(accessToken: string)` helper
  - upstream: `POST /api/v1/billing/subscriptions/bootstrap/`
  - body: `{ service_code: 'storygraph' }`
- `ensureStorygraphSubscription(accessToken: string)` helper
  - 순서:
    1. bootstrap POST 시도
    2. `GET /api/v1/billing/subscriptions/` 재조회
    3. 그래도 row가 없으면 기존 fallback 사용

정리할 것:

- 현재 `fetchStorygraphSubscription()`의 역할을 read-only helper로 유지할지,
  `ensureStorygraphSubscription()` 내부로 흡수할지 결정
- public pricing + wallet 기반 fallback 로직은 유지하되, 이름/주석에서 "primary path"처럼 읽히지 않게 정리

### 2. `web/src/app/api/billing/subscription/route.ts`

권장 최소 변경:

- authenticated 요청이면 `fetchStorygraphSubscription()` 대신 `ensureStorygraphSubscription()` 호출
- mock/session 경로는 그대로 유지
- bootstrap 실패 시에도 전체 요청을 즉시 hard fail하지 말고, 이후 read/fallback을 시도한 뒤 최종 실패만 502로 반환

이 방식의 장점:

- 클라이언트 API 계약을 바꾸지 않아도 됨
- 기존 `loadSubscription()` 호출부를 전혀 건드리지 않아도 됨
- 로그인 직후 첫 subscription fetch가 곧 canonical bootstrap 지점이 됨

### 3. `web/src/lib/balanceCache.ts`

검토 포인트:

- analyze/chat 사전 자격 확인이 synthetic fallback이 아니라 canonical row를 우선 보게 할지 결정
- 보수적으로는 현재 helper를 유지해도 되지만, 장기적으로는 `ensureStorygraphSubscription()`을 사용하는 편이 낫다

권장:

- authenticated + access token이 있을 때는 ensure helper 사용
- 단, bootstrap 장애 시 fail-open 정책은 그대로 유지

### 4. `web/src/lib/versionHistory.ts`

현재는 단순 조회에서도 fallback subscription을 볼 수 있다.

권장:

- billing 상태를 화면 기준 canonical하게 맞추고 싶다면 ensure helper 사용
- 만약 이 경로에 side effect를 넣고 싶지 않다면, 최소한 호출부 주석에 "fallback may be synthetic"를 명시

### 5. `web/src/lib/AGENTS.md`, `web/AGENTS.md`, `docs/BILLING_BLUEPRINT.md`, `docs/payment/*`

문서 정렬 필요:

- backend에 `POST /api/v1/billing/subscriptions/bootstrap/`가 추가됐음을 반영
- 현재 narrative-studio는 아직 bootstrap을 쓰지 않는다는 점을 명시
- free fallback은 유지하지만, 앞으로의 정상 경로는 bootstrap-first라고 기록

## 권장 구현 순서

1. `billingBackend.ts`에 bootstrap helper 추가
2. `subscription/route.ts`를 bootstrap-first로 전환
3. `balanceCache.ts`/`versionHistory.ts`에서 helper 사용 범위 결정
4. 관련 AGENTS/docs 업데이트
5. 수동 검증 + 회귀 테스트 추가

## 테스트 / 검증 체크리스트

### 자동화

- authenticated 사용자, 기존 `storygraph` subscription row 없음
  - `GET /api/billing/subscription` 호출 후 real row 반환
  - `subscription_id !== 0`
- bootstrap 재호출
  - 중복 row 생성 없음
  - 기존 subscription 반환
- bootstrap 실패 + subscriptions read 가능
  - 기존 fallback 또는 read 결과로 graceful handling
- mock billing session 경로
  - 기존 동작 유지

### 수동 확인

- 신규 로그인 직후 첫 구독 조회에서 free 플랜과 signup bonus가 canonical 상태로 보이는지 확인
- 첫 analyze 이전에도 `CreditBadge`/구독 모달이 synthetic row가 아닌 real row를 쓰는지 확인
- billing backend가 일시적으로 느리거나 실패할 때 UI가 과도하게 깨지지 않는지 확인

## 비목표

- backend의 OIDC 승인 흐름에 subscription 생성 side effect를 추가하지 않음
- legacy singular `/api/v1/billing/subscription/`를 복구하지 않음
- `/api/billing/subscription` 클라이언트 계약을 새 POST route로 분리하지 않음
  - 필요 최소 변경 기준으로는 existing GET route 내부 bootstrap이 가장 단순함

## 참고 파일

- `web/src/lib/billingBackend.ts`
- `web/src/app/api/billing/subscription/route.ts`
- `web/src/lib/balanceCache.ts`
- `web/src/lib/versionHistory.ts`
- `web/src/store.ts`
- `web/src/services/billing.ts`
- `web/AGENTS.md`
- `web/src/lib/AGENTS.md`
- `docs/BILLING_BLUEPRINT.md`
- `docs/payment/IMPLEMENTATION_AUDIT_2026-02-13.md`
