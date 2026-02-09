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
| `orchestrator.ts` | 메인 파이프라인 + 진행상황 저장/복원 + `syncPartialAnalysis` |
| `index.ts` | Public API re-export only (함수 구현 금지) |

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
- **인물 컨텍스트**: 이전 청크에서 발견된 인물 정보를 다음 청크에 전달 (최대 100명, 카테고리별 최대 30명)
- **장면 번호**: 청크별 로컬 → 글로벌 ID로 변환

### 지원 모델 (OpenRouter)

| 모델 | 특징 |
|------|------|
| `google/gemini-2.0-flash-001` | **기본값**. 빠르고 저렴 |
| `deepseek/deepseek-chat` | 가성비 최고 |
| `anthropic/claude-3.5-sonnet` | 최고 품질 |
| `openai/gpt-4o` | 고품질 |

> 전체 모델 목록은 `types.ts`의 `AVAILABLE_MODELS` 참조 (단일 진실 공급원)

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
saveProgress(), loadProgress(), clearProgress(), syncPartialAnalysis(setter)

// API 키 관리
setApiKey(), hasApiKey(), getApiKey()
```

### ⚠️ Billing 추적 필수 규칙

**세션 hold/settle/release 흐름**:

```
클라이언트                    Next.js 서버                catcident-backend
────────                    ──────────                ─────────────────
checkSufficientBalance()    GET /api/billing/credits/balance
                              ← balance > 0 확인

holdCredits(estimated)      POST /api/session/hold
                              ──→  예상 크레딧 선점
                              ← { sessionId, held_amount }

extractKnowledgeGraph({ onChunkBilling })
  → /api/analyze (청크 1)   ──→  OpenRouter 호출
                              ← { _billing: { model, prompt_tokens, completion_tokens } }
  onChunkBilling(billing)   ← 토큰 사용량 누적 (잔액 갱신 없음)

  → /api/analyze (청크 N)   ──→  OpenRouter 호출
                              ← { _billing: { model, prompt_tokens, completion_tokens } }

[성공] settleCredits(holdToken, actualUsage)
                            POST /api/session/settle
                              ──→  실제 사용량 정산 (hold 해제 + 차감)
                              ← { balance_after }
                              → CreditBadge 잔액 갱신

[실패] releaseCredits(holdToken)
                            POST /api/session/release
                              ──→  hold 해제 (크레딧 복원)
```

새로운 과금 서비스(분석, 채팅, 검증 등)를 추가할 때 체크리스트:
- [ ] `ensureSufficientBalance(subscription, authEnabled, estimatedCredits)` — 3번째 파라미터로 예상 비용 전달
- [ ] `holdCredits()` → 작업 → `finalizeHold()` 세션 패턴 준수
- [ ] `onChunkBilling` 콜백 전달 — 토큰 사용량 누적 (잔액 갱신 없음)
- [ ] `_billing` 응답에서 `model: string` + `byok` 필수 확인 — `ChunkBilling` 타입 준수
- [ ] `finalizeHold` 성공/실패 양쪽에서 호출 — `holdToken`과 `chunkUsages`는 try 블록 밖에서 선언 (catch에서 접근 필요)
- [ ] `/api/chat` 호출 시 `idempotency_key: crypto.randomUUID()` 포함
- [ ] 402 응답 명시 처리 — generic error에 흡수 금지
- [ ] `subscription === null` 가드 — hold/settle/release 호출 전 체크 → null이면 billing 전체 스킵
- [ ] `isUsingPersonalKey` BYOK 가드 — 개인 키 사용 시 billing 전체 스킵
- [ ] API 키 접근은 `getApiKey()` / `hasApiKey()` 유틸리티 사용 — `localStorage.getItem` 직접 접근 금지
- [ ] `AUTH_ENABLED=false` 환경에서 billing 비활성 → 기존 동작 유지
- [ ] `useStore.getState()` — 비동기 콜백 내부에서 stale closure 방지
- [ ] UI 크레딧 표시는 `calculateSessionCreditsFromChunks()` 사용 — `calculateCreditsFromChunks()`는 레거시
- [ ] billing finally 블록에 `loadSubscription()` 필수 — 모든 billing 진입점에서 구독 상태 갱신
- [ ] (extraction 전용) `saveCurrentProgress(i)` vs `(i+1)` — 미분석 청크는 `i`, 성공 청크는 `i+1`
- [ ] (extraction 전용) `syncPartialAnalysis(setPartialAnalysis)` — 완료/실패 후 반드시 호출 (success + error 양쪽)

### 파일 추가 분석

기존 지식그래프가 있을 때 파일을 추가하면:
1. 기존 entities에서 `knownEntities` 초기화 (LLM 선별 방식 사용)
2. 새 파일 텍스트만 청크로 분석 (기존 인물 정보 전달)
3. 엔티티, 관계, 장면, 챕터 번호를 기존 것에 이어서 부여
4. 결과를 하나의 지식그래프로 반환

---

## storage.ts - 스토리지 서비스

지식 그래프 데이터 영속화 관리 (서버 MongoDB 전용)

### 서버 실패 시 동작

| 함수 | 서버 실패 시 |
|------|------------|
| `getSavedKnowledgeGraphList` | `[]` 반환 |
| `loadKnowledgeGraph` | `null` 반환 |
| `saveKnowledgeGraph` | **throw** (데이터 유실 방지) |
| `updateKnowledgeGraph` | `false` 반환 |
| `deleteKnowledgeGraph` | `false` 반환 |
| `getVersionHistory` | `[]` 반환 |
| `restoreVersion` | `null` 반환 |
| `saveNovelText` | **throw** (데이터 유실 방지) |

### 주요 함수

```typescript
// 목록/CRUD
getSavedKnowledgeGraphList()
loadKnowledgeGraph(id)
saveKnowledgeGraph(knowledgeGraph, novelId?, existingId?)
deleteKnowledgeGraph(id)

// 버전 관리
getVersionHistory(dataId)
restoreVersion(dataId, version)

// 소설 원본 관리
saveNovelText(title, text, knowledgeGraphId?)
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
getSubscription()           // 구독 정보 (plan, balance, purchased_credit_balance, features)
getCreditBalance()          // 잔액만 조회
getUsageHistory(page)       // 거래 내역 (페이지네이션)
getPlans()                  // 요금제 목록
getCreditPackages()         // 크레딧 상품 목록

// 로컬 순수 함수 (API 호출 없음)
estimateUsageLocally(charCount, model)  // 로컬 예상 비용 계산 (extractor+selector+merger+embedding 포함)
calculateCreditsFromTokens(prompt, completion, model)  // 단일 모델 토큰→크레딧
calculateCreditsFromChunks(chunks)      // 레거시: 청크별 올림 합산 (과다 추정)
calculateSessionCreditsFromChunks(chunks)  // 세션 수준: 서버 settle 미러링 (1회 올림, 정확)
estimateValidationCost(fileCount, model?)  // 검증 비용 추정 (첫 파일 자동 통과)
estimateChatCost(messages, contextChars, model)  // 채팅 비용 추정 (4회 호출 포함)

// 잔액 확인
checkSufficientBalance()  // → { sufficient: true } | { sufficient: false; error: string }
ensureSufficientBalance(subscription, authEnabled?, estimatedCredits?)  // 잔액 확인 + 예상 비용 비교

// 세션 관리
holdCredits(estimatedAmount)            // 분석 전 크레딧 선점
settleCredits(sessionId, actualUsage)   // 분석 성공 시 정산
releaseCredits(sessionId)               // 분석 실패 시 hold 해제

// 정산 헬퍼
finalizeHold(holdToken, chunks, desc, updateBalance)  // settle/release 분기 + balance 갱신 → FinalizeHoldResult
chunkUsageToSettleChunks(chunks)  // ChunkUsage[] → settle API 형태 변환

// Billing 콜백 생성 (리턴 타입: ChunkBillingCallback)
createBillingCallback(addChunkUsage)  // extractKnowledgeGraph에 전달할 onChunkBilling 콜백 (토큰 사용량 누적만)
```

### 로컬 추정 함수 동기화

`estimateUsageLocally()`와 `calculateCreditsFromTokens()`는 `lib/modelCosts.ts` 공유 모듈의 상수를 사용.
상수 변경 시 `lib/modelCosts.ts`만 수정하면 billing.ts와 서버 라우트 모두 반영됨.
모델 단가는 `AVAILABLE_MODELS` (types.ts)가 단일 진실 공급원.

### 중요 규칙

- **charCount vs bytes**: 분석 함수에 전달하는 charCount는 문자 수. `file.size`는 bytes이므로 반드시 변환 (`Math.ceil(bytes / 3)` for UTF-8 한글)
- **세션 패턴**: hold → 분석 → settle (성공) / release (실패). `/api/analyze`는 과금 없이 토큰 정보만 반환
- **잔액 확인**: 모든 분석 진입점에서 `ensureSufficientBalance(subscription, authEnabled, estimatedCredits)` 호출 필수
- **예상 비용 전달**: `ensureSufficientBalance`의 3번째 파라미터 `estimatedCredits`로 예상 비용 > 잔액 시 사전 차단
- **토큰 누적**: `onChunkBilling` 콜백은 토큰 사용량 누적만 수행 — 잔액 갱신은 settle 시에만
- **settle 시 잔액 갱신**: `settleCredits()` 응답의 `balance_after`로 CreditBadge 갱신
- **크레딧 표시**: UI 표시용 크레딧은 `calculateSessionCreditsFromChunks()` 사용 (서버 settle 미러링). `calculateCreditsFromChunks()`는 레거시 (과다 추정)
- **`finalizeHold` 반환값**: `FinalizeHoldResult.actualCredits` — settle 시 실제 차감 크레딧, release 시 null

### ⚠️ extraction 파이프라인 → `/api/analyze` 요청 본문

`/api/analyze`는 `{ prompt, apiKey, model }` 만 수신. 서버가 OpenRouter 응답 후 토큰 사용량을 계산하여, 응답의 `_billing` 필드에 `{ model, prompt_tokens, completion_tokens, byok }` (토큰 정보만)를 포함하여 반환. 크레딧 차감은 별도 세션 settle 단계에서 수행.

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

## chat.ts - 소설 채팅 서비스

지식 그래프와 원본 텍스트를 기반으로 소설에 대해 대화하는 채팅 서비스.

### 호출 구조 (1 메시지 = 최대 4 LLM 호출)

```
①의도분석 (DEFAULT_MODEL, 비스트리밍) → 키워드 + 카테고리 추출
②데이터선별 (DEFAULT_MODEL, 비스트리밍) → 필요한 엔티티/청크 선택 (조건부)
③최종답변 (사용자 모델, 스트리밍) → 컨텍스트 기반 답변 생성
④연결노드판단 (DEFAULT_MODEL, 비스트리밍) → 관련 엔티티 판단 (조건부)
```

### Billing 통합 (세션 hold/settle 패턴)

- `/api/chat`은 토큰 정보만 반환 (과금 없음) — extraction과 동일 패턴
- `CallBilling`: 개별 호출의 billing 정보 (서버 `_billing` 필드, `model: string` 필수)
- `ChatResult`: `{ content, billing, chunkUsages }` — `sendChatMessage` 반환 타입
- `chunkUsages: ChunkUsage[]`: 4개 호출의 토큰 사용량 → settle에 전달
- `ChatView.tsx`에서 hold/settle 세션 패턴 적용 (`useAddFileAnalysis` 패턴 참조)
- `ChatMessage.creditsUsed`: settle 응답의 `actual_credits` → 메시지 인라인 표시
- SSE `event: billing` 파싱: `nextEventType` 상태 머신으로 처리

### 대화 이력 제한

`MAX_HISTORY_CHARS = 45000` (~30K tokens). 최신 메시지부터 역순으로 추가, 한도 초과 시 중단.

### SSE 라인 버퍼

TCP 세그먼트 경계에서 잘린 불완전한 행 처리:
```typescript
let lineBuffer = '';
// 매 reader.read() 시:
const rawText = lineBuffer + decoder.decode(value, { stream: true });
const splitLines = rawText.split('\n');
lineBuffer = splitLines.pop() || '';  // 마지막 불완전 행 보관
```

### 비용 사전 추정

```typescript
estimateChatCost(messages, contextChars, model, dynamicModels?) → number  // 크레딧 단위
```

①②④ Flash 고정 추정 + ③ 사용자 모델 기반 추정 → `calculateMixedSessionCredits`로 세션 수준 올림.
`ChatView.tsx`에서 `ensureSufficientBalance(subscription, authEnabled, estimatedCredits)`으로 전송 전 차단.

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
  '/session/hold/': ['estimated_credits', 'description', 'metadata'],
  '/session/settle/': ['session_id', 'actual_usage', 'metadata'],
  '/session/release/': ['session_id'],
  '/new-endpoint/': ['field1', 'field2'],  // ← 새 라우트 추가
};
```

미등록 경로는 fail-open 설계로 `service`만 강제 주입하고 나머지는 통과합니다.
새 POST 라우트는 반드시 화이트리스트에 등록하여 의도한 필드만 전달되도록 해야 합니다.

### 환경 변수

- `CATCIDENT_API_URL` - catcident-backend API URL (기본값: `https://catcident.com`)
- `CATCIDENT_SERVICE_KEY` - X-Service-Key 헤더로 전달되는 서비스 인증 키

---
