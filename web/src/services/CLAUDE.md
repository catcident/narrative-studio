# Services Layer

비즈니스 로직 서비스 모듈

## extraction/ - AI 분석 서비스 (8개 모듈)

소설 텍스트를 분석하여 지식 그래프를 추출하는 핵심 서비스.
단일 파일에서 8개 모듈로 분할됨:

| 모듈 | 역할 |
|------|------|
| `types.ts` | 타입 정의 + 공유 유틸리티 (`stripMarkdownCodeBlock`, `getApiKey`) |
| `prompts.ts` | LLM 프롬프트 템플릿 |
| `chunker.ts` | 텍스트 → 스마트 청크 분할 (챕터 경계 인식) |
| `selector.ts` | 엔티티 선별 (LLM 기반) + API 키 관리 |
| `extractor.ts` | 단일 청크 LLM 추출 + JSON 복구 |
| `merger.ts` | 결과 병합 + 관계 추론 + 지식 그래프 구조화 |
| `orchestrator.ts` | 메인 파이프라인 + 진행상황 저장/복원 |
| `index.ts` | Public API re-export |

### ⚠️ 모듈 의존성 규칙

`extractor.ts` ↔ `selector.ts` 간 순환 의존이 존재 (TODO: 해소 필요).
공유 유틸리티는 `types.ts`에 배치하여 순환 방지.

```
orchestrator → extractor → selector (✅ 단방향)
orchestrator → merger (✅ 단방향)
extractor ← → selector (⚠️ 순환 — fetchWithClientTimeout를 types.ts로 이동 필요)
```

### 분석 파이프라인

```
텍스트 입력
    ↓
청크 분할 (5,000자) [chunker.ts]
    ↓
엔티티 선별 (청크별 LLM) [selector.ts]
    ↓
순차 LLM 분석 (청크별) [extractor.ts]
    ↓ 이전 인물 컨텍스트 전달
결과 병합 [merger.ts]
    ↓
관계 추론 (후처리) [merger.ts]
    ↓
지식 그래프 구조화 [merger.ts]
```

### ⚠️ 관계 타입 규칙

관계 타입은 반드시 한국어 10종만 사용: `가족`, `연인`, `친구`, `적대`, `동료`, `소속`, `위치`, `소유`, `포함`, `관련`

```typescript
// ❌ 영문 관계 타입 (normalizeAllRelationTypes 이후에 생성하면 누락됨)
relationType = 'related';  // 'location', 'ownership' 도 동일

// ✅ 한국어 관계 타입 직접 사용
relationType = '관련';  // '위치', '소유'
```

### 청크 처리 전략

- **청크 크기**: 5,000자 (한국어 기준)
- **인물 컨텍스트**: 이전 청크에서 발견된 인물 정보를 다음 청크에 전달 (최대 50명, 프롬프트에는 30명 제한)
- **장면 번호**: 청크별 로컬 → 글로벌 ID로 변환

### 지원 모델 (OpenRouter)

| 모델 | 특징 |
|------|------|
| `deepseek/deepseek-chat` | 기본값. 가성비 최고 |
| `anthropic/claude-3.5-sonnet` | 최고 품질 |
| `openai/gpt-4o` | 고품질 |
| `google/gemini-2.0-flash-001` | 빠르고 저렴 |

### 프롬프트 엔지니어링 포인트

`USER_PROMPT` 상수에서 정의. 핵심 지시사항:

1. **장/화 인식 패턴**: "제N장", "N화", "Chapter N" 등 다양한 형식 지원
2. **엔티티 카테고리**: character, location, item, organization, event, concept
3. **관계 타입 제한**: 가족, 연인, 친구, 적대, 동료, 소속, 위치, 소유, 포함, 관련 (10가지만)
4. **중요도 평가**: 1-10 스케일 (10=주인공)
5. **동물 캐릭터**: 이름 없는 동물도 특징으로 구분하여 character로 추출

### 에러 복구

- **타임아웃/API 오류**: 해당 청크 스킵 후 계속 진행
- **JSON 파싱 실패**: `tryFixJson()`으로 복구 시도, 실패 시 빈 결과
- **중간 저장**: 매 청크 완료 시 localStorage에 진행상황 저장 (24시간 유효)

### 주요 함수

```typescript
// 메인 추출 함수 (ExtractionOptions 객체 파라미터)
extractKnowledgeGraph(options: ExtractionOptions): Promise<NovelKnowledgeGraph>

// ExtractionOptions 인터페이스
interface ExtractionOptions {
  text: string;
  title: string;
  onProgress?: (message: string, current?: number, total?: number) => void;
  resumeFrom?: ExtractionProgress;
  model?: string;
  fileName?: string;
  existingGraph?: NovelKnowledgeGraph;
  onChunkBilling?: (billing: ChunkBillingData) => void;
}

// 진행상황 관리
saveProgress(), loadProgress(), clearProgress(), hasProgress()

// API 키 관리
setApiKey(), hasApiKey(), getApiKey()
```

### ⚠️ Billing 추적 필수 규칙

**모든 LLM API 호출(`/api/analyze`)은 billing 추적 대상입니다.**
`extractKnowledgeGraph`의 `onChunkBilling` 콜백뿐 아니라, 내부에서 발생하는 모든 LLM 호출 (예: `selectRelevantEntities`의 엔티티 선별 호출)도 포함됩니다.

새로운 분석 경로를 추가할 때 체크리스트:
- [ ] `onChunkBilling` 콜백 전달
- [ ] 내부 LLM 호출 (`selectRelevantEntities` 등)의 billing 데이터도 수집
- [ ] 분석 완료 후 `deductCredits()` 호출
- [ ] 분석 전 잔액 확인 (`estimateCredits` + balance 비교) — **모든** 진입점에서
- [ ] `idempotencyKey`는 결정론적 값 사용 (타임스탬프/`Date.now()` 금지)

### ⚠️ Idempotency Key 규칙

```typescript
// ❌ Date.now() → 매 호출마다 다른 값 → 중복 차감 방지 실패
const key = `storygraph-${savedId}-${Date.now()}`;

// ✅ 결정론적 값 → 동일 작업이면 동일 키
const key = `storygraph-${savedId}-${chunks.length}`;
const key = `storygraph-partial-${titleHash}-${chunks.length}`;
```

### 파일 추가 분석

기존 지식그래프가 있을 때 파일을 추가하면:
1. 기존 entities에서 `knownCharacters` 초기화
2. 새 파일 텍스트만 청크로 분석 (기존 인물 정보 전달)
3. 엔티티, 관계, 장면, 챕터 번호를 기존 것에 이어서 부여
4. 결과를 하나의 지식그래프로 반환

---

## storage.ts - 스토리지 서비스

지식 그래프 데이터 영속화 관리

### Dual Layer 아키텍처

```typescript
// 저장/로드 흐름
try {
  return await serverAPI();  // MongoDB 우선
} catch {
  return await localIndexedDB();  // 폴백
}
```

### IndexedDB 스키마

**Database**: `character-relationship-db`

| Store | keyPath | 설명 |
|-------|---------|------|
| `knowledgeGraphs` | `id` | 메인 데이터 |
| `versions` | `[dataId, version]` | 버전 히스토리 |

### 버전 관리 로직

1. 저장 시 기존 데이터 존재 확인
2. 존재하면 `versions` 스토어에 이전 버전 보관
3. `version` 필드 증가 후 업데이트

### ID 구분

- **로컬**: `kg_` 접두사 (예: `kg_1706123456789_abc1234`)
- **서버**: MongoDB ObjectId (24자 hex)

### 주요 함수

```typescript
// 목록/CRUD
getSavedKnowledgeGraphList()
loadKnowledgeGraph(id)
saveKnowledgeGraph(knowledgeGraph, novelId?, userId?, existingId?)
deleteKnowledgeGraph(id)

// 버전 관리
getVersionHistory(dataId)
restoreVersion(dataId, version)

// 소설 원본 관리
saveNovelText(title, text, knowledgeGraphId?, userId?)
loadNovelText(id)
getNovelList()

// Import/Export
exportKnowledgeGraph(data)  // JSON 다운로드
importKnowledgeGraph(file)  // JSON 파일 로드
```

---

## billing.ts - 과금 클라이언트 서비스

서버 사이드 프록시 (`/api/billing/`)를 통해 catcident billing API에 접근하는 클라이언트 서비스

### 공통 패턴

내부 헬퍼 `billingFetch<T>()` / `billingFetchList<T>()`로 중복 제거:
- null 반환 (단건) 또는 빈 배열 반환 (목록)
- `[billing]` 접두사 로그
- 네트워크 에러 시 silent fail (UI에서 처리)

### 주요 함수

```typescript
// API 함수 (서버 프록시 경유)
getSubscription()           // 구독 정보 (plan, balance, features)
getCreditBalance()          // 잔액만 조회
estimateCredits(charCount, model)  // 분석 전 예상 비용 (API)
deductCredits(amount, desc, metadata?, idempotencyKey?)  // 차감
getUsageHistory(page)       // 거래 내역 (페이지네이션)
getPlans()                  // 요금제 목록
getCreditPackages()         // 크레딧 상품 목록

// 로컬 순수 함수 (API 호출 없음)
estimateUsageLocally(charCount, model)  // 로컬 예상 비용 계산 (UsageEstimate용)
calculateCreditsFromTokens(promptTokens, completionTokens, model)  // 실제 토큰→크레딧 역산 (UsageSummary용)
```

### 로컬 추정 함수 동기화

`estimateUsageLocally()`와 `calculateCreditsFromTokens()`는 catcident-backend의 `StorygraphEstimator`와 동일한 상수를 사용.
상수 변경 시 양쪽 모두 수정 필요:
- `CHARS_PER_TOKEN`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `OUTPUT_RATIO`, `MARGIN`, `USD_TO_KRW`, `KRW_PER_CREDIT`
- 모델 단가는 `AVAILABLE_MODELS` (types.ts)에서 조회

### 중요 규칙

- **charCount vs bytes**: `estimateCredits()`에 전달하는 charCount는 문자 수. `file.size`는 bytes이므로 반드시 변환 (`Math.ceil(bytes / 3)` for UTF-8 한글)
- **idempotency key**: `deductCredits()` 호출 시 반드시 고유 키 전달하여 중복 차감 방지. timestamp/UUID 포함 권장
- **차감 시점**: 분석 완료 + 저장 후 1회만 (`saved.id`를 idempotency key에 포함)
- **차감 금액**: 실제 토큰 사용량 기반으로 계산해야 함 (서버 추정치가 아닌 `calculateCreditsFromTokens` 사용)
- **부분 실패**: 분석 도중 실패해도 이미 소비한 API 호출 비용이 있으므로 부분 차감 처리 필요
- **에러 로깅**: `billingFetch` 실패 시 HTTP 상태 코드와 에러 본문을 로그에 포함하여 디버깅 용이하게

---

## billingProxy.ts - 서버 사이드 프록시

catcident-backend billing API로의 서버 사이드 프록시 유틸리티

### 구성

- `proxyToCatcident(path, accessToken, options?)` - 저수준 fetch 래퍼 (15초 타임아웃)
- `billingGetHandler(path, logLabel)` - GET 라우트 핸들러 팩토리
- `billingPostHandler(path, logLabel)` - POST 라우트 핸들러 팩토리

### 새 billing 라우트 추가 시

```typescript
// 1줄로 라우트 생성 가능
// api/billing/new-endpoint/route.ts
import { billingGetHandler } from '@/services/billingProxy';
export const GET = billingGetHandler('/new-endpoint/?service=storygraph', 'new-endpoint GET');
```

### 환경 변수

- `CATCIDENT_API_URL` - catcident-backend API URL (기본값: `https://catcident.com`)
- `CATCIDENT_SERVICE_KEY` - X-Service-Key 헤더로 전달되는 서비스 인증 키

---

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

### Feb 3, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #9998 | 9:38 PM | 🔵 | Comprehensive demo application exploration completed with detailed architectural findings | ~941 |
| #9994 | 9:37 PM | 🔵 | Storage service implements MongoDB-first with IndexedDB fallback providing offline capability | ~637 |
| #9982 | 9:35 PM | 🔵 | AI extraction service with comprehensive chapter/scene parsing and strict entity-relationship validation | ~625 |
| #9974 | 9:34 PM | 🔵 | Sophisticated storage service with MongoDB-first strategy and IndexedDB fallback | ~611 |
| #9968 | 9:33 PM | 🔵 | Analyzed comprehensive AI extraction service with chunk processing and relationship inference | ~769 |
| #9868 | 3:52 PM | 🟣 | Dual-layer storage with server API and IndexedDB fallback | ~614 |
| #9864 | " | 🔵 | Next.js API route integration replaces client-side LLM calls | ~581 |
</claude-mem-context>
