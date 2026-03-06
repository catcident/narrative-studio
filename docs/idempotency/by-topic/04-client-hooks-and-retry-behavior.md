# 클라이언트 훅 재시도/실패 처리

## 1. 현재 코드 구조
- 주요 훅:
  - `web/src/hooks/useAddFileAnalysis.ts`
  - `web/src/hooks/useResumeAnalysis.ts`
  - `web/src/hooks/useLorebookExtraction.ts`
  - `web/src/hooks/useSourceTextView.tsx`
  - `web/src/hooks/useBatchAnalysis.ts`
- 공통 흐름:
  1. 추정 비용 계산
  2. hold
  3. 작업 수행
  4. 성공 시 settle / 실패 시 release

## 2. 현재 잘된 구현
- 대부분 경로가 hold/settle 패턴을 일관되게 따릅니다.
- `warning` 레벨에서 hold 금액을 `min(estimated, balance)`로 줄여 402 가능성을 낮춥니다.
- 작업 종료 후 `loadSubscription()`으로 상태 갱신합니다.

## 3. 리스크

### [P1] 일부 경로에서 finalizeHold 실패를 로깅만 하고 진행
- 예: batch 훅에서 settle/release 실패를 `console.error` 후 계속 진행합니다.
- 결과적으로 사용자 입장에서 성공처럼 보이지만 정산 불일치가 남을 수 있습니다.

### [P2] 사용자 취소/브라우저 종료 시 hold 해제 보장 부족
- 클라이언트 중심 정리만으로는 탭 종료/네트워크 단절 시 release 미실행이 가능합니다.
- 업스트림 만료 정리 태스크에 의존도가 높습니다.

## 4. 개선 방향
- `finalizeHold` 실패를 도메인 에러로 승격하고 UI 경고/재시도 버튼 제공
- "미정리 hold 복구"용 클라이언트 재진입 루틴(최근 hold 토큰 복구) 추가
- 장기적으로는 서버 오케스트레이션(Job + callback)로 정산 책임을 서버로 이관
