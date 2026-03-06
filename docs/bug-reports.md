# Bug Reports

프로젝트 점검 과정에서 확인된 버그/감사 이슈를 추적하는 문서.
상세 분석 문서는 `docs/payment/`, `docs/idempotency/` 하위에 두고,
이 파일은 우선순위와 후속 조치만 요약한다.

## 🔴 Critical

- 현재 없음

## 🟠 High

- 세션 과금 멱등성 보강 필요
  - 상세: `docs/idempotency/by-action/02-priority-findings.md`
  - 핵심 이슈: hold 시작점 비멱등, finalize 실패 처리 약함

- 결제/구독 셀프서비스 범위 정의 필요
  - 상세: `docs/payment/IMPLEMENTATION_AUDIT_2026-02-13.md`
  - 핵심 이슈: 결제수단/해지/결제 내역 UI 부재

## 🟡 Medium

- 테스트 모드와 실결제 모드의 런타임 플래그 정리 필요
  - 상세: `docs/payment/IMPLEMENTATION_AUDIT_2026-02-13.md`

- 채팅/분석 호출과 과금 경계 문서화 강화 필요
  - 상세: `docs/idempotency/by-topic/03-chat-and-analysis-call-flow.md`

## 🟢 Low

- 운영 관측 지표와 재정산 복구 루틴 보강
  - 상세: `docs/idempotency/by-action/04-test-observability-checklist.md`

## 운영 원칙

- 감사/검토 결과는 가능한 한 주제별 문서로 남긴다.
- 이 파일에는 우선순위와 링크만 유지한다.
- 임시 프롬프트나 작업 메모는 커밋 전에 제거하거나 별도 문서로 정리한다.
