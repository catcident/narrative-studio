# Billing 시스템 엣지 케이스 분석

Hold/Settle 과금 시스템의 엣지 케이스 및 잠재적 취약점 분석.

## 시나리오 1: 실제 사용량이 예상 + 잔액을 초과하는 경우

**조건**: 보유 45크레딧, 예상 40, 실제 80

### 흐름

```
startHoldSession(charCount, model)
  └→ estimateCreditsFromCharCount() → estimated_credits: 40  (서버 측 계산)
  └→ HoldService.hold(amount=40)
      balance=45 >= 40 ✓
      balance = 45 - 40 = 5

extractKnowledgeGraph({ sessionId })
  └→ /api/analyze × N회 → addSessionTokens() → 토큰 누적

settleAnalysisSession()
  └→ calculateCredits(session.tokens) = 80 (서버 계산)
  └→ HoldService.settle(hold_token, actual_amount=80)
      diff = 40 - 80 = -40
      extra_needed = 40
      extra_charge = min(40, balance=5) = 5
      balance = 5 - 5 = 0
      actual_amount = 40 + 5 = 45
```

### 결과

| 항목 | 값 |
|------|----|
| 보유 크레딧 | 45 |
| hold 금액 | 40 |
| 실제 사용량 | 80 |
| **실제 차감** | **45** (전액) |
| **서비스 손실** | **35** |

사용자는 보유 전액을 지불하고, 서비스가 차이(35)를 흡수한다. 분석 결과는 정상 수신.

### 위험도: 낮음

`MARGIN = 3.0` (3배 마진)이 대부분의 경우 충분한 여유를 제공하므로, 추정치가 실제의 2배 이상 차이나는 경우는 드물다.

### 완화 요소

- `estimateUsageLocally()`의 3배 마진이 대부분 커버
- `expire_stale_holds`가 미정산 hold를 자동 처리

---

## 시나리오 2: sessionId 누락을 통한 무료 분석

**조건**: 클라이언트가 `/api/analyze` 호출 시 sessionId를 의도적으로 제거

### 해결됨

`/api/analyze`는 클라이언트 `sessionId`에 의존하지 않고, `getActiveSessionIdByUserId(userId)`로 서버 측에서 활성 세션을 자동 조회한다. 클라이언트가 sessionId를 조작하거나 제거해도 토큰 추적에 영향이 없다.

### 위험도: 해결됨

---

## 시나리오 3: 서버 재시작 시 세션 소멸

**조건**: 분석 중 Next.js 서버 재시작

### 흐름

```
hold 성공 → balance 5, hold.amount=40
분석 중 서버 재시작 → analysisSession Map(인메모리) 소멸

settle 시도 → getAnalysisSession() returns null → 404
catch block → releaseAnalysisSession(sessionId) 시도
  └→ release도 getAnalysisSession() 필요 → null → 404 → 조용히 실패

Hold는 backend에서 HELD 상태로 30분간 유지
expire_stale_holds(): settled_amount = hold.amount(40)
```

### 결과

사용자는 **실제 사용량과 무관하게 hold 금액(40)을 지불**한다.

- 실제 5만 사용한 경우: 35 초과 지불 (사용자 손해)
- 실제 80을 사용한 경우: 40만 지불 (서비스 손해, 시나리오 1보다 유리)

### 위험도: 중간

### 완화 요소

- `expire_stale_holds` Celery 태스크가 안전망 역할
- 서버 재시작은 빈번하지 않음

### 해결 방안

- 세션 스토어를 Redis 등 외부 저장소로 이전
- 또는 settle/release 엔드포인트에서 세션이 없을 때 hold_token을 직접 사용하는 폴백 경로 추가

---

## 시나리오 4: 30분 초과 분석 시 세션 만료

**조건**: 매우 긴 소설 (50+ 청크)로 분석이 30분 초과

### 흐름

```
hold 성공 → 세션 생성 (expiresAt = now + 30분)

25분 경과: addSessionTokens() 정상 동작
31분 경과: addSessionTokens() → session.expiresAt 초과 → return false
  └→ 이후 청크 토큰은 조용히 누락

동시에 backend hold도 30분 만료 → expire_stale_holds() 실행 가능

settle 시도:
  - Next.js 세션: 만료되어 삭제됨 → getAnalysisSession() null → 404
  - Backend hold: 이미 EXPIRED 상태 → settle 불가
```

### 결과

분석은 완료되지만 정상 정산 불가. Hold 금액만 차감된다.

### 위험도: 중간

### 해결 방안

- 세션 TTL을 분석 예상 시간에 비례하여 동적 설정
- 청크 처리 시마다 세션 expiresAt 갱신 (sliding window)
- Backend hold TTL과 Next.js 세션 TTL 동기화

---

## 시나리오 5: 동시 분석 세션의 비용 증폭

**조건**: 같은 사용자가 여러 브라우저 탭에서 동시 분석

### 흐름

```
보유: 100크레딧

[탭1] hold 50 → balance 50
[탭2] hold 50 → balance 0

[탭1] actual=80 → extra_needed=30, min(30, balance=0)=0 → pays 50
[탭2] actual=80 → extra_needed=30, min(30, balance=0)=0 → pays 50
```

### 결과

| 항목 | 값 |
|------|----|
| 보유 크레딧 | 100 |
| 총 실제 사용 | 160 |
| 총 차감 | 100 |
| **서비스 손실** | **60** |

두 번째 hold가 잔액을 0으로 만들면, 양쪽 모두 추가 차감이 불가능해져 서비스 손실이 커진다.

### 위험도: 중간

### 완화 요소

- `select_for_update()`로 동시성 문제는 없음 (데이터 정합성 보장)
- 일반 사용자가 동시 분석을 실행하는 경우는 드물음
- **부분 해결**: `userSessionIndex`로 사용자당 단일 활성 세션 강제 (두 번째 세션 시작 시 첫 번째 세션 덮어쓰기). 다만 첫 번째 hold는 backend에 남아 `expire_stale_holds`가 처리하므로, hold 금액만큼 일시적으로 잔액이 줄어듦.

### 잔여 위험

- backend hold 자체는 여전히 두 개 생성 가능 (첫 번째 hold는 orphaned 상태로 만료 대기)
- 극단적 경우 사용자 잔액이 일시적으로 과소 표시될 수 있음

---

## 시나리오 6: settle 실패 시 저장 + 미정산 상태

**조건**: settleAnalysisSession() 네트워크 오류 또는 backend 장애

### 흐름

```
saveKnowledgeGraph(graph) → 성공 (저장 완료)
settleAnalysisSession(sessionId, title, key) → null (실패)
  └→ loadSubscription() 호출
  └→ throw new Error('크레딧 정산에 실패했습니다...')
```

### 결과

**지식 그래프는 이미 저장**되었지만 크레딧은 hold 상태로 남아있다. `expire_stale_holds`가 처리하지만 **실제 사용량이 아닌 hold 금액으로 정산**된다.

### 위험도: 낮음

### 완화 요소

- 멱등성 키(`storygraph-{savedId}-settle`)가 있으므로 재시도 가능
- `expire_stale_holds`가 최종 안전망 역할

---

## 위험도 요약

| 시나리오 | 위험도 | 영향 | 해결 시급성 |
|----------|--------|------|------------|
| sessionId 누락 무료 분석 | ~~높음~~ **해결됨** | userId 기반 자동 조회로 해결 | 완료 |
| 서버 재시작 세션 소멸 | 중간 | 부정확한 정산 | 중기 |
| 30분 초과 세션 만료 | 중간 | 토큰 누락 + hold 만료 경합 | 중기 |
| 동시 세션 비용 증폭 | 중간 → 낮음 | 단일 세션 강제로 완화, orphaned hold 잔존 | - |
| 실제 > 예상 + 잔액 | 낮음 | 의도된 설계, MARGIN 완화 | - |
| settle 실패 후 저장 완료 | 낮음 | expire_stale_holds 안전망 | - |
