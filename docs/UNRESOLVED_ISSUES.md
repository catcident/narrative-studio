# ~~미해결~~ → 해결 완료된 이슈 상세 (Billing Integration)

> 브랜치: `feature/billing-integration`
> 리뷰 일자: 2026-02-05
> **해결 완료**: 2026-02-05 (커밋 1fd1ac1, fbddf2a, b2d689c, 4746364)
> 리뷰 방법: 4개 도메인별 코드 리뷰 + 전체 통합 리뷰 + 코드 단순화 + 재발 방지 조치
>
> **상태: 아래 24건 모두 해결 완료.** 리뷰 과정에서 추가 발견된 이슈(8건)는 별도 PR로 처리 예정.

총 24건의 이슈가 4개 카테고리로 분류됩니다.
각 이슈에 대해 위치, 현재 동작, 문제점, 해결 방법을 기술합니다.

---

## 1. 보안 (Security) — 4건

### S1. POST 프록시 body 무검증 전달

**심각도**: Critical
**위치**: `web/src/services/billingProxy.ts` — `billingPostHandler` → `handleProxy`

**현재 동작**:
```typescript
const body = await request.text();
const response = await proxyToCatcident(billingPath, authResult.accessToken, { method: 'POST', body });
```
클라이언트가 보낸 JSON body를 파싱/검증 없이 그대로 catcident-backend로 전달합니다.

**문제점**:
- 악의적 클라이언트가 `service`, `user_id`, `amount`(음수) 등 특권 필드를 주입 가능
- 예: `{ "amount": -1000, "service": "other_service" }` 전송 시 다른 서비스의 크레딧 조작 가능성

**해결 방법**:
```typescript
// billingProxy.ts에 POST body 검증 추가
async function handleProxy(billingPath: string, logLabel: string, options?: { method?: string; body?: string }) {
  // ... auth 체크 후 ...

  // POST body 화이트리스트 검증
  if (options?.body) {
    const parsed = JSON.parse(options.body);
    const allowed = pickAllowedFields(parsed, billingPath);
    allowed.service = 'storygraph'; // 서버 강제 주입
    options = { ...options, body: JSON.stringify(allowed) };
  }

  // ... proxy 호출 ...
}

function pickAllowedFields(body: Record<string, unknown>, path: string): Record<string, unknown> {
  if (path.includes('/credits/deduct')) {
    const { amount, description, metadata, idempotency_key } = body;
    return { amount, description, metadata, idempotency_key };
  }
  if (path.includes('/credits/estimate')) {
    const { char_count, model } = body;
    return { char_count, model };
  }
  return {};
}
```

**영향 범위**: `billingProxy.ts`, 모든 POST billing 라우트

---

### S2. 업스트림 에러 응답 클라이언트 노출

**심각도**: Critical
**위치**: `web/src/services/billingProxy.ts:69-71, 92-94`

**현재 동작**:
```typescript
// handleProxy 내부
let data;
try { data = await response.json(); }
catch { return NextResponse.json({ error: 'Invalid response from billing service' }, { status: 502 }); }
return NextResponse.json(data, { status: response.status });
```
`response.status`가 400/403/500일 때도 `data`(백엔드 에러 본문)를 그대로 반환합니다.

**문제점**:
- Django 디버그 모드의 스택 트레이스, 내부 필드명, DB 에러 등이 클라이언트에 노출
- 보안 스캐너에서 정보 유출(Information Disclosure)로 분류

**해결 방법**:
```typescript
if (!response.ok) {
  console.error(`[billing] ${logLabel} upstream error:`, response.status, data);
  return NextResponse.json(
    { error: 'Billing service error' },
    { status: response.status >= 500 ? 502 : response.status }
  );
}
return NextResponse.json(data);
```

**영향 범위**: `billingProxy.ts` (`handleProxy` 함수)

---

### S3. POST deduct 라우트 `service` 서버 강제 미적용

**심각도**: Important
**위치**: `web/src/app/api/billing/credits/deduct/route.ts`

**현재 동작**:
```typescript
export const POST = billingPostHandler('/credits/deduct/', 'credits/deduct POST');
```
GET 라우트들은 URL에 `?service=storygraph`를 하드코딩하지만, POST 라우트는 클라이언트 body에 의존합니다.

**문제점**:
- 클라이언트가 `service` 필드를 다른 값으로 조작 가능
- GET은 서버 강제, POST는 클라이언트 의존 — 일관성 없음

**해결 방법**: S1의 body 검증에서 `service: 'storygraph'` 서버 주입으로 함께 해결.

---

### S4. OAuth access token 갱신 미구현

**심각도**: Important
**위치**: `web/src/lib/auth.ts:77-81`

**현재 동작**:
```typescript
token.accessToken = account.access_token;
token.refreshToken = account.refresh_token;
token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : undefined;
```
만료 시간은 저장하지만 갱신 로직이 없어, 만료 후에도 stale 토큰을 계속 사용합니다.

**문제점**:
- 장시간 세션에서 billing API 401 에러 발생
- 사용자가 로그아웃/재로그인해야 해결

**해결 방법**:
```typescript
// jwt 콜백에서 만료 체크 + 갱신
async jwt({ token, account }) {
  // 초기 로그인
  if (account) { /* 토큰 저장 */ }

  // 만료 전이면 그대로 반환
  if (token.accessTokenExpires && Date.now() < token.accessTokenExpires - 60000) {
    return token;
  }

  // 갱신 시도
  if (token.refreshToken) {
    try {
      const response = await fetch(`${OIDC_ISSUER}/oauth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token.refreshToken,
          client_id: process.env.AUTH_CATCIDENT_ID!,
        }),
      });
      const data = await response.json();
      token.accessToken = data.access_token;
      token.refreshToken = data.refresh_token ?? token.refreshToken;
      token.accessTokenExpires = Date.now() + data.expires_in * 1000;
    } catch (error) {
      console.error('[auth] Token refresh failed:', error);
    }
  }
  return token;
}
```

**영향 범위**: `auth.ts`, 장시간 세션 사용자

---

## 2. Billing 흐름 — 7건

### B1. `selectRelevantEntities` LLM 호출 billing 미추적

**심각도**: Critical
**위치**: `web/src/services/extraction/selector.ts:113-133`

**현재 동작**:
```typescript
const response = await fetchWithClientTimeout(/* ... */);
const data = await response.json();
const content = data.choices?.[0]?.message?.content || '';
// data._billing 존재하나 완전히 무시됨
```
`selectRelevantEntities()`는 청크마다 `gemini-2.0-flash-001`로 LLM 호출하여 관련 엔티티를 선별합니다. 이 호출의 `_billing` 데이터가 수집되지 않습니다.

**문제점**:
- 매 청크마다 발생하는 LLM 호출 비용이 누적되어도 billing에 반영 안 됨
- 50개 청크 분석 시 최대 50회의 추가 미추적 LLM 호출

**해결 방법**:
```typescript
// selector.ts — _billing 반환 추가
export async function selectRelevantEntities(
  knownEntities: KnownEntity[],
  chunkText: string,
  model: string,
): Promise<{ selected: KnownEntity[]; billing?: ChunkBillingData }> {
  // ... 기존 로직 ...
  const billing = data._billing ? {
    model: 'google/gemini-2.0-flash-001',
    promptTokens: data._billing.prompt_tokens || 0,
    completionTokens: data._billing.completion_tokens || 0,
  } : undefined;

  return { selected: filteredEntities, billing };
}

// orchestrator.ts — 선별 billing 누적
const { selected, billing: selectionBilling } = await selectRelevantEntities(/*...*/);
if (selectionBilling && onChunkBilling) {
  onChunkBilling(selectionBilling);
}
```

**영향 범위**: `selector.ts`, `orchestrator.ts`, `types.ts`

---

### B2. `handleAddFile` (App.tsx) 잔액 사전 확인 없음

**심각도**: Critical
**위치**: `web/src/App.tsx:116-167`

**현재 동작**:
```typescript
const handleAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file || !knowledgeGraph) return;
  setIsAddingFile(true);
  // → 바로 extractKnowledgeGraph 호출 (잔액 확인 없음)
```

**문제점**:
- 잔액 부족 시에도 분석이 시작됨 → API 비용 소비 → 차감 시도 시 실패
- `handleRegister`만 잔액 확인 (`fetchCreditBalance` + `estimateCredits`)

**해결 방법**:
```typescript
// 공유 유틸리티 추출
async function checkCreditBalance(charCount: number, model: string): Promise<boolean> {
  const balance = await getCreditBalance();
  if (balance === null) return true; // billing 비활성 시 통과
  const estimate = await estimateCredits(charCount, model);
  if (estimate && balance < estimate.estimated_credits) {
    return false; // 잔액 부족
  }
  return true;
}

// App.tsx handleAddFile에 적용
const text = await readFileAsText(file);
const charCount = text.length;
if (subscription) {
  const canAfford = await checkCreditBalance(charCount, knowledgeGraph.metadata?.model || DEFAULT_MODEL);
  if (!canAfford) {
    setError('크레딧이 부족합니다.');
    return;
  }
}
```

**영향 범위**: `App.tsx`, `billing.ts` (공유 유틸), FileUpload의 모든 분석 진입점

---

### B3. 6개 분석 진입점 중 5개 잔액 미확인

**심각도**: Important
**위치**: `web/src/components/FileUpload/FileUpload.tsx` (여러 핸들러)

**현재 동작**:
| 진입점 | 잔액 확인 |
|--------|-----------|
| `handleRegister` | ✅ 확인 |
| `handleFiles` (기존 그래프에 파일 추가) | ❌ |
| `handleResume` (이어하기) | ❌ |
| `executeAddFile` (파일 추가 실행) | ❌ |
| `App.tsx handleAddFile` (헤더 추가) | ❌ |

**해결 방법**: B2의 `checkCreditBalance` 공유 유틸리티를 `runExtraction` 래퍼 안에 통합하면 모든 진입점에 일괄 적용됩니다.

---

### B4. Idempotency key에 `Date.now()` 사용

**심각도**: Critical
**위치**: `web/src/services/billing.ts:274, 303`

**현재 동작**:
```typescript
const idempotencyKey = `storygraph-${savedId}-${Date.now()}`;     // deductAfterSave
const idempotencyKey = `storygraph-partial-${Date.now()}`;        // deductPartial
```

**문제점**:
- 매 호출마다 다른 키 → 네트워크 에러 후 재시도 시 중복 차감
- Idempotency key의 목적이 완전히 무력화됨

**해결 방법**:
```typescript
// deductAfterSave — 저장 결과 기반 결정론적 키
const idempotencyKey = `storygraph-${savedId}-${currentUsage.chunks.length}`;

// deductPartial — 분석 컨텍스트 기반 결정론적 키
const titleHash = title.slice(0, 20).replace(/\s/g, '_');
const idempotencyKey = `storygraph-partial-${titleHash}-${currentUsage.chunks.length}`;
```

**영향 범위**: `billing.ts` (`deductUsage` 내부 헬퍼)

---

### B5. `idempotencyKey` 파라미터 optional

**심각도**: Important
**위치**: `web/src/services/billing.ts:109`

**현재 동작**:
```typescript
export async function deductCredits(
  amount: number,
  description: string,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string,  // optional
)
```

**문제점**:
- 미래 호출자가 키를 생략해도 컴파일 에러 없음 → 중복 차감 위험

**해결 방법**:
```typescript
idempotencyKey: string,  // required로 변경
```

---

### B6. 혼합 모델 크레딧 단일 모델 기준 계산

**심각도**: Important
**위치**: `web/src/components/UsageSummary.tsx:23`, `web/src/services/billing.ts:267`

**현재 동작**:
```typescript
const model = currentUsage.chunks[0]?.model ?? '';
const creditsUsed = calculateCreditsFromTokens(
  currentUsage.totalPromptTokens,
  currentUsage.totalCompletionTokens,
  model,  // 첫 번째 청크의 모델만 사용
);
```

**문제점**:
- `selectRelevantEntities`는 `gemini-2.0-flash-001` 사용 (B1 해결 후 billing 추적 시)
- 사용자 선택 모델이 `claude-3.5-sonnet`이면 30배 비용 차이
- 총 토큰을 단일 모델 단가로 계산하면 부정확

**해결 방법**:
```typescript
// 청크별 개별 계산 후 합산
const creditsUsed = currentUsage.chunks.reduce((sum, chunk) => {
  return sum + calculateCreditsFromTokens(chunk.promptTokens, chunk.completionTokens, chunk.model);
}, 0);
```

---

### B7. 차감 실패 후 subscription 재동기화 없음

**심각도**: Important
**위치**: `web/src/services/billing.ts` — `deductUsage` 내부

**현재 동작**: `deductCredits`가 `null` 반환 시 (네트워크 에러 등) `updateCreditBalance`가 호출되지 않아 로컬 잔액이 차감 전 값으로 유지됩니다.

**문제점**:
- `CreditBadge`에 부정확한 잔액 표시
- 다음 분석 시 잔액 확인이 실제보다 높은 값으로 진행

**해결 방법**:
```typescript
// deductUsage에서 실패 시 서버 잔액 재동기화
const result = await deductCredits(credits, description, metadata, idempotencyKey);
if (result?.new_balance !== undefined) {
  updateCreditBalance(result.new_balance);
} else {
  // 차감 실패 시 서버에서 실제 잔액 재조회
  const serverBalance = await getCreditBalance();
  if (serverBalance !== null) updateCreditBalance(serverBalance);
}
```

---

## 3. 접근성 (Accessibility) — 3건

### A1. UsageSummary/SubscriptionPage 모달 `tabIndex` 누락

**심각도**: Critical
**위치**: `web/src/components/UsageSummary.tsx:31`, `web/src/components/SubscriptionPage.tsx:68`

**현재 동작**:
```tsx
<div className="fixed inset-0 bg-black/50 z-50 ..."
     role="dialog" aria-modal="true"
     onKeyDown={(e) => e.key === 'Escape' && close()}>
```
`<div>`는 기본적으로 포커스 불가 → `onKeyDown` 이벤트를 받지 못함 → Escape 키 미작동.

**해결 방법**:
```tsx
<div tabIndex={-1}
     role="dialog" aria-modal="true"
     onKeyDown={(e) => e.key === 'Escape' && close()}>
```

**영향 범위**: `UsageSummary.tsx`, `SubscriptionPage.tsx`

---

### A2. ResumePanel 모달 `role="dialog"`, `aria-modal` 누락

**심각도**: Critical
**위치**: `web/src/components/FileUpload/ResumePanel.tsx:100`

**현재 동작**:
```tsx
<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
```
중복 파일명 입력 모달에 접근성 속성이 전혀 없습니다.

**해결 방법**:
```tsx
<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
     role="dialog" aria-modal="true" tabIndex={-1}
     onKeyDown={(e) => { if (e.key === 'Escape') setDuplicateFileName(null); }}>
```

---

### A3. AnalysisPanel 아이콘 버튼 `aria-label` 누락

**심각도**: Important
**위치**: `web/src/components/FileUpload/AnalysisPanel.tsx:283-305`

**현재 동작**:
```tsx
<button title="위로 이동">
  <ChevronUp aria-hidden="true" className="w-4 h-4" />
</button>
<button title="아래로 이동">
  <ChevronDown aria-hidden="true" className="w-4 h-4" />
</button>
<button title="삭제">
  <X aria-hidden="true" className="w-4 h-4" />
</button>
```
`title`만 있고 `aria-label`이 없어 스크린 리더에서 버튼 목적을 인식할 수 없습니다.

**해결 방법**:
```tsx
<button aria-label="위로 이동" title="위로 이동">
<button aria-label="아래로 이동" title="아래로 이동">
<button aria-label="삭제" title="삭제">
```

---

## 4. 코드 품질 — 10건

### Q1. `extractor.ts` ↔ `selector.ts` 순환 의존

**심각도**: Important
**위치**: `web/src/services/extraction/extractor.ts:8`, `selector.ts:9`

**현재 상태**:
```
extractor.ts → import { trimKnownEntities } from './selector'
selector.ts  → import { fetchWithClientTimeout } from './extractor'
```

**해결 방법**: `fetchWithClientTimeout`를 `types.ts`로 이동하여 순환 제거.

---

### Q2. `buildKnowledgeGraph`에서 영문 관계 타입 사용

**심각도**: Important
**위치**: `web/src/services/extraction/merger.ts:601-605`

**현재 동작**:
```typescript
let relationType = 'related';
if (entity.category === 'location') relationType = 'location';
if (entity.category === 'object') relationType = 'ownership';
```
`normalizeAllRelationTypes` 이후에 생성되는 관계라 정규화 안 됨.

**해결 방법**: `'관련'`, `'위치'`, `'소유'` 한국어 직접 사용.

---

### Q3. `ExtractionProgress.knownCharacters` — character만 보존

**심각도**: Minor
**위치**: `web/src/services/extraction/orchestrator.ts:107`

**현재 동작**: `knownEntities.filter(e => e.category === 'character')` — resume 시 location, item 등 유실.

**해결 방법**: 필드를 `knownEntities: KnownEntity[]`로 변경하고 전체 보존.

---

### Q4. FileUpload `bookTitle`/`bookAuthor` useCallback 의존성 누락

**심각도**: Important (stale closure bug)
**위치**: `web/src/components/FileUpload/FileUpload.tsx` — `handleFiles`, `handleFile` deps

**현재 동작**: 내부에서 `bookTitle.trim()`, `bookAuthor.trim()` 참조하지만 의존성 배열에 미포함.

**해결 방법**: 의존성 배열에 `bookTitle`, `bookAuthor` 추가.

---

### Q5. FileUpload `/api/config` useEffect 클린업 누락

**심각도**: Minor
**위치**: `web/src/components/FileUpload/FileUpload.tsx:83-103`

**해결 방법**: `let cancelled = false;` + `return () => { cancelled = true; };` 패턴 적용.

---

### Q6. App.tsx 자동저장 useEffect 클린업 누락

**심각도**: Minor
**위치**: `web/src/App.tsx:71-107`

**해결 방법**: 자동저장 async 함수에 `cancelled` flag 적용.

---

### Q7. App.tsx `handleAddFile` 중복

**심각도**: Minor
**위치**: `web/src/App.tsx:116-167`

**현재 상태**: FileUpload의 `runExtraction`/`saveAndDeduct`와 동일한 패턴을 별도 구현.

**해결 방법**: FileUpload에 `executeAddFile` 콜백을 prop으로 노출하고 App.tsx에서 위임.

---

### Q8. 로깅 접두사 불일치

**심각도**: Minor
**위치**: `web/src/services/extraction/` 여러 파일

**현재 상태**: `[선별]`, `[병합]`, `[병합 완료]` 등 서브모듈별 다른 접두사.

**해결 방법**: `[extraction:selector]`, `[extraction:merger]` 형태로 통일.

---

### Q9. `catch (err: any)` 사용

**심각도**: Minor
**위치**: `web/src/App.tsx:155`, `DataManager.tsx:112`, `SavedDataGrid.tsx:111`

**해결 방법**: `catch (err: unknown)` + `err instanceof Error ? err.message : '...'` 패턴.

---

### Q10. `elapsedSeconds` 의존성 배열 누락

**심각도**: Minor
**위치**: `web/src/components/FileUpload/FileUpload.tsx:119-124`

**현재 동작**: `useEffect` 내에서 `elapsedSeconds` 참조하지만 deps에 미포함.

**해결 방법**: `[progressCurrent, progressTotal, elapsedSeconds]`로 변경.

---

## 우선순위 권고

### 즉시 수정 (다음 커밋)
1. **B4** — Idempotency key Date.now() → 결정론적 값 (billing 안전)
2. **S2** — 업스트림 에러 응답 sanitization (보안)
3. **A1, A2, A3** — 모달/버튼 접근성 (접근성 기본)
4. **Q2** — 영문 관계 타입 → 한국어 (데이터 일관성)
5. **Q4** — useCallback deps 누락 (stale closure bug)

### 단기 (이번 PR 내)
6. **S1, S3** — POST body 검증 + service 서버 강제 (보안)
7. **B1** — selector billing 추적 (비용 정확성)
8. **B2, B3** — 잔액 사전 확인 통합 (UX)
9. **B5** — idempotencyKey required (API 안전)
10. **Q1** — 순환 의존 해소 (코드 구조)

### 중기 (별도 PR)
11. **B6** — 혼합 모델 크레딧 계산 (정확성)
12. **B7** — 차감 실패 후 재동기화 (UX)
13. **S4** — OAuth 토큰 갱신 (장시간 세션)
14. **Q7** — handleAddFile 중복 제거 (유지보수)

### 저위험 (리팩토링 시)
15. Q3, Q5, Q6, Q8, Q9, Q10
