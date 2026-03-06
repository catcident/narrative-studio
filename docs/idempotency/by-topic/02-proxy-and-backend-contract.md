# 프록시/백엔드 계약 멱등성

## 1. 현재 코드 구조
- 공통 프록시: `web/src/services/billingProxy.ts`
  - `proxyToCatcident()`
  - `billingGetHandler()`
  - `billingPostHandler()`
- 세션 라우트는 `billingPostHandler` 대신 개별 route에서 직접 body 구성
- 서비스 인증: `CATCIDENT_SERVICE_KEY` -> `X-Service-Key` 헤더 전달

## 2. 현재 잘된 구현
- POST 화이트리스트로 허용 필드 제한(`ALLOWED_POST_FIELDS`)
- `service: 'storygraph'` 강제 주입
- 업스트림 오류를 직접 노출하지 않고 게이트웨이 에러로 변환

## 3. 리스크

### [P1] idempotency 표준 계약이 라우트별로 분산
- `billingPostHandler`는 `idempotency_key` 전달을 지원하지만,
- `/api/session/hold`는 자체 구현으로 key를 만들지 않습니다.
- 결과적으로 같은 도메인 연산인데 멱등성 규칙이 엔드포인트별로 달라집니다.

### [P2] 에러 매핑이 충돌/재사용 시나리오를 구분하지 못함
- 업스트림의 `404`, `409`, `422` 등을 모두 일반 에러로 취급하는 경로가 있습니다.
- 재시도 가능 에러와 불변성 위반 에러를 분리하기 어렵습니다.

## 4. 개선 방향
- 세션 라우트도 공통 "idempotentPost" 유틸로 통일
- 공통 응답 타입에 `replayed`, `idempotency_key`, `operation_status` 포함
- 업스트림 상태코드 매핑 정책을 명시:
  - `409`: 이미 처리된 요청(기존 결과 조회)
  - `404`: no-op 가능한 경우 200 변환 옵션
  - `5xx`: 재시도 대상
