# Library Utilities

인프라 수준 유틸리티 모듈

## mongo.ts - MongoDB 연결

싱글톤 패턴으로 MongoDB 연결 관리

```typescript
// 사용법
import { connectMongo } from '@/lib/mongo';

const db = await connectMongo();
const collection = db.collection('knowledgeGraphs');
```

### 연결 설정

- **URL**: `MONGO_URL` 환경 변수 (기본값: `mongodb://localhost:27017`)
- **Database**: `character_relationship_chart`

### 컬렉션 구조

| 컬렉션 | 용도 |
|--------|------|
| `knowledgeGraphs` | 지식 그래프 데이터 |
| `knowledgeGraphVersions` | 버전 히스토리 |
| `novels` | 소설 원본 텍스트 |

---

## auth.ts - 인증 설정

NextAuth.js v5 설정 + 헬퍼 함수

### AUTH_ENABLED 플래그

```typescript
// 인증은 기본 활성 — AUTH_ENABLED=false로 명시적 비활성화만 가능 (보안 기본값)
export const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';
```

- 기본값(미설정/true/기타): Catcident OAuth 인증 필수
- `false`: 익명 모드 (Railway 퍼블릭 데모)

### Catcident OAuth Provider

```typescript
{
  id: 'catcident',
  type: 'oidc',
  issuer: process.env.AUTH_CATCIDENT_ISSUER,
  authorization: {
    params: { scope: 'openid profile email member billing' }
  },
  checks: ['pkce', 'state'],
}
```

**커스텀 JWT claims**:
- `member_type`: 회원 등급
- `roles`: 권한 배열

### 헬퍼 함수

```typescript
// API 라우트에서 userId 조회
const userId = await getAuthUserId();
// 인증 비활성화 시 'anonymous' 반환

// 인증 필수 API용
const result = await requireAuth();
if ('error' in result) return result.error;
const { userId } = result;
```

### Session 타입 확장

```typescript
// NextAuth Session에 추가된 필드
session.user.id         // 사용자 ID
session.user.nickname   // 닉네임
session.user.memberType // 회원 등급
session.user.roles      // 권한 배열
```

### ⚠️ 보안 규칙

- **Access Token은 클라이언트 세션에 노출 금지**: `accessToken`은 JWT 토큰 내부에서만 사용하고, `session` 콜백에서 클라이언트로 전달하지 않아야 함. XSS 공격 시 토큰 유출 위험.
- **API 에러 메시지 sanitization**: 서버 API 라우트에서 클라이언트로 내부 에러 메시지를 그대로 전달하지 않음. 항상 generic 에러 반환.

```typescript
// ❌ 내부 에러 노출
return NextResponse.json({ error: error.message }, { status: 500 });

// ✅ 제네릭 에러 반환
return NextResponse.json({ error: 'Request failed' }, { status: 500 });
```

### OAuth 토큰 갱신

JWT 콜백에서 access token 만료 60초 전 자동 갱신:

```typescript
// jwt callback 내부 흐름:
// 1. 초기 로그인 → accessToken, refreshToken, accessTokenExpires 저장
// 2. 만료 60초 전 → refreshAccessToken() 호출
// 3. 실패 시 → token.error = REFRESH_TOKEN_ERROR
```

**`refreshAccessToken()` 헬퍼**:
- `${OIDC_ISSUER}/token/` 엔드포인트에 `grant_type=refresh_token` POST
- `client_id` + `client_secret` + `refresh_token` 전달 필수
- 성공 시 `accessToken`, `refreshToken`, `accessTokenExpires` 갱신
- 실패 시 `REFRESH_TOKEN_ERROR` 마킹

**⚠️ 주의사항**:
- `OIDC_ISSUER` 상수 사용 필수 (issuer + `/oauth` 접두사 포함). 직접 URL 조합 금지.
- `client_secret` 누락 시 `token_endpoint_auth_method: 'client_secret_post'` 프로바이더에서 실패.
- `session.error`로 클라이언트에 갱신 실패 전달 (재로그인 유도용).

```typescript
// ❌ 직접 URL 조합 → 경로 불일치 위험
const tokenUrl = `${process.env.AUTH_CATCIDENT_ISSUER}/o/token/`;

// ✅ OIDC_ISSUER 상수 사용 (이미 /oauth 포함)
const tokenUrl = `${OIDC_ISSUER}/token/`;
```

### ⚠️ 프록시 보안 규칙

프록시 API 라우트 (`billingProxy.ts` 등)에 적용:

**1. 업스트림 에러 응답 sanitization**: 백엔드 4xx/5xx 응답 본문을 클라이언트에 그대로 전달하지 않음.

```typescript
// ❌ 백엔드 에러 본문 노출 (스택 트레이스, DB 에러 등 포함 가능)
return NextResponse.json(data, { status: response.status });

// ✅ 에러 시 제네릭 메시지 반환
if (!response.ok) {
  return NextResponse.json({ error: 'Billing service error' }, { status: response.status });
}
```

**2. POST 요청 본문 검증**: 클라이언트 body를 백엔드로 그대로 전달하지 않고, 허용 필드만 화이트리스트로 추출.

```typescript
// ❌ 클라이언트 body 무검증 전달 → service/user_id 조작 가능
const body = await request.text();
proxyToCatcident(path, token, { method: 'POST', body });

// ✅ 허용 필드만 추출 + service 서버 주입
const { amount, description, metadata, idempotency_key } = await request.json();
const body = JSON.stringify({ amount, description, metadata, idempotency_key, service: 'storygraph' });
```

**3. `service` 필드 서버 강제**: GET 라우트처럼 POST 라우트도 `service: 'storygraph'`를 서버에서 주입.

---

## fetchWithTimeout.ts — 서버 측 타임아웃 유틸리티

외부 API 호출 시 AbortController 기반 타임아웃. **기본값 없음** — 호출부에서 반드시 명시적으로 전달.

```typescript
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

// 사용법 — 타임아웃 명시 필수
const response = await fetchWithTimeout(url, options, 120000);
```

**사용처**: analyze, chat, validate-key, embeddings, chunk-embeddings 라우트.

**⚠️ 클라이언트용은 별도**: `extraction/types.ts`의 `fetchWithClientTimeout` (기본 150초). 혼동 주의.

---

## billingBackend.ts — StoryGraph billing 정규화 어댑터

catcident-backend의 현재 billing 계약을 StoryGraph 프론트 전용 shape로 정규화하는 서버 전용 헬퍼.

- `fetchStorygraphPublicPricing()` → `/api/v1/billing/public/pricing/?service=storygraph`
- `fetchStorygraphSubscription()` → read-only helper. `/api/v1/billing/subscriptions/`에서 row를 찾고, 없으면 synthetic fallback 반환
- `ensureStorygraphSubscription()` → `subscriptions/` read-first, miss 시 `POST /api/v1/billing/subscriptions/bootstrap/`, transient 실패 시에만 fallback 허용
- `ensureStorygraphBalanceSnapshot()` → canonical 구독 우선 기준 `{ balance, plan }` 스냅샷 생성
- `fetchStorygraphWalletSummary()` → `/api/v1/billing/credits/wallet/`

**free fallback 규칙**:
- `subscriptions/`에 `storygraph` row가 없으면 공개 pricing의 free 플랜 + wallet grants로 fallback 구독을 합성
- usable balance는 `platform` grant와 `serviceCode === "storygraph"` grant만 합산
- `purchased_credit_balance`는 wallet summary에 source 구분이 없으므로 fallback에서는 `0`
- fallback은 이제 transient 장애 대비용 보조 경로이며, canonical happy path는 bootstrap-first다

이 모듈은 다음 서버 소비 지점의 단일 진실 원천이다:
- `/api/billing/subscription`
- `/api/billing/credits/balance`
- `balanceCache.ts`
- `versionHistory.ts`

---

## embeddingUtils.ts — 임베딩 공유 유틸리티

`embeddings/route.ts`와 `chunk-embeddings/route.ts`가 공유하는 함수.

- `getEmbeddings(texts, apiKey)` — OpenRouter embedding API 호출 (모델: `openai/text-embedding-3-small`)
- `cosineSimilarity(a, b)` — 벡터 간 코사인 유사도

---

## balanceCache.ts — 서버 측 잔액 + BYOK 캐시

`/api/analyze`, `/api/chat`에서 사용하는 사용자별 잔액/BYOK 캐시.

- 잔액 0 사용자의 OpenRouter 호출을 서버 측에서 차단
- 5분 TTL, 최대 100 엔트리
- Fail-open: billing 서비스 장애 시 분석 허용
- `AUTH_ENABLED=false`이면 항상 통과
- 구독/잔액 조회는 `billingBackend.ts`의 `ensureStorygraphSubscription()`을 사용해 canonical row를 우선 조회
- **BYOK 캐시**: `CacheEntry.byok` 플래그로 개인 키 사용 권한 캐싱
- **BYOK 사용자 zero balance 보존**: `updateBalanceCache()`에서 byok=true면 zero balance여도 캐시 유지

```typescript
// /api/analyze에서 사용 (사전 해결된 auth 정보 전달 — requireAuth() 중복 호출 방지)
const balanceError = await checkAnalyzeEligibility(userId, accessToken);
if (balanceError) return NextResponse.json({ error: balanceError }, { status: 402 });

// BYOK 권한 확인 (fail-open: 캐시 미스 → 허용)
const isUsingPersonalKey = !!userApiKey && userApiKey !== ENV_API_KEY;
if (AUTH_ENABLED && isUsingPersonalKey && userId) {
  const byokAllowed = isCachedByokEnabled(userId);
  if (!byokAllowed) return 403;
}

// settle 정산 후 캐시 갱신
updateBalanceCache(userId, balance_after);
```

**⚠️ 주의**: `checkAnalyzeEligibility()`는 내부적으로 `requireAuth()`를 호출하지 않음.
동일 request 내 `requireAuth()` 중복 호출을 방지하기 위해, 호출자가 사전 해결한 `userId`와 `accessToken`을 전달해야 함.

**⚠️ free fallback 영향**: 신규 로그인 사용자는 기본적으로 bootstrap으로 canonical row를 먼저 확보한다.
다만 backend timeout/network/5xx 시에는 여전히 `storygraph` free 플랜 fallback이 보조 경로로 사용될 수 있다.

**⚠️ BYOK fail-open**: `isCachedByokEnabled()`는 캐시 미스 시 `true` 반환.
`checkAnalyzeEligibility()`가 먼저 실행되어 캐시를 갱신하므로, 캐시 미스는 billing 서비스 장애를 의미.
개인 키 사용 시 서버 비용 없으므로 fail-open이 안전.

---

## rateLimit.ts — 슬라이딩 윈도우 Rate Limiter

사용자별 API 호출 제한 (인메모리).

- 분당 60회 제한 (`AUTH_ENABLED=true`일 때만)
- 슬라이딩 윈도우 방식 (타임스탬프 배열)
- 최대 10,000 엔트리, 자동 정리

```typescript
const limited = checkRateLimit(userId);
if (limited) {
  return NextResponse.json(
    { error: '요청이 너무 많습니다.' },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) } },
  );
}
```

---

## modelCosts.ts — 공유 상수 모듈

클라이언트와 서버 양쪽에서 사용하는 토큰/청크 상수만 포함. USD 비용 계산은 `serverCosts.ts`로 이동됨.

```typescript
// 공유 상수
CHARS_PER_TOKEN, CHUNK_SIZE, CHUNK_OVERLAP, OUTPUT_RATIO,
SELECTOR_PROMPT_CHARS, SELECTOR_OUTPUT_TOKENS, SELECTOR_MODEL,
MERGER_REVIEW_PROMPT_CHARS, MERGER_REVIEW_OUTPUT_TOKENS, MERGER_REVIEW_MODEL,
SYSTEM_PROMPT_OVERHEAD_TOKENS, ESTIMATION_OUTPUT_RATIO, ESTIMATION_LOREBOOK_RATIO
```

**⚠️ 상수 변경 시 주의사항**:
- `CHARS_PER_TOKEN=1.5`는 한국어(~1.0)와 영문 시스템 프롬프트의 혼합을 반영한 값.
- `ESTIMATION_*` 상수는 사전 추정용 (settle 정산과는 별도). `OUTPUT_RATIO`는 settle 마크업 계산용.
- 새 모델 추가 시 `types.ts`의 `FALLBACK_MODELS`에 `creditsPerChunk`/`creditsPerChunkNoLore`/`creditsPerChat` 추가, `serverCosts.ts`의 `SERVER_MODEL_COSTS`에 USD 단가 추가.
- **새 per-chunk LLM 호출 추가 시**: `computeCreditsPerChunk()`에 비용 추가 + `FALLBACK_MODELS` 값 재계산 + `modelCosts.ts`에 상수 추가. 예: `ESTIMATION_LOREBOOK_RATIO` 추가 시 `computeCreditsPerChunk`에 lorebook 비용 반영.

---

## serverCosts.ts — 서버 전용 비용 계산 모듈

`import 'server-only'` — 클라이언트 번들에 포함 불가. USD 기반 정확한 크레딧 계산.

```typescript
// 서버 전용 타입
interface ServerModelInfo extends ModelInfo { inputCost: number; outputCost: number; }
interface TokenBilling { prompt_tokens: number; completion_tokens: number; }

// USD 비용 계산
getModelCosts(model, dynamicModels?) → { inputCost, outputCost }
tokenCostUsd(promptTokens, completionTokens, inputCost, outputCost) → number
calculateChunkCostUsd(model, dynamicModels?) → number
costUsdToCredits(costUsd, model, dynamicModels?) → number

// 세션 크레딧 계산 (settle 라우트에서 사용)
calculateMixedSessionCredits(chunks, dynamicModels?) → number
calculateSessionCredits(totalSessionCostUsd, chunkCostUsd) → number

// 모델별 크레딧 사전 계산 (modelCache에서 사용)
computeCreditsPerChunk(model, dynamicModels?) → number  // extractor + lorebook + selector + merger/3 + embedding
computeCreditsPerChat(model, dynamicModels?) → number

// API 라우트 공용
resolveTokenBilling(data, promptLength, logPrefix) → TokenBilling | null
```

**⚠️ `resolveTokenBilling` 호출 규칙**: `logPrefix`에 기본값 없음. 호출부에서 반드시 명시적으로 전달 (예: `'[analyze]'`, `'[chat]'`).

---

## useSessionErrorHandler.ts — 세션 에러 핸들링 훅

`session.error === 'RefreshTokenError'` 감지 시 재로그인 유도.

---

## useShowTokenDetails.ts - 토큰 상세 표시 훅

토큰 input/output 상세 정보의 UI 표시 여부를 결정하는 클라이언트 훅.

### 표시 규칙

| AUTH_ENABLED | 역할 | 토큰 상세 |
|--------------|------|-----------|
| `false` (Railway) | - | 항상 표시 |
| `true` | admin/developer | 표시 |
| `true` | 일반 사용자 | 숨김 |
| `true` | 미로그인 | 숨김 |

### 의존성

- `useAuthEnabled()` (store) — 서버에서 받아온 `authEnabled` 설정
- `useSession()` (next-auth) — 현재 세션의 사용자 역할

### 사용처

- `UsageEstimate.tsx` — 분석 전 예상 토큰 표시
- `UsageSummary.tsx` — 분석 후 사용 토큰 표시
