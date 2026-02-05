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
export const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
```

- `true`: Catcident OAuth 인증 필수
- `false` 또는 미설정: 익명 모드

### Catcident OAuth Provider

```typescript
{
  id: 'catcident',
  type: 'oidc',
  issuer: process.env.AUTH_CATCIDENT_ISSUER,
  authorization: {
    params: { scope: 'openid profile email member' }
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

## balanceCache.ts — 서버 측 잔액 캐시

`/api/analyze`에서 사용하는 사용자별 잔액 캐시.

- 잔액 0 사용자의 OpenRouter 호출을 서버 측에서 차단
- 5분 TTL, 최대 100 엔트리
- Fail-open: billing 서비스 장애 시 분석 허용
- `AUTH_ENABLED=false`이면 항상 통과

```typescript
// /api/analyze에서 사용
const balanceError = await checkAnalyzeEligibility();
if (balanceError) return NextResponse.json({ error: balanceError }, { status: 402 });

// 차감 후 캐시 갱신
updateBalanceCache(userId, balance_after);

// 캐시 무효화 (필요 시)
invalidateBalanceCache(userId);
```

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

## modelCosts.ts — 모델 비용 공유 모듈

모델 비용 상수 및 크레딧 계산 유틸리티. 클라이언트(billing.ts)와 서버(/api/analyze) 양쪽에서 사용.

- 단일 진실 공급원: `AVAILABLE_MODELS` (types.ts) — 모델 비용 동기화 불일치 방지
- 동기화 대상: catcident-backend `StorygraphEstimator`

```typescript
// 상수
MARGIN, USD_TO_KRW, KRW_PER_CREDIT, CHARS_PER_TOKEN,
CHUNK_SIZE, CHUNK_OVERLAP, OUTPUT_RATIO,
DEFAULT_INPUT_COST, DEFAULT_OUTPUT_COST

// 공유 헬퍼 (수식 중복 제거)
tokenCostUsd(promptTokens, completionTokens, inputCost, outputCost) → number
costUsdToCredits(costUsd) → number

// 모델 비용 조회 (AVAILABLE_MODELS에서)
getModelCosts(model) → { inputCost, outputCost }
```

**⚠️ 상수 변경 시 주의사항**:
- `CHARS_PER_TOKEN=1.5`는 한국어(~1.0)와 영문 시스템 프롬프트의 혼합을 반영한 값. 순수 한국어 소설은 과소추정될 수 있으나 `MARGIN=3.0`이 보상.
- 상수를 변경하면 catcident-backend `StorygraphEstimator`도 동기 수정 필수.
- 새 모델 추가 시 `types.ts`의 `AVAILABLE_MODELS`에 `inputCost`/`outputCost` 추가 — 이것이 단일 진실 공급원.

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

---

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

### Feb 3, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #9998 | 9:38 PM | 🔵 | Comprehensive demo application exploration completed with detailed architectural findings | ~941 |
| #9993 | 9:37 PM | 🔵 | MongoDB connection with singleton pattern and default local development fallback | ~543 |
| #9978 | 9:34 PM | 🔵 | Authentication system integrates Catcident OAuth with conditional enablement via environment variable | ~598 |
| #9966 | 9:32 PM | 🔵 | NextAuth integration with Catcident OAuth provider and optional authentication mode | ~497 |
| #9961 | " | 🔵 | MongoDB connection module uses singleton pattern with environment-based configuration | ~425 |
| #9860 | 3:52 PM | 🟣 | MongoDB connection module for persistent knowledge graph storage | ~406 |
</claude-mem-context>
