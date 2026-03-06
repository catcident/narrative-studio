# 우선순위 발견사항

## P0

### 1) hold 시작점 비멱등
- 위치:
  - `web/src/app/api/session/hold/route.ts`
  - `web/src/services/billing.ts` `holdCredits`
- 문제:
  - 요청 식별 키 미도입
- 영향:
  - 재시도/중복 요청 시 hold 중복 생성

## P1

### 2) finalizeHold 실패를 약하게 처리하는 경로 존재
- 위치:
  - `web/src/hooks/useBatchAnalysis.ts` 등
- 문제:
  - settle/release 실패를 로그만 남기고 흐름 지속
- 영향:
  - 사용자 UI와 실제 정산 상태 불일치

### 3) 프록시/세션 라우트 멱등 정책 분산
- 위치:
  - `web/src/services/billingProxy.ts`
  - `web/src/app/api/session/*/route.ts`
- 문제:
  - 공통 계약 없이 라우트별로 상이한 정책
- 영향:
  - 유지보수 시 멱등성 누락 가능

### 4) settle 기본 키는 있으나 요청 내용 불변성 검증 부재
- 위치:
  - `web/src/app/api/session/settle/route.ts`
- 문제:
  - 동일 holdToken에 상이한 chunks가 들어와도 동일 키 사용 가능
- 영향:
  - 잘못된 재시도 탐지 어려움

## P2

### 5) `/api/chat` body의 `idempotency_key` 사용되지 않음
- 위치:
  - 전송: `web/src/services/chat.ts`
  - 수신: `web/src/app/api/chat/route.ts`
- 문제:
  - 필드 존재 의미가 불명확
- 영향:
  - 추후 기능 확장 시 오해/호환성 이슈
