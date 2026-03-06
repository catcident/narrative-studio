# 멱등성 리뷰 문서 (narrative-studio)

작성일: 2026-02-13

이 폴더는 `narrative-studio`의 멱등성/재시도 안전성/동시성 안전성을 정리합니다.
특히 `catcident-backend`와의 연동 구간(세션 hold/settle/release, billing 프록시)을 중심으로 다룹니다.

## 범위
- 세션 과금: `/api/session/hold`, `/api/session/settle`, `/api/session/release`
- billing 프록시: `/api/billing/*` + `billingProxy.ts`
- 채팅/분석 호출: `/api/chat`, `/api/analyze` + 클라이언트 훅
- 실패 재시도 시 클라이언트의 hold 정리 보장

## 폴더 구조
- `by-topic/01-session-hold-settle-release.md`: 세션 과금 흐름 검토
- `by-topic/02-proxy-and-backend-contract.md`: 프록시/백엔드 계약 검토
- `by-topic/03-chat-and-analysis-call-flow.md`: AI 호출 경로와 과금 경계
- `by-topic/04-client-hooks-and-retry-behavior.md`: 프론트 훅의 재시도/실패 처리
- `by-action/01-strengths-and-current-controls.md`: 현재 강점
- `by-action/02-priority-findings.md`: 우선순위 발견사항
- `by-action/03-improvement-blueprint.md`: 개선 설계
- `by-action/04-test-observability-checklist.md`: 테스트/관측 체크리스트
