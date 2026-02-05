# 미해결 이슈 (Billing Integration)

> 브랜치: `feature/billing-integration`
> 최종 업데이트: 2026-02-05
>
> 이전 24건 → 모두 해결 (커밋 1fd1ac1, fbddf2a, b2d689c, 4746364, 6980bf4)
> 추가 11건 → 모두 해결 (커밋 1f89bd4)
> 리뷰 후 추가 발견 5건 → 모두 해결 (코드 리뷰 반영)
>
> **현재 미해결 이슈: 0건**

---

## 1. Auth 토큰 갱신 — 3건 (우선순위: 높음)

### 1-1. `session.error` 소비자 미구현

**심각도**: Important
**위치**: 클라이언트 전역 (App.tsx 또는 AuthProvider.tsx)

**현재 동작**:
`refreshAccessToken` 실패 시 `session.error = 'RefreshTokenError'`가 설정되지만, 이를 소비하여 재로그인을 유도하는 클라이언트 로직이 없습니다.

**영향**: 토큰 갱신 실패 후 조용히 인증 오류 발생. 사용자에게 피드백 없음.

**해결 방법**:
```typescript
// App.tsx 또는 전역 컴포넌트에서
const { data: session } = useSession();

useEffect(() => {
  if (session?.error === 'RefreshTokenError') {
    // 재로그인 다이얼로그 표시 또는 signOut() 호출
  }
}, [session?.error]);
```

---

### 1-2. 동시 토큰 갱신 경쟁 조건

**심각도**: Important
**위치**: `web/src/lib/auth.ts` JWT callback

**현재 동작**:
여러 API 요청이 동시에 만료된 토큰을 감지하면, 각각 `refreshAccessToken()`을 호출합니다.
Rotating refresh token 환경에서 첫 번째 갱신만 성공하고 나머지는 실패합니다.

**해결 방법**:
```typescript
let refreshPromise: Promise<TokenSet> | null = null;

async function refreshAccessToken(token: JWT): Promise<JWT> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh(token);
  try { return await refreshPromise; }
  finally { refreshPromise = null; }
}
```

---

### 1-3. 토큰 갱신 fetch timeout 미설정

**심각도**: Minor
**위치**: `web/src/lib/auth.ts` `refreshAccessToken`

**현재 동작**: 프로바이더 응답 지연 시 JWT callback이 무기한 대기합니다.

**해결 방법**:
```typescript
const response = await fetch(tokenUrl, {
  ...options,
  signal: AbortSignal.timeout(10000),
});
```

---

## 2. 클린업 & 데드 코드 — 6건 (우선순위: 중간)

### 2-1. DataManager/SavedDataGrid `refreshList` useEffect 클린업 누락

**위치**: `web/src/components/DataManager.tsx`, `web/src/components/SavedDataGrid.tsx`

**현재 동작**: 컴포넌트 언마운트 후 `setList()` 호출 가능 (React 경고).

**해결 방법**: `let cancelled = false; return () => { cancelled = true; }` 패턴 적용.

---

### 2-2. `estimateCredits()` API 함수 데드 코드

**위치**: `web/src/services/billing.ts`

**현재 동작**: `estimateCredits()` 서버 API 함수가 더 이상 사용되지 않습니다. `estimateUsageLocally()`와 `checkSufficientBalance()`로 대체됨.

**해결 방법**: 함수 제거 + 프록시 라우트 (`/api/billing/credits/estimate/route.ts`) + `ALLOWED_POST_FIELDS` 엔트리 함께 정리.

---

### 2-3. `hasProgress()` 단순 별칭

**위치**: `web/src/services/extraction/orchestrator.ts`

**현재 동작**: `hasProgress()` = `loadProgress()` 동일 함수.

**해결 방법**: 호출부를 `loadProgress()`로 통합하고 `hasProgress` 제거.

---

### 2-4. `knownCharacters` 하위 호환 필드

**위치**: `web/src/services/extraction/types.ts`, `orchestrator.ts`

**현재 동작**: `ExtractionProgress.knownCharacters` 필드가 `knownEntities` 추가 후에도 하위 호환용으로 유지됨.

**해결 방법**: 배포 후 24시간 경과 시 (localStorage 데이터 만료) `knownCharacters` 필드 및 폴백 로직 제거.

---

### 2-5. `extractor.ts` → `selector.ts` 단방향 import 잔존

**위치**: `web/src/services/extraction/extractor.ts:8`

**현재 동작**: `trimKnownEntities`를 `selector.ts`에서 import. 현재 동작에 문제는 없으나, 순환 의존 위험이 잠재적으로 존재.

**해결 방법**: `trimKnownEntities`를 `types.ts`로 이동하면 완전 분리.

---

### 2-6. `merger.ts` 미사용 export 2건

**위치**: `web/src/services/extraction/merger.ts`

**현재 동작**: `normalizeName`, `findSimilarEntity` — 내부에서만 사용되지만 `export` 키워드 보유.

**해결 방법**: `export` 키워드 제거.

---

## 3. 리팩터링 — 2건 (우선순위: 낮음)

### 3-1. 공통 `<ModalOverlay>` 컴포넌트 미추출

**위치**: UsageSummary, SubscriptionPage, DataManager, ResumePanel

**현재 동작**: 4개 모달이 동일한 오버레이 패턴 반복.
```tsx
<div className="fixed inset-0 bg-black/50 z-50"
     role="dialog" aria-modal="true" tabIndex={-1}
     onKeyDown={(e) => e.key === 'Escape' && onClose()}>
```

**해결 방법**: `<ModalOverlay onClose={...}>` 공통 컴포넌트로 추출.

---

### 3-2. App.tsx `handleAddFile` 중복 구현

**위치**: `web/src/App.tsx` `handleAddFile` vs `web/src/components/FileUpload/FileUpload.tsx` `executeAddFile`

**현재 동작**: 동일한 extraction → save → deduct 패턴이 두 곳에서 중복 구현.

**해결 방법**: App.tsx에서 FileUpload의 `executeAddFile`을 위임하는 방식으로 통합.
- `useImperativeHandle` + `forwardRef` 또는 store를 통한 트리거.

---

## 요약

| 우선순위 | 건수 | 카테고리 |
|---------|------|---------|
| 높음 | 3건 | Auth 토큰 갱신 (1-1, 1-2, 1-3) |
| 중간 | 6건 | 클린업 & 데드 코드 (2-1 ~ 2-6) |
| 낮음 | 2건 | 리팩터링 (3-1, 3-2) |
| **합계** | **11건** | |
