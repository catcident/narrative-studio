# 미해결 이슈 (Billing Integration)

> 브랜치: `feature/billing-integration`
> 최종 업데이트: 2026-02-05
>
> 이전 24건 → 모두 해결 (커밋 1fd1ac1, fbddf2a, b2d689c, 4746364, 6980bf4)
> 추가 11건 → 모두 해결 (커밋 1f89bd4)
> 리뷰 후 추가 발견 5건 → 모두 해결 (코드 리뷰 반영)
> 청크별 차감 리팩토링 후 코드 리뷰/심플리파이어 ~25건 → 모두 해결 (커밋 26a355c, 1f7c1aa, 6ef72b7, a124ae4)
> 추가 6건 해결: SF-1, SF-2, SF-5, SF-7, CS-7(selector), CS-8
>
> **현재 미해결 이슈: 0건** (전부 해결 완료)
>
> CS-1: useAddFileAnalysis 훅으로 중복 제거 (커밋 참조)
> CS-7/CS-11: MergedExtraction + AccumulatedGraph 타입 도입 (커밋 참조)
> CHAT-1: decideConnectedNodes billing 수집 + 채팅 세션 hold/settle 전환 (2026-02-08)

---

## 해결된 이전 이슈 (총 40건+)

<details>
<summary>클릭하여 펼치기</summary>

### Auth 토큰 갱신 — 3건

| # | 이슈 | 해결 내용 |
|---|------|-----------|
| 1-1 | session.error 소비자 미구현 | `useSessionErrorHandler` 훅 + AuthProvider 통합 |
| 1-2 | 동시 토큰 갱신 경쟁 조건 | `refreshPromise` 싱글턴 패턴 |
| 1-3 | 토큰 갱신 fetch timeout | `AbortSignal.timeout(10_000)` 추가 |

### 클린업 & 데드 코드 — 6건

| # | 이슈 | 해결 내용 |
|---|------|-----------|
| 2-1 | DataManager/SavedDataGrid useEffect 클린업 | `cancelled` flag 패턴 적용 |
| 2-2 | estimateCredits 데드 코드 | 함수 + API 라우트 + 프록시 화이트리스트 제거 |
| 2-3 | hasProgress 별칭 | 제거, `loadProgress()`로 통합 |
| 2-4 | knownCharacters 하위 호환 필드 | types.ts + orchestrator.ts에서 완전 제거 |
| 2-5 | trimKnownEntities 모듈 위치 | selector.ts → types.ts 이동 (extractor↔selector 의존 해소) |
| 2-6 | merger.ts 불필요 export | `normalizeName`, `findSimilarEntity` private화 |

### 리팩터링 — 2건

| # | 이슈 | 해결 내용 |
|---|------|-----------|
| 3-1 | ModalOverlay 공통 컴포넌트 | 4개 모달에 적용 |
| 3-2 | App.tsx handleAddFile 패턴 | 기존 패턴 확인 — 이미 올바름 |

### 청크별 차감 리팩토링 후 코드 리뷰 — ~25건

코드 리뷰(6개 에이전트), 코드 심플리파이어(4개 에이전트), silent failure audit를 통해 발견된 즉시 수정 가능 항목들:

- auth 실패 시 silent bypass → `return authResult.error;` 처리
- double `requireAuth()` → `checkAnalyzeEligibility(userId, accessToken)` 리팩토링
- non-null assertion → `DeductResult` 인터페이스 + 로컬 타입 변수
- `loopCompleted` 플래그로 resume progress 보존
- `saveCurrentProgress(i)` vs `(i+1)` 인덱스 수정
- selector 402 명시 처리
- `catch (err: unknown)` 타입 가드 통일
- `ensureSufficientBalance()` 헬퍼 추출
- `updateBalanceCache` NaN/Infinity 방어
- config fetch 실패 로깅
- 문서 정확성 수정 7건 (OAuth scope, DEFAULT_MODEL, entity limits 등)
- dead code 제거 (`invalidateBalanceCache`, `stripMarkdownCodeBlock` re-export)
- onChunkBilling 가드 패턴 통일

### 미해결 이슈 개선 — 6건

| # | 이슈 | 해결 내용 |
|---|------|-----------|
| SF-1 | billing-disabled vs billing-broken 구분 불가 | `BillingResult<T>` discriminated union 반환 타입 도입 |
| SF-2 | billingFetch 에러 타입 통합 | `billingFetch`/`billingFetchList` 리라이트, 401 별도 분기 |
| SF-5 | 네트워크 에러 시 서버 측 차감 데이터 유실 | 분석 완료 후 `loadSubscription()` 잔액 재동기화 |
| SF-7 | selector catch에서 billing 데이터 유실 | SF-5와 동일 방식으로 해결 |
| CS-7 | selector.ts `as any` 캐스트 (9곳) | `Object.values(graph.entities/hyperedges)` 타입 활용으로 제거 |
| CS-8 | `allExtracted: any[]` 파이프라인 전파 | `ChunkExtractedData` 인터페이스 + `EMPTY_CHUNK_DATA` 상수 도입 |

</details>

---

## ~~미해결 #1: App.tsx vs FileUpload.tsx "파일 추가" 로직 중복 (CS-1)~~ — 해결 완료

> ✅ `useAddFileAnalysis` 훅으로 해결 (`web/src/hooks/useAddFileAnalysis.ts`)

### 현상

동일한 "파일 추가 분석" 흐름이 두 컴포넌트에 각각 구현되어 있음.

| 항목 | App.tsx `handleAddFile` | FileUpload.tsx `executeAddFile` + `handleAddFile` |
|------|------------------------|--------------------------------------------------|
| **위치** | L117-162 (46줄) | `executeAddFile`: L371-399 (29줄), `handleAddFile`: L403-433 (31줄) |
| **진입점** | 헤더 "파일 추가" input onChange | ResumePanel의 "추가 분석" input onChange |
| **상태 관리** | 자체 state (`isAddingFile`, `addProgress`) | `runExtraction()` 래퍼 (`localLoading`, `progress`) |
| **파일 읽기** | 핸들러 내부 인라인 | `handleAddFile`에서 별도 단계 |
| **중복 파일명 체크** | 없음 | 있음 (대화상자 기반 이름 변경) |
| **에러 후 정리** | finally 블록 수동 정리 | `runExtraction()` 래퍼가 일괄 처리 |

### 공통 흐름 (양쪽 동일)

```
ensureSufficientBalance(subscription)
  → extractKnowledgeGraph({ existingGraph, onChunkBilling })
    → saveKnowledgeGraph(updated, ..., currentDataId)
      → setKnowledgeGraph(updated, ..., saved.id)
        → setShowUsageSummary(true) + loadSubscription()
```

### 차이점 상세

**App.tsx** — 선형 단일 함수:
- `isAddingFile` / `addProgress` 자체 로컬 state 관리
- `resetCurrentUsage()` 직접 호출
- finally 블록에서 `setIsAddingFile(false)` + input 초기화
- 중복 파일명 검사 없음 — 같은 이름 파일 그대로 분석

**FileUpload.tsx** — 2단계 레이어 구조:
- `handleAddFile`: 파일 읽기 → 중복 검사 → `executeAddFile` 호출
- `executeAddFile`: `runExtraction()` 래퍼 내에서 분석/저장/상태 갱신
- `runExtraction()`이 loading, error, billing, subscription 크로스커팅 관심사 일괄 처리
- 중복 파일명 시 `duplicateFileName` 대화상자 → 사용자가 새 이름 입력 → `handleConfirmNewFileName` → `executeAddFile` 재호출

### 스킵 사유

- 두 경로의 상태 관리 방식이 구조적으로 다름 (App: 자체 state, FileUpload: `runExtraction` 래퍼)
- 공유 훅 추출 시 양쪽의 loading/error 패턴을 모두 수용해야 하므로 인터페이스가 복잡해짐
- 중복 파일명 검사는 FileUpload에만 필요 (App.tsx 경로는 헤더 바로가기)
- billing 흐름 변경 시 동기화 부담이 있으나, 현재까지 실제로 문제가 된 적 없음
- 추상화 비용 > 중복 비용

### 해결 시 접근법 (참고용)

1. `useAddFileAnalysis(knowledgeGraph, currentDataId)` 커스텀 훅 추출
2. 훅이 `{ execute, isLoading, progress }` 반환
3. `execute(file, options?)` — options에 `skipDuplicateCheck` 플래그
4. 내부에서 `runExtraction` 패턴과 동일한 라이프사이클 관리
5. App.tsx는 `execute(file, { skipDuplicateCheck: true })`, FileUpload는 `execute(file)` 호출

---

## ~~미해결 #2: merger.ts 타입 안전성 (CS-7 잔여 + CS-11)~~ — 해결 완료

> ✅ `MergedExtraction` 내부 타입 도입 (`extraction/types.ts`), `AccumulatedGraph` 경량 반환으로 해결

### 현상

`merger.ts`에 **56곳**의 `any` 타입 사용이 있음. 파이프라인 내부 코드라 외부 타입 안전성에 직접 영향은 없으나, 컴파일 시점 타입 체크가 불가능.

### `any` 사용 현황 (카테고리별)

| 카테고리 | 건수 | 대표 예시 |
|----------|------|-----------|
| 파라미터 타입 | 12 | `mergeExtractions(extractions: ChunkExtractedData[]): any` 반환, `normalizeAllRelationTypes(extracted: any)` |
| 변수 타입 | 14 | `const entities: any[] = []`, `const chapters: Record<string, any> = {}` |
| 타입 단언 (`as any`) | 13 | `Object.values(entities) as any[]`, `entitiesByCategory as any` |
| 콜백 파라미터 | 12 | `.filter((e: any) => e.category)`, `.find((c: any) => c.id)` |
| 반환 타입 | 5 | `mergeExtractions(): any`, `inferMissingRelationships(): any` |
| **합계** | **56** | |

### 영향받는 함수 목록

| 함수 | any 건수 | 역할 |
|------|----------|------|
| `mergeExtractions` | 8 | 청크 결과 병합 (entities, relationships, scenes, chapters) |
| `normalizeAllRelationTypes` | 3 | 관계 타입 한국어 정규화 |
| `inferMissingRelationships` | 5 | 후처리: 설명 기반 누락 관계 생성 |
| `hasEdgeBetween` | 2 | 두 엔티티 간 관계 존재 확인 |
| `inferDescriptionBasedEdges` | 7 | description에서 엔티티 언급 → 자동 관계 |
| `inferCoOccurrenceEdges` | 4 | 같은 장면 동시 등장 → 자동 관계 |
| `buildSnapshots` | 10 | Scene → Snapshot 변환 |
| `buildKnowledgeGraph` | 12 | 최종 `NovelKnowledgeGraph` 구축 |
| `findSimilarEntity` | 1 | 이름 유사도 기반 엔티티 매칭 |
| 기타 (정상 `string` 타입) | 4 | 오탐 — 실제로는 올바른 타입 |

### CS-11: `buildAccumulatedGraph` 과도한 반환 타입 (selector.ts)

`buildAccumulatedGraph`는 `NovelKnowledgeGraph` 전체를 반환하지만, 호출부(`orchestrator.ts:130`)에서는 `.entities`만 사용.

**반환 객체 필드별 사용 현황**:

| 필드 | 호출부에서 사용? | 반환값 |
|------|-----------------|--------|
| `entities` | **사용** | 실제 데이터 |
| `hyperedges` | 미사용 | 실제 데이터 (관계 축적) |
| `metadata` | 미사용 | 더미 (`{ title: '', ... }`) |
| `chapters` | 미사용 | 빈 객체 / passthrough |
| `timeline` | 미사용 | 빈 배열 / passthrough |
| `snapshots` | 미사용 | 빈 객체 / passthrough |
| `stats` | 미사용 | 부분 더미 (`{} as any` 2곳) |

반환 필드 중 **70~80%가 미사용 더미 데이터**.

### 선행 작업: hyperedge 필드명 불일치 수정

merger.ts 타입을 정의하려면 먼저 필드명 불일치를 해결해야 함:

| 필드 | `ChunkExtractedData.relationships` | `NovelKnowledgeGraph.HyperEdge` |
|------|-----------------------------------|---------------------------------|
| 설명 | `description` | `statement` |
| 참여자 | `from` + `to` | `entities: string[]` |

`buildKnowledgeGraph`에서 `r.description` → `statement`, `[fromId, toId]` → `entities` 변환이 이루어지고 있어 타입이 혼재.

### 해결 시 접근법 (참고용)

**Phase A — 내부 타입 정의** (merger.ts 내부):

```typescript
/** merger 내부 병합 결과 (buildKnowledgeGraph 입력) */
interface MergedExtraction {
  entities: Array<{
    name: string; category?: string; description?: string;
    aliases?: string[]; scenes: number[]; attributes?: Record<string, unknown>;
    importance?: number;
  }>;
  relationships: Array<{
    from: string; to: string; type: string; description?: string;
    scenes: number[]; sentiment?: string; strength?: number;
    quote?: string; subtype?: string; bidirectional?: boolean;
    from_perspective?: string; to_perspective?: string;
  }>;
  scenes: Array<{
    id: number; chapter?: number; location?: string; summary?: string;
    events?: string[]; mood?: string; time?: string; time_marker?: string | null;
    chunkNum?: number;
  }>;
  chapters: Array<{
    id: number; title?: string; summary?: string;
  }>;
}
```

**Phase B — `buildKnowledgeGraph` 내부 타입**:

- `entities: Record<string, Entity>` — `Entity` 타입 직접 사용
- `hyperedges: Record<string, HyperEdge>` — `HyperEdge` 타입 직접 사용
- `as any[]` 캐스트 → 적절한 타입으로 교체

**Phase C — `buildAccumulatedGraph` 경량화** (selector.ts):

```typescript
interface AccumulatedGraph {
  entities: Record<string, Entity>;
  hyperedges: Record<string, HyperEdge>;
}
```

반환 타입을 `NovelKnowledgeGraph` → `AccumulatedGraph`로 변경. 호출부와 `buildEntitySummaries`, `filterEntitiesByNames` 등의 파라미터도 함께 변경.

### 작업량 추정

- `MergedExtraction` 타입 정의: 1개 파일 (merger.ts 또는 types.ts)
- `mergeExtractions` + `inferMissingRelationships` 타입 교체: ~20곳
- `buildKnowledgeGraph` + 내부 함수 타입 교체: ~25곳
- `buildAccumulatedGraph` 경량화: selector.ts + orchestrator.ts 2개 파일
- 총 56곳 `any` 중 4곳은 정상 (실제 수정 대상 ~52곳)

---

## 요약

| # | 이슈 | 상태 | 해결 방법 |
|---|------|------|----------|
| CS-1 | 파일 추가 로직 중복 | ✅ 해결 | `useAddFileAnalysis` 훅 추출 |
| CS-7/CS-11 | merger.ts 타입 안전성 | ✅ 해결 | `MergedExtraction` + `AccumulatedGraph` 타입 도입 |
| CHAT-1 | decideConnectedNodes billing 미수집 | ✅ 해결 | billing 수집 + 채팅 세션 hold/settle 전환 |
| **합계** | **0건 미해결** | | |
