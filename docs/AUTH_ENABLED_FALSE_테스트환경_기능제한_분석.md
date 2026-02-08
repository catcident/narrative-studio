# AUTH_ENABLED=false 테스트 환경에서의 구독 기반 기능 제한 현황 분석

> 작성일: 2026-02-07
> 대상: Railway 등 인증 비활성화(`AUTH_ENABLED=false`) 테스트 환경

---

## 개요

`AUTH_ENABLED=false` 설정 시 billing API가 없으므로 `loadSubscription()`이 실패하고 클라이언트의 `subscription`은 `null`로 유지된다. 서버 사이드의 인증/과금/Rate Limit은 모두 정상적으로 비활성화되지만, 클라이언트 사이드에서 `subscription=null`일 때 일부 기능의 fallback 값이 "제한적"으로 설정되어 있어 테스트 환경에서도 기능이 차단되는 문제가 있다.

---

## 서버 사이드: 제한이 잘 풀려 있음

| 체크 항목 | 경로 | AUTH_ENABLED=false 시 동작 | 상태 |
|-----------|------|---------------------------|------|
| 인증 | `/api/analyze:39`, `/api/chat:126` | `if (AUTH_ENABLED)` 블록 전체 스킵 | OK |
| 잔액 확인 | `balanceCache.ts:51` | `return null` (항상 통과) | OK |
| Rate Limit | `analyze:52-62`, `chat:139-149` | 스킵됨 | OK |
| BYOK 제한 | `analyze:69`, `chat:156` | `AUTH_ENABLED &&` 조건 false → 스킵 | OK |
| 세션 hold/settle | `session/hold:9` | `{ error: 'Billing not available' }` 반환 | OK |

서버 사이드는 `AUTH_ENABLED` 조건 분기가 잘 되어 있어서 모든 인증/과금/Rate Limit이 완전히 비활성화된다.

---

## 클라이언트 사이드: 기능별 상세 분석

### 정상 동작하는 기능 (무제한 fallback)

| 기능 | 셀렉터/코드 | `subscription=null` 시 값 | 결과 |
|------|------------|--------------------------|------|
| 모델 선택 | `subscription?.features?.models` → `undefined` | 필터링 안 됨 → 전체 모델 표시 | OK |
| 채팅 횟수 | `max_chats_per_analysis ?? -1` | `-1` (무제한) | OK |
| 파일 크기 | `max_file_size_mb ?? Infinity` | `Infinity` (무제한) | OK |
| 잔액 표시 (CreditBadge) | `if (!subscription) return null` | 숨김 | OK |
| 잔액 알림 (BalanceAlertBanner) | `if (!subscription) return null` | 숨김 | OK |
| 비용 예상 (UsageEstimate) | `creditBalance !== null ? ... : true` | 항상 분석 가능 표시 | OK |

### 문제가 있는 기능 (제한적 fallback)

#### 1. 내보내기 (PNG/SVG/PDF) — 완전 차단

```typescript
// store.ts:303
const EMPTY_EXPORT_FORMATS: string[] = [];
export const useExportFormats = () =>
  useStore((s) => s.subscription?.features?.export_formats ?? EMPTY_EXPORT_FORMATS);
```

`subscription`이 `null`이면 `export_formats`가 빈 배열(`[]`)로 평가되어 모든 내보내기가 비활성화된다.

영향받는 컴포넌트:
- **`RelationshipGraph/index.tsx:49-52`**: `canPng`, `canSvg`, `canPdf` 모두 `false`
- **`DataManager.tsx:43`**: `canExport = exportFormats.length > 0` → `false`
- **`SavedDataGrid.tsx:41`**: 동일하게 내보내기 버튼 비활성화

#### 2. 배치 분석 — 차단

```typescript
// FileUpload.tsx:113
const canBatchAnalysis = (subscription?.features?.export_formats?.includes('pdf')) ?? false;
```

`export_formats`가 PDF 포함 여부로 배치 분석 권한을 판단하므로, `subscription=null`이면 배치 분석이 불가능하다.

#### 3. BYOK UI — 숨김 (실질적 영향 작음)

```typescript
// store.ts:301
export const useByokEnabled = () =>
  useStore((s) => s.subscription?.features?.byok ?? false);
```

서버 사이드에서는 BYOK를 허용하지만, `SubscriptionPage`에서 "API 키" 탭이 숨겨진다. 테스트 환경에서 BYOK가 필요할 일은 적으므로 실질적 영향은 미미하다.

---

## 관련 코드 경로 요약

| 파일 | 역할 | 핵심 라인 |
|------|------|-----------|
| `web/src/lib/auth.ts` | AUTH_ENABLED 플래그, 세션 헬퍼 | 7-8, 154-178 |
| `web/src/middleware.ts` | 라우트 보호, 로그인 리다이렉트 | 4-51 |
| `web/src/lib/balanceCache.ts` | 서버 사이드 잔액 캐시, 자격 확인 | 49-138 |
| `web/src/lib/rateLimit.ts` | 플랜별 Rate Limit | 18-24 |
| `web/src/app/api/analyze/route.ts` | 분석 엔드포인트 (인증/잔액/Rate Limit) | 36-77 |
| `web/src/app/api/chat/route.ts` | 채팅 엔드포인트 (과금 차감) | 107-164 |
| `web/src/app/api/session/hold/route.ts` | 크레딧 예약 엔드포인트 | 7-87 |
| `web/src/app/api/config/route.ts` | 클라이언트에 authEnabled 전달 | 5-6 |
| `web/src/store.ts` | Zustand 스토어 (subscription, features 셀렉터) | 294-306 |
| `web/src/types.ts` | PlanFeatures, BillingSubscription 타입 | 260-280 |
| `web/src/components/FileUpload/FileUpload.tsx` | 파일 업로드 (모델 필터, 파일 크기, 배치 분석) | 113, 128, 405 |
| `web/src/components/ChatView.tsx` | 채팅 (횟수 제한, 모델 필터) | 153, 427 |
| `web/src/components/RelationshipGraph/index.tsx` | 그래프 내보내기 (PNG/SVG/PDF) | 49-52 |
| `web/src/components/DataManager.tsx` | 데이터 관리 (내보내기) | 43 |
| `web/src/components/SavedDataGrid.tsx` | 저장 목록 (내보내기) | 41 |
| `web/src/components/CreditBadge.tsx` | 잔액 배지 | 19 |
| `web/src/components/UsageEstimate.tsx` | 비용 예상 | 32 |

---

## 수정 방향

`authEnabled=false`일 때 해당 셀렉터들의 fallback 값을 "전부 허용"으로 변경해야 한다.

예시 접근법:
- `useExportFormats()`: `authEnabled === false`이면 `['png', 'svg', 'pdf']` 반환
- `useByokEnabled()`: `authEnabled === false`이면 `true` 반환
- 배치 분석: `authEnabled === false`이면 `canBatchAnalysis = true`

또는 `subscription`이 `null`이고 `authEnabled === false`일 때 가상의 "전체 권한" subscription 객체를 주입하는 방법도 가능하다.

---

## 수정 완료 (2026-02-08)

### A. Hold/Settle 가드에 `subscription` null 체크 추가 (6곳)

hold 가드를 2단계로 분리:
1. `ensureSufficientBalance(subscription, authEnabled)` — 프로덕션 안전 체크
   - `subscription=null + authEnabled=true` → 에러 throw (프로덕션 보호)
   - `subscription=null + authEnabled=false` → 통과 (Railway 데모)
2. `if (subscription) { holdCredits... }` — billing 활성 시에만 hold

| 파일 | 함수 |
|------|------|
| `components/FileUpload/FileUpload.tsx` | handleFiles, handleResume, handleRegister |
| `hooks/useAddFileAnalysis.ts` | execute |
| `hooks/useBatchAnalysis.ts` | startProcessing |
| `hooks/useResumeAnalysis.ts` | resume |

### B. 셀렉터 permissive fallback (store.ts)

- `useByokEnabled()`: `authEnabled === false` → `true`
- `useExportFormats()`: `authEnabled === false` → `['png', 'svg', 'pdf']`

### C. 배치 분석 활성화 (FileUpload.tsx)

- `canBatchAnalysis`: `authEnabled === false` → `true`
