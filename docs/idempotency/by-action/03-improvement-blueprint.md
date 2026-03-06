# 개선 블루프린트

## 1. 목표
- 클라이언트 재시도/중복 클릭/네트워크 타임아웃 상황에서도 과금 결과가 정확히 1회 반영되도록 한다.
- `narrative-studio`와 `catcident-backend` 사이의 멱등 계약을 명시적 프로토콜로 고정한다.

## 2. 구현 제안

### 2.1 세션 API 계약 통일
- hold request 필드 확장:
  - `idempotency_key` (필수)
  - `session_key` (선택, 로그 추적용)
- settle request 필드 확장:
  - `idempotency_key` (현재 유지)
  - `request_hash` (chunks canonical hash)
- release request 필드 확장:
  - `idempotency_key` (선택)

### 2.2 공통 유틸 도입
- `web/src/services/sessionBilling.ts` (신규) 제안
  - `postHoldIdempotent()`
  - `postSettleIdempotent()`
  - `postReleaseIdempotent()`
- 각 route의 body 검증/에러 매핑/재시도 정책을 한곳에 모음

### 2.3 클라이언트 훅 보강
- `finalizeHold` 반환 타입에 `ok/replayed/error` 추가
- 실패 시 UI에 "정산 미완료" 상태를 표시
- 백그라운드 재정산 큐(local persisted queue) 도입

### 2.4 관측 강화
- 모든 세션 API 로그에 공통 필드 추가:
  - `userId`, `holdToken`, `idempotencyKey`, `operation`, `replayed`
- 대시보드 메트릭:
  - hold 재생(replay) 횟수
  - settle 충돌 횟수
  - finalize 실패 후 복구 성공률

## 3. 단계별 적용

### Phase 1
- hold에 idempotency_key 추가
- finalizeHold 실패를 상위 에러로 전달

### Phase 2
- request_hash 검증 도입
- 세션 라우트 공통화

### Phase 3
- 클라이언트 재정산 큐 + 운영 모니터링 대시보드 적용
