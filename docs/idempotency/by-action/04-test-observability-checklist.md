# 테스트/관측 체크리스트

## 1. 통합 테스트

### 1.1 세션 과금
- 동일 `idempotency_key` hold 2회 -> 동일 hold_token 반환
- 동일 holdToken settle 2회 -> 동일 결과 재반환
- 이미 release된 hold 재호출 -> no-op 성공 응답

### 1.2 오류 복구
- settle 실패(네트워크) 후 재시도 -> 중복 차감 없음
- finalizeHold 실패 후 사용자 재진입 시 복구 루틴 동작 확인

### 1.3 프록시 계약
- 세션/일반 billing 라우트 모두 idempotency 키 전달 규약 준수
- 업스트림 `409/404/5xx` 매핑 검증

## 2. E2E 시나리오
- 채팅 중 탭 종료 후 재접속:
  - hold 미정리 상태 복구
  - 잔액/사용량 표시 일관성
- 일괄 분석 중 네트워크 흔들림:
  - 파일별 settle/release 정확성

## 3. 운영 관측
- 알람 기준:
  - hold 생성 대비 settle+release 완료율
  - hold 만료 자동정리 비율 급증
  - 동일 user의 repeated hold/release 에러 증가
- 로그 샘플링:
  - `idempotency_key` 기준으로 요청-응답 추적 가능해야 함
