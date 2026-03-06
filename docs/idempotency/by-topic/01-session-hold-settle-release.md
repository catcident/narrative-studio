# 세션 hold/settle/release 멱등성

## 1. 현재 코드 구조
- 클라이언트 API: `web/src/services/billing.ts`
  - `holdCredits()` -> `/api/session/hold`
  - `settleCredits()` -> `/api/session/settle`
  - `releaseCredits()` -> `/api/session/release`
  - `finalizeHold()`에서 chunks 유무로 settle/release 분기
- 서버 라우트:
  - `web/src/app/api/session/hold/route.ts`
  - `web/src/app/api/session/settle/route.ts`
  - `web/src/app/api/session/release/route.ts`
- 업스트림: `catcident-backend` `/api/v1/billing/credits/*`

## 2. 현재 잘된 구현
- 세션 패턴(hold -> 작업 -> settle/release)이 구조적으로 분리됨
- `settle`은 기본 `idempotency_key = settle_${holdToken}`를 사용
- settle/release 성공 시 `updateBalanceCache()`로 서버 캐시 동기화
- BYOK 경로는 hold/settle를 우회하여 이중 과금 위험을 줄임

## 3. 리스크

### [P0] hold에 idempotency key 없음
- `hold` 요청 body는 `amount`, `metadata` 중심이며 고정 dedupe key가 없습니다.
- 재시도(네트워크 타임아웃/사용자 재클릭) 시 hold 중복 생성 가능성이 있습니다.

### [P1] release 재호출 비멱등(업스트림 의존)
- 이미 해제/정산된 hold에 대한 재호출 시 업스트림이 not found를 반환할 수 있습니다.
- 클라이언트는 실패를 강하게 처리하지 않아 정리 상태가 불명확해질 수 있습니다.

### [P1] settle 결과 재사용 정책이 "요청 내용 불변"을 검증하지 않음
- 동일 holdToken으로 서로 다른 chunks를 보내도 기본 key가 동일해 업스트림에서 기존 결과를 재사용할 수 있습니다.
- 요청 해시를 함께 검증하지 않으면 잘못된 재시도와 정상 재시도를 구분하기 어렵습니다.

## 4. 개선 방향
- hold 요청에 `idempotency_key` 필수화(세션 시작 UUID)
- settle에 `request_hash`(chunks canonical hash) 포함
- release는 no-op 멱등 계약(이미 처리됨 -> 200 + 상태 반환)으로 통일
- 클라이언트 `finalizeHold()`는 실패를 삼키지 않고 상태를 상위에 전달하도록 개선
