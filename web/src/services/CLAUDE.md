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

### 모듈 의존성 규칙

공유 유틸리티는 `types.ts`에 배치하여 순환 방지. `fetchWithClientTimeout`은 `types.ts`에 위치.

```
orchestrator → extractor → types (✅ 단방향)
orchestrator → selector → types (✅ 단방향)
orchestrator → merger (✅ 단방향)
```

**규칙**: 새 공유 유틸리티는 반드시 `types.ts`에 배치. `extractor.ts`나 `selector.ts` 간 직접 import 금지.

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
  onChunkBilling?: (chunkIndex: number, billing: ChunkBilling) => void;
}

// 진행상황 관리
saveProgress(), loadProgress(), clearProgress()

// API 키 관리
setApiKey(), hasApiKey(), getApiKey()
```

### ⚠️ Billing 추적 필수 규칙

**청크별 실시간 차감 흐름**:

```
클라이언트                    Next.js 서버                catcident-backend
────────                    ──────────                ─────────────────
checkSufficientBalance()    GET /api/billing/credits/balance
                              ← balance > 0 확인

extractKnowledgeGraph({ onChunkBilling })
  → /api/analyze (청크 1)   ──→  OpenRouter 호출
                              ↓ 토큰 사용량 기반 크레딧 계산 (modelCosts.ts)
                              ──→  /credits/deduct/ (즉시 차감)
                              ← { billing, balance_after, insufficient_balance? }
  onChunkBilling(billing)   ← CreditBadge 실시간 갱신

  → /api/analyze (청크 2)   ──→  OpenRouter 호출
                              ↓ 잔액 부족 시 insufficient_balance: true 반환
                              ← 분석 중단, 부분 결과 반환
```

새로운 분석 경로를 추가할 때 체크리스트:
- [ ] `onChunkBilling` 콜백 전달 — 실시간 잔액 갱신 + UI 표시
- [ ] `checkSufficientBalance()` 분석 시작 전 호출
- [ ] `insufficient_balance` 응답 시 분석 중단 + 부분 결과 반환 처리
- [ ] `AUTH_ENABLED=false` 환경에서 billing 비활성 → 기존 동작 유지

### 파일 추가 분석

기존 지식그래프가 있을 때 파일을 추가하면:
1. 기존 entities에서 `knownEntities` 초기화 (LLM 선별 방식 사용)
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
getUsageHistory(page)       // 거래 내역 (페이지네이션)
getPlans()                  // 요금제 목록
getCreditPackages()         // 크레딧 상품 목록

// 로컬 순수 함수 (API 호출 없음)
estimateUsageLocally(charCount, model)  // 로컬 예상 비용 계산 (UsageEstimate용)
calculateCreditsFromTokens(prompt, completion, model)  // 단일 모델 토큰→크레딧
calculateCreditsFromChunks(chunks)      // 혼합 모델 청크별 크레딧 합산

// 잔액 확인 (discriminated union 반환)
checkSufficientBalance()  // → { sufficient: true } | { sufficient: false; error: string }

// Billing 콜백 생성
createBillingCallback(updateCreditBalance?)  // extractKnowledgeGraph에 전달할 onChunkBilling 콜백
```

### 로컬 추정 함수 동기화

`estimateUsageLocally()`와 `calculateCreditsFromTokens()`는 `lib/modelCosts.ts` 공유 모듈의 상수를 사용.
상수 변경 시 `lib/modelCosts.ts`만 수정하면 billing.ts와 서버 라우트 모두 반영됨.
모델 단가는 `AVAILABLE_MODELS` (types.ts)가 단일 진실 공급원.

### 중요 규칙

- **charCount vs bytes**: 분석 함수에 전달하는 charCount는 문자 수. `file.size`는 bytes이므로 반드시 변환 (`Math.ceil(bytes / 3)` for UTF-8 한글)
- **차감 금액**: 서버가 실제 OpenRouter 토큰 사용량 기반으로 계산 후 즉시 차감
- **부분 실패**: 분석 도중 잔액 소진 시 `insufficient_balance` 플래그로 중단 → 이미 완료된 청크까지 부분 결과 반환
- **잔액 확인**: 모든 분석 진입점에서 `checkSufficientBalance()` 호출 필수
- **실시간 갱신**: `onChunkBilling` 콜백의 `balance_after`로 CreditBadge 실시간 동기화

### ⚠️ extraction 파이프라인 → `/api/analyze` 요청 본문

`/api/analyze`는 `{ prompt, apiKey, model }` 만 수신. 서버가 OpenRouter 응답 후 토큰 사용량을 계산하여 즉시 크레딧을 차감하고, 응답에 `billing`, `balance_after`, `insufficient_balance` 필드를 포함하여 반환.

### ⚠️ ChunkBilling 타입 일관성

`ChunkBilling` 인터페이스는 반드시 `model` 필드를 포함해야 합니다.
이는 혼합 모델 크레딧 계산 (`calculateCreditsFromChunks`)의 정확성을 보장합니다.

```typescript
// types.ts — 정본
interface ChunkBilling {
  prompt_tokens: number;
  completion_tokens: number;
  model: string;  // ← 필수! 누락하면 크레딧 계산 불가
}

// ❌ model 없이 billing 반환
return { data, billing: { prompt_tokens: 100, completion_tokens: 50 } };

// ✅ model 포함 필수
return { data, billing: { prompt_tokens: 100, completion_tokens: 50, model } };
```

### ⚠️ checkSufficientBalance 사용 패턴

Discriminated union 반환이므로 type narrowing 필수:

```typescript
// ❌ destructuring → sufficient: true일 때 error 프로퍼티 없음
const { sufficient, error } = await checkSufficientBalance();

// ✅ type narrowing 패턴
const balanceCheck = await checkSufficientBalance();
if (!balanceCheck.sufficient) throw new Error(balanceCheck.error);
```

---

## billingProxy.ts - 서버 사이드 프록시

catcident-backend billing API로의 서버 사이드 프록시 유틸리티

### 구성

- `proxyToCatcident(path, accessToken, options?)` - 저수준 fetch 래퍼 (15초 타임아웃)
- `handleUpstreamResponse(response, logLabel)` - 업스트림 응답 처리 (에러 차단 + JSON 파싱)
- `billingGetHandler(path, logLabel)` - GET 라우트 핸들러 팩토리
- `billingPostHandler(path, logLabel)` - POST 라우트 핸들러 팩토리 (화이트리스트 + service 강제)

### 새 billing 라우트 추가 시

```typescript
// 1줄로 라우트 생성 가능
// api/billing/new-endpoint/route.ts
import { billingGetHandler } from '@/services/billingProxy';
export const GET = billingGetHandler('/new-endpoint/?service=storygraph', 'new-endpoint GET');
```

**POST 라우트 추가 시 반드시 `ALLOWED_POST_FIELDS`에 화이트리스트 등록:**

```typescript
// billingProxy.ts 내부
const ALLOWED_POST_FIELDS: Record<string, string[]> = {
  '/credits/deduct/': ['amount', 'description', 'metadata', 'idempotency_key'],
  '/new-endpoint/': ['field1', 'field2'],  // ← 새 라우트 추가
};
```

미등록 경로는 fail-open 설계로 `service`만 강제 주입하고 나머지는 통과합니다.
새 POST 라우트는 반드시 화이트리스트에 등록하여 의도한 필드만 전달되도록 해야 합니다.

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
