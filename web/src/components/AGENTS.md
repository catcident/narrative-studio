# Components

React UI 컴포넌트

## 주요 컴포넌트

### RelationshipGraph.tsx

React Flow 기반 인터랙티브 관계도 그래프

**뷰 모드**:
- `full`: 모든 엔티티 표시
- `simplified`: 캐릭터만 표시
- `focused`: 선택된 엔티티 + 1차 관계만

**노드 색상** (카테고리별):
| 카테고리 | 색상 |
|----------|------|
| character | 파랑 (#3b82f6) |
| location | 초록 (#22c55e) |
| organization | 보라 (#a855f7) |
| item | 노랑 (#eab308) |
| event | 빨강 (#ef4444) |
| concept | 회색 (#6b7280) |

**엣지 스타일** (관계 유형별):
- 가족: 실선, 두꺼움
- 연인: 빨간 점선
- 적대: 빨강, 대시
- 기타: 회색 실선

### FileUpload.tsx

파일 업로드 + AI 분석 트리거

**기능**:
- 드래그앤드롭 / 클릭 업로드
- PDF 파싱 (pdfjs-dist)
- 다중 파일 알파벳순 정렬 후 병합
- 모델 선택 드롭다운
- 이어하기 (Resume) 기능

**모델 잠금**: 기존 분석에 파일 추가 시 동일 모델 강제 (일관성 유지)

### DetailPanel.tsx

선택된 엔티티 상세 정보 패널

**표시 정보**:
- 이름, 별칭
- 카테고리, 중요도
- 설명
- 관련 관계 목록
- 등장 장면 목록

### PartialAnalysisBanner.tsx

메인 뷰어 header 아래 표시되는 부분 분석 인디케이터 배너.

**기능**:
- 중단된 분석 상태 표시 (타이틀, 청크 진행률, 상대 시간)
- "이어하기" / "삭제" 버튼
- `isResuming` 시 스피너 + 진행 텍스트
- `role="status"`, progress bar `role="progressbar"` + aria 속성

**Props**: `partialAnalysis`, `onResume`, `onClear`, `isResuming`, `resumeProgress`

### TimelineView.tsx / SceneTimeline.tsx

장면별 타임라인 시각화

**기능**:
- 장면 카드 시계열 배치
- 경과 시간 표시 (time_elapsed)
- 장(chapter) 구분
- 클릭 시 해당 장면 필터링

### CharacterChronicle.tsx

캐릭터 중심 연대기 뷰

**기능**:
- 선택된 캐릭터의 장면별 이벤트
- 감정 색상 표시 (positive/negative/neutral)
- 드래그 스크롤

### SavedDataGrid.tsx

저장된 지식 그래프 목록

**기능**:
- 카드 그리드 레이아웃
- 호버 시 액션 버튼 (삭제, 내보내기)
- 버전 히스토리 접근
- 로드/복원 기능

### SourceTextView.tsx

원본 소설 텍스트 뷰어

**기능**:
- 업로드된 원본 파일 목록
- 선택된 파일 내용 표시
- 글자 수 통계

### DataManager.tsx

데이터 관리 UI (Import/Export)

### AuthProvider.tsx

NextAuth.js SessionProvider 래퍼

### WorldView.tsx

전체 세계관 개요 뷰

### CreditBadge.tsx

헤더에 표시되는 크레딧 잔액 배지. 클릭 시 SubscriptionPage 모달 열기.

### UsageEstimate.tsx

분석 전 예상 비용 표시. Props: `{ charCount, model, text? }`.
- `text` prop 있으면 `estimateUsageFromText()` (스마트 청커 정확 계산), 없으면 `estimateUsageLocally()` (charCount 근사)
- 로컬 동기 계산 (API 호출 없음, `useMemo`)
- 주 표시: **크레딧 + 청크** (항상), 토큰 상세 (조건부 — `useShowTokenDetails()`)
- 잔액 비교: `creditBalance !== null`일 때만 분석 가능/불가 표시
- **주의**: charCount는 반드시 문자 수 (file.size bytes가 아님)

### UsageSummary.tsx

분석 완료 후 사용량 요약 모달. `store.showUsageSummary`로 표시 제어.
- 크레딧 표시: `settledCredits` (서버 정산값) 우선, 폴백으로 `calculateSessionCreditsFromChunks()` 근사치
- 주 표시: **크레딧 + 청크** (항상), 토큰 상세 (조건부 — `useShowTokenDetails()`)

### SubscriptionPage.tsx

구독 관리 모달 (탭: 플랜 비교 | 크레딧 구매 | 사용 내역 | API 키).
- "API 키" 탭은 `byokEnabled` 시에만 표시
- 키 마스킹: `key.length <= 10`이면 완전 마스킹 (`'••••••••••'`), 그 외 `sk-or-...xxxx`

### UsageHistory.tsx

크레딧 거래 내역 테이블 (페이지네이션). SubscriptionPage의 "사용 내역" 탭에서 사용.

---

## 접근성 패턴

### 아이콘 접근성

**규칙**: 모든 장식용 아이콘에 `aria-hidden="true"` 추가

```tsx
// ✅ lucide-react 아이콘
<Network className="w-8 h-8 text-white" aria-hidden="true" />

// ✅ 인라인 SVG
<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="..." />
</svg>

// ✅ 리스트 불릿 (장식용)
<div className="w-1.5 h-1.5 rounded-full bg-blue-500" aria-hidden="true" />
```

### 모달 접근성

**규칙**: 모든 모달은 키보드 접근성을 제공해야 함

```tsx
// ✅ 모달 필수 요소 (tabIndex={-1} 필수 — 없으면 Escape 키 미작동)
<div
  role="dialog"
  aria-modal="true"
  tabIndex={-1}
  onKeyDown={(e) => e.key === 'Escape' && onClose()}
>
  <button onClick={onClose} aria-label="닫기">
    <X aria-hidden="true" className="w-5 h-5" />
  </button>
</div>

// ❌ tabIndex 없는 모달 — div는 기본적으로 포커스 불가, onKeyDown 미작동
<div role="dialog" aria-modal="true" onKeyDown={...}>

// ❌ 키보드 접근성 없는 모달
<div className="fixed inset-0">
  <button onClick={onClose}>
    <X aria-hidden="true" />  {/* aria-label 없음 */}
  </button>
</div>
```

### 버튼 접근성

**규칙**: 텍스트 없는 아이콘 버튼은 반드시 `aria-label` 제공

```tsx
// ✅ 아이콘 + 텍스트: aria-label 불필요
<button><Coins aria-hidden="true" /> 크레딧</button>

// ✅ 아이콘만: aria-label 필수
<button aria-label="구독 관리"><Coins aria-hidden="true" /></button>

// ❌ title만으로는 부족 — 스크린 리더가 title을 일관되게 읽지 않음
<button title="삭제"><X aria-hidden="true" /></button>

// ✅ aria-label 사용 (title은 선택적 추가)
<button aria-label="삭제" title="삭제"><X aria-hidden="true" /></button>
```

**체크리스트** (새 UI 컴포넌트 작성 시):
- [ ] lucide-react 아이콘에 `aria-hidden="true"` 추가
- [ ] 인라인 SVG에 `aria-hidden="true"` 추가
- [ ] 장식용 요소(불릿, 구분선 등)에 `aria-hidden="true"` 추가
- [ ] 기능적 아이콘(버튼 없는 독립 아이콘)은 `aria-label` 제공
- [ ] 모달: `tabIndex={-1}` + Escape 키 닫기 + `role="dialog"` + `aria-modal="true"`
- [ ] 모달 닫기 버튼: `aria-label="닫기"` 추가
- [ ] 아이콘 전용 버튼: `aria-label` 필수 (`title`만으로는 부족)
- [ ] 정보/상태 배너: `role="status"` 추가 (`bg-*-50 border rounded-lg` 스타일 배너)
- [ ] 반응형 숨김: `hidden md:block` 금지 → `sr-only md:not-sr-only` 사용 (스크린 리더 접근성 보존)
- [ ] 플랜 코드별 분기: switch/helper 함수 사용 (중첩 삼항 금지, `getPlanBadgeColor()` 패턴)
- [ ] 카드 그리드 버튼 정렬: 가변 콘텐츠 카드 → `flex flex-col` + 콘텐츠 영역 `flex-1` (높이 불일치 방지)
- [ ] className 조건부 분기: 헬퍼 함수 추출 (`getGridLayoutClass()`, `getPlanCardStyle()` 패턴)
- [ ] 동일 데이터 다중 페이지 렌더링: 공유 유틸리티 사용 (`buildPlanFeatureStrings()` — 문구 불일치 방지)

### 카드 레이아웃 패턴

**규칙**: 카드 그리드에서 콘텐츠 길이가 가변적일 때 (기능 목록, 보너스 텍스트 등) 반드시 flex 레이아웃으로 버튼/CTA 위치를 하단 고정

```tsx
// ✅ 가변 콘텐츠 카드 — 버튼 하단 정렬
<div className="border rounded-xl p-5 flex flex-col">
  <h3>제목</h3>
  <div className="flex-1">가변 길이 콘텐츠</div>
  <button className="mt-auto">CTA 버튼</button>
</div>

// ❌ flex 없는 카드 — 콘텐츠 길이에 따라 버튼 위치 불일치
<div className="border rounded-xl p-5">
  <h3>제목</h3>
  <div>가변 길이 콘텐츠</div>
  <button>CTA 버튼</button>
</div>
```

### 반응형 숨김과 접근성

**규칙**: 의미 있는 텍스트를 반응형으로 숨길 때 `hidden`/`display:none` 사용 금지. `sr-only` + 반응형 `not-sr-only`로 시각적으로만 숨기기.

```tsx
// ❌ hidden md:block — 접근성 트리에서 완전 제거, 스크린 리더가 읽을 수 없음
<h1 className="hidden md:block">인물 관계도</h1>

// ✅ sr-only md:not-sr-only — 768px 미만에서 시각적으로만 숨김, 스크린 리더는 항상 접근 가능
<h1 className="sr-only md:not-sr-only">인물 관계도</h1>

// ✅ 순수 장식 요소는 hidden 사용 가능 (접근성 영향 없음)
<span className="hidden lg:inline text-sm text-gray-500">{metadata}</span>
```

**적용 기준**: `<h1>`~`<h6>`, `<label>`, `role="status"`, 내비게이션 링크 등 의미적 요소에 적용. 순수 보충 텍스트(부가 통계, 장식 라벨)는 `hidden` 사용 가능.

### 플랜 코드 분기 패턴

**규칙**: 플랜 코드(plan code)에 따른 분기는 switch문 또는 별도 helper 함수 사용. 중첩 삼항 연산자 금지.

```tsx
// ❌ 중첩 삼항 — 가독성 낮고 분기 추가 시 누락 위험
const color = planCode === 'business' ? 'amber'
  : planCode === 'pro' ? 'purple'
  : planCode === 'basic' ? 'blue'
  : 'gray';

// ✅ switch helper — 확장 용이, SubscriptionPage planColor() 패턴
function getPlanBadgeColor(planCode: string): string {
  switch (planCode) {
    case 'business': return 'bg-amber-100 text-amber-700';
    case 'pro': return 'bg-purple-100 text-purple-700';
    case 'basic': return 'bg-blue-100 text-blue-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}
```

**UI 텍스트 규칙**: 특정 플랜명 하드코딩 금지 → 일반화 표현 사용

```tsx
// ❌ 특정 플랜명 하드코딩 — 비공개 플랜 사용자에게 부적절
return '크레딧 소진 — Pro 업그레이드 또는 패키지 구매';

// ✅ 일반화 표현
return '크레딧 소진 — 플랜 업그레이드 또는 패키지 구매';
```

### 타입 안전성

**규칙**: NextAuth Session 타입 확장을 활용하고 `as any` 타입 단언 지양

```tsx
// ❌ 타입 단언 지양
{(session.user as any)?.nickname}

// ✅ 타입 확장 활용 (lib/auth.ts에 선언됨)
{session.user.nickname}
```

**참조**: `types/next-auth.d.ts`의 `declare module 'next-auth'` 타입 확장 (단일 정의 위치)

### 에러 타입

**규칙**: `catch` 블록에서 `err: any` 대신 `err: unknown` 사용

```tsx
// ❌ any → 타입 안전성 우회
catch (err: any) {
  setError(err.message);
}

// ✅ unknown → 타입 가드 필수
catch (err: unknown) {
  const message = err instanceof Error ? err.message : '알 수 없는 오류';
  setError(message);
}
```

### Discriminated Union 반환 타입 사용

**규칙**: 성공/실패를 구분하는 함수는 discriminated union 반환 타입을 사용하고, 호출부에서 type narrowing 후 접근

```tsx
// ✅ 함수 정의 — 성공/실패 분기
async function checkSomething(): Promise<{ ok: true } | { ok: false; error: string }> { ... }

// ✅ 호출부 — type narrowing 후 접근
const result = await checkSomething();
if (!result.ok) throw new Error(result.error);  // result.error 안전 접근

// ❌ destructuring → 모든 프로퍼티가 존재한다고 가정
const { ok, error } = await checkSomething();
if (!ok) throw new Error(error);  // TS2339: Property 'error' does not exist
```

### useCallback 의존성 완전성

**규칙**: `useCallback` 내에서 참조하는 모든 클로저 변수는 의존성 배열에 포함

```tsx
// ❌ bookTitle을 내부에서 사용하지만 deps에 누락 → stale closure
const handleSubmit = useCallback(() => {
  console.log(bookTitle);  // 항상 초기값만 캡처
}, []);

// ✅ 사용하는 모든 변수 포함
const handleSubmit = useCallback(() => {
  console.log(bookTitle);
}, [bookTitle]);
```

---

## 시각화 패턴

### 노드 크기

중요도(importance) 기반:
- 10: 가장 큼 (주인공)
- 5: 중간 (기본값)
- 1: 가장 작음 (단순 언급)

### 레이아웃

React Flow `dagre` 레이아웃 사용:
- 방향: TB (위→아래)
- 노드 간격: 50px
- 랭크 간격: 100px

---

## 에러 처리 패턴

### API 호출

```tsx
// ✅ try-catch + [prefix] 로깅 + graceful fallback
try {
  const data = await apiCall();
  // ...
} catch (err: unknown) {
  console.error('[billing] operation error:', err);
  // UI에 에러 상태 표시 또는 null 반환
}

// ✅ 공용 catalog source 1회 로드 + .catch + .finally
getPublicPricingCatalog()
  .then((result) => {
    if (!result.ok) return;
    setPlans(result.data.plans);
    setPackages(result.data.topup_packages);
  })
  .catch((error) => console.error('[billing] load error:', error))
  .finally(() => setLoading(false));
```

### JSON 파싱

```tsx
// ✅ 서버 프록시에서 response.json() 실패 대비
const data = await response.json()
  .catch(() => ({ error: 'Invalid response from billing service' }));
```

### 프로그레스 상태 초기화

FileUpload에서 `resetProgressState()` 헬퍼 사용:
```tsx
// 성공 경로: savedProgress를 null로 설정
resetProgressState();

// 에러 경로: savedProgress를 다시 확인
resetProgressState(true);
```

---

## Zustand Billing 상태

### Store 필드

```typescript
subscription: BillingSubscription | null;  // 계정 수준 (reset()에서 유지)
currentUsage: CurrentUsage;                // 분석 세션 수준 (reset()에서 초기화)
showUsageSummary: boolean;                 // 분석 세션 수준 (reset()에서 초기화)
settledCredits: number | null;             // 서버 정산 크레딧 (resetCurrentUsage에서 초기화)
```

### 셀렉터 훅

```typescript
useBillingSubscription()  // subscription 객체
useCreditBalance()        // creditBalance 또는 null
useSettledCredits()       // 서버 정산 크레딧 (settle 후 설정, 세션 시작 시 null)
```

### ⚠️ Zustand 셀렉터 규칙

**규칙**: 컴포넌트에서 `useStore()` 호출 시 반드시 개별 셀렉터 사용

```tsx
// ❌ 전체 스토어 구독 → 불필요한 리렌더링
const { currentUsage, showUsageSummary } = useStore();

// ✅ 개별 셀렉터 → 해당 필드 변경 시에만 리렌더링
const currentUsage = useStore((s) => s.currentUsage);
const showUsageSummary = useStore((s) => s.showUsageSummary);

// ✅ 전용 셀렉터 훅 사용
const subscription = useBillingSubscription();
const balance = useCreditBalance();
```

### useEffect 클린업 규칙

**규칙**: 비동기 데이터 로딩 useEffect는 반드시 언마운트 대비

```tsx
// ✅ cancelled flag로 stale update 방지
useEffect(() => {
  let cancelled = false;
  fetchData().then(data => {
    if (!cancelled) setData(data);
  });
  return () => { cancelled = true; };
}, [deps]);
```
