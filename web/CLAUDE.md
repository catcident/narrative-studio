# Demo Application

Next.js 기반 웹 애플리케이션 - 소설 인물 관계도 시각화

## 빠른 참조

```bash
# 개발 서버
npm run dev

# 프로덕션 빌드 및 실행
npm run build && npm run start

# Docker
docker build -t storygraph .
docker run -p 3000:3000 --env-file .env storygraph
```

## 앱 구조

```
web/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/
│   │   │   ├── analyze/        # AI 분석 프록시
│   │   │   ├── auth/           # NextAuth.js 핸들러
│   │   │   ├── billing/        # Billing 프록시
│   │   │   ├── config/         # 런타임 설정
│   │   │   ├── knowledge-graphs/ # 그래프 CRUD
│   │   │   └── novels/         # 소설 원본 CRUD
│   │   ├── login/              # 로그인 UI
│   │   └── page.tsx            # 메인 SPA 진입점
│   ├── components/             # React 컴포넌트
│   ├── services/               # 비즈니스 로직
│   ├── lib/                    # 인프라 유틸리티
│   ├── store.ts                # Zustand 상태 관리
│   └── types.ts                # 타입 정의
├── Dockerfile                  # Multi-stage 프로덕션 빌드
├── next.config.ts              # Next.js 설정
└── .env.example                # 환경 변수 템플릿
```

## 주요 패턴

### 아키텍처: 하이브리드 SPA

Next.js App Router를 사용하지만 메인 UI는 클라이언트 SPA:

- `page.tsx`: `'use client'` 지시어로 App.tsx 래핑
- **이유**: 복잡한 인터랙티브 그래프는 SSR 이점 없음
- API 라우트: 보안 필요한 백엔드 작업 (DB, LLM, Auth)

### 인증 (NextAuth.js 5)

```typescript
// 인증은 기본 활성 (보안 기본값) — 명시적 비활성화만 가능
AUTH_ENABLED !== 'false'  → true  (미설정/true/기타 → 인증 활성)
AUTH_ENABLED === 'false'  → false (Railway 퍼블릭 데모용)
```

**Catcident OAuth 연동**:
- OIDC 프로토콜 + PKCE
- 커스텀 스코프: `openid profile email member billing`
- JWT claims: `member_type`, `roles`, `accessToken` (서버 프록시용)

### 과금 시스템 (Billing)

catcident-backend의 billing API를 서버 사이드 프록시로 연동:

```
클라이언트 → /api/billing/* → billingProxy.ts → catcident-backend
```

**과금 흐름 (청크별 실시간 차감)**:

1. `checkSufficientBalance()` → 잔액 > 0 확인
2. `extractKnowledgeGraph({ onChunkBilling })` → 청크별 분석
3. `/api/analyze`가 OpenRouter 호출 후 즉시 크레딧 차감 (`proxyToCatcident('/credits/deduct/')`)
4. 클라이언트가 `balance_after`로 CreditBadge 실시간 갱신
5. 잔액 소진 시 `insufficient_balance` 플래그로 분석 중단 → 부분 결과 반환

**핵심 원칙**:
- **서버가 각 청크의 실제 토큰 사용량으로 즉시 차감** — 선차감/정산 없음
- **클라이언트는 `balance_after`로 잔액 실시간 동기화** — 별도 잔액 조회 불필요
- 잔액 부족 시 분석 즉시 중단 + 이미 완료된 청크까지 부분 결과 반환

> 상세 흐름도: [services/CLAUDE.md](src/services/CLAUDE.md#billing-추적-필수-규칙)
> 서버 모듈 상세: [lib/CLAUDE.md](src/lib/CLAUDE.md#modelcoststs--모델-비용-공유-모듈)

**서버 측 방어선**:
- 잔액 체크 (`balanceCache.ts`) + Rate Limiting (`rateLimit.ts`)
- 크레딧 차감 금액 서버 계산 (`modelCosts.ts`) — 실제 토큰 사용량 기반
- OpenRouter usage 누락 시 토큰 추정 폴백

**AUTH_ENABLED=false 배포** (Railway 등):
- billing API 프록시에 OAuth 토큰 없이 요청 → billing 기능 비활성화됨
- 공개 데모에서는 billing 없이 무료 사용 가능 (의도된 동작)

**채팅 과금 흐름 (스트리밍 + 3회 호출)**:

채팅 1건 = LLM 호출 3회 (①의도분석, ②데이터선별, ③최종답변). `/api/chat`에서 과금 처리.

```
①② 비스트리밍 (DEFAULT_MODEL): deductCreditsForResponse() → _billing 응답 필드
③  스트리밍 (사용자 모델): ReadableStream 인터셉트 → 종료 후 event: billing SSE 이벤트
```

- 서버: `deductForTokens()` 공용 헬퍼 (스트리밍/비스트리밍 공통 차감 로직)
- 클라이언트: `CallBilling[]` → `ChatMessageBilling` 합산 (totalCreditsDeducted, finalBalanceAfter)
- 사전 체크: `ensureSufficientBalance()` + `estimateChatCost()` → 잔액 부족 시 전송 차단
- 대화 이력 제한: `MAX_HISTORY_CHARS = 45000` (~30K tokens)
- `fetchWithTimeout(120s)`: analyze와 동일한 타임아웃

**프록시 라우트 패턴** (`billingProxy.ts` 팩토리 사용):
```typescript
// GET 프록시: billingGetHandler(path, logLabel)
export const GET = billingGetHandler('/plans/?service=storygraph', 'plans GET');

// POST 프록시: billingPostHandler(path, logLabel)
export const POST = billingPostHandler('/credits/deduct/', 'credits/deduct POST');
```

### 스토리지 (서버 전용)

서버 API를 통해 MongoDB에 저장. 서버 실패 시 에러 반환 또는 빈 결과.

**버전 관리**: 매 저장 시 이전 버전 자동 보관

### 상태 관리 (Zustand)

주요 상태:
- `knowledgeGraph`: 현재 분석 결과
- `selectedEntities`: 선택된 엔티티 ID 배열
- `viewMode`: 'full' | 'simplified' | 'focused'
- `activeTab`: 'graph' | 'timeline' | 'source'
- `selectedScene`: 현재 선택된 장면

## API 라우트 상세

| 라우트 | 설명 |
|--------|------|
| `POST /api/analyze` | OpenRouter로 LLM 요청 프록시. 환경 API 키 우선, 없으면 요청의 키 사용 |
| `POST /api/chat` | 소설 채팅 (스트리밍/비스트리밍). auth + billing + rate limit 통합 |
| `GET /api/knowledge-graphs` | 사용자별 그래프 목록 (인증 시 userId 필터) |
| `POST /api/knowledge-graphs` | 새 그래프 저장 또는 기존 업데이트 |
| `GET /api/knowledge-graphs/[id]` | 개별 그래프 조회 |
| `DELETE /api/knowledge-graphs/[id]` | 그래프 삭제 |
| `GET /api/knowledge-graphs/[id]/versions` | 버전 히스토리 |
| `POST /api/knowledge-graphs/[id]/restore/[version]` | 특정 버전 복원 |
| `GET /api/billing/subscription` | 구독 정보 조회 (catcident 프록시) |
| `GET /api/billing/credits/balance` | 크레딧 잔액 조회 |
| `POST /api/billing/credits/deduct` | 크레딧 차감 |
| `GET /api/billing/credits/transactions` | 거래 내역 (페이지네이션) |
| `GET /api/billing/plans` | 요금제 목록 |
| `GET /api/billing/packages` | 크레딧 상품 목록 |

## 환경 변수

```bash
# .env — 프로덕션 기본값 (Git 커밋)
AUTH_CATCIDENT_ISSUER=https://catcident.com
CATCIDENT_API_URL=https://catcident.com

# .env.local — 시크릿 + 로컬 오버라이드 (Git 무시)
OPENROUTER_API_KEY=sk-or-...      # AI 분석
MONGO_URL=mongodb://...           # 데이터 저장
AUTH_SECRET=...                   # openssl rand -base64 32
AUTH_CATCIDENT_ID=your_client_id
AUTH_CATCIDENT_SECRET=...
CATCIDENT_SERVICE_KEY=sk-svc-...  # 서비스 간 인증 키

# 로컬 오버라이드 (.env.local에서 프로덕션 값을 덮어씀)
AUTH_URL=https://storygraph.catcident.lan
AUTH_CATCIDENT_ISSUER=https://catcident.lan
CATCIDENT_API_URL=http://catcident-backend-api-1:8000

# 인증: 코드 기본값 = true (설정 없으면 활성)
# AUTH_ENABLED=false  ← Railway 퍼블릭 데모에서만 명시적 비활성화
```

## 하위 문서

- [services/CLAUDE.md](src/services/CLAUDE.md) - AI 분석 + 스토리지 서비스
- [components/CLAUDE.md](src/components/CLAUDE.md) - UI 컴포넌트
- [lib/CLAUDE.md](src/lib/CLAUDE.md) - DB 연결 + 인증 헬퍼