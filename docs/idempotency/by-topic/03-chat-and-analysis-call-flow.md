# 채팅/분석 호출 흐름과 멱등성 경계

## 1. 현재 코드 구조
- 분석 API: `web/src/app/api/analyze/route.ts`
  - OpenRouter 호출
  - `_billing` 토큰 정보만 반환(실제 차감 없음)
- 채팅 API: `web/src/app/api/chat/route.ts`
  - 스트리밍/비스트리밍 지원
  - 스트림 종료 시 `event: billing` SSE 이벤트 전송
- 클라이언트 채팅 서비스: `web/src/services/chat.ts`
  - 다중 LLM 호출(의도분석/선별/최종답변/연결판단)
  - 각 호출의 billing을 모아 settle용 `chunkUsages` 생성

## 2. 현재 잘된 구현
- "AI 호출"과 "실제 크레딧 차감"이 분리되어 있어 과금 경계가 명확합니다.
- `/api/analyze`, `/api/chat`는 직접 차감하지 않아 중복 차감 가능성을 낮춥니다.
- settle 단계에서 서버가 실제 차감액을 재계산합니다.

## 3. 리스크

### [P1] 채팅/검증 경로에서 `idempotency_key`를 전송하지만 서버가 사용하지 않음
- 클라이언트는 `/api/chat` body에 `idempotency_key`를 넣지만,
- `web/src/app/api/chat/route.ts`는 해당 필드를 해석/저장하지 않습니다.
- 현재는 과금이 분리되어 있어 치명적이지 않지만, 향후 서버 기능 확장 시 혼선 여지가 큽니다.

### [P1] hold 실패/정리 실패와 AI 호출 재시도의 결합 위험
- 분석/채팅 자체는 재시도되기 쉬운데 hold 정리 실패가 동반되면 세션 잔액이 어긋날 수 있습니다.

## 4. 개선 방향
- `/api/chat`에서 `idempotency_key`를 명시적으로 무시/허용 정책 문서화
- hold 없는 AI 호출 금지 가드 강화(생산 환경에서 fail-closed)
- settle/release 실패 시 사용자 알림 + 재정산 큐 등록
