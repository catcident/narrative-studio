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
// AUTH_ENABLED 환경 변수로 제어
AUTH_ENABLED=true   # Catcident OAuth 필수
AUTH_ENABLED=false  # 익명 모드 (userId='anonymous')
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

**과금 흐름 (Hold/Settle)**:

1. `startAnalysisSession(estimatedCredits, model)` → 크레딧 선차감(hold) + `sessionId` 반환
2. `extractKnowledgeGraph({ ..., sessionId })` → `/api/analyze`에 sessionId 전달
3. `/api/analyze`: 서버 측에서 OpenRouter 응답 토큰을 세션에 누적 (클라이언트 조작 방지)
4. `settleAnalysisSession(sessionId, title, idempotencyKey)` → 서버가 실제 크레딧 계산 + 정산
5. 실패 시: `releaseAnalysisSession(sessionId)` → hold 전액 환불

**핵심 원칙**:
- **서버가 크레딧을 계산** — 클라이언트는 차감 금액을 결정하지 않음
- idempotency key로 중복 정산 방지 — `storygraph-{savedId}-settle` (결정론적 값, `Date.now()` 금지)
- hold 미정산 시 Celery 태스크(`expire_stale_holds`)가 자동 처리
- file.size(bytes)와 charCount(문자수) 구분 필수 (UTF-8 한글 ~3bytes/char)
- **모든** LLM API 호출의 서버 측 토큰 추적 필수 — `sessionId`를 통해 `/api/analyze` 서버에서 누적
- `onChunkBilling` 콜백은 UI 표시용으로 유지 (UsageSummary 모달)
- 혼합 모델 사용 시 크레딧은 청크별 개별 계산 후 합산

**서버 측 방어선**:
- `/api/analyze`에 잔액 체크 (`balanceCache.ts`) — 잔액 0 사용자 차단
- 사용자별 Rate Limiting (`rateLimit.ts`) — 분당 60회 제한
- 분석 세션 스토어 (`analysisSession.ts`) — 서버 측 토큰 누적

**AUTH_ENABLED=false 배포** (Railway 등):
- billing API 프록시에 OAuth 토큰 없이 요청 → billing 기능 비활성화됨
- 공개 데모에서는 billing 없이 무료 사용 가능 (의도된 동작)

**프록시 라우트 패턴** (`billingProxy.ts` 팩토리 사용):
```typescript
// GET 프록시: billingGetHandler(path, logLabel)
export const GET = billingGetHandler('/plans/?service=storygraph', 'plans GET');

// POST 프록시: billingPostHandler(path, logLabel)
export const POST = billingPostHandler('/credits/deduct/', 'credits/deduct POST');
```

### 스토리지 (Dual Layer)

```
요청 → MongoDB API
         ↓ 실패
      IndexedDB (폴백)
```

- 서버 저장 ID: MongoDB ObjectId
- 로컬 저장 ID: `kg_` 접두사

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
| `POST /api/analysis-session` | 분석 세션 시작 (크레딧 hold) |
| `POST /api/analysis-session/settle` | 분석 세션 정산 (서버 측 크레딧 계산) |
| `POST /api/analysis-session/release` | 분석 세션 취소 (hold 환불) |

## 환경 변수

```bash
# 필수
OPENROUTER_API_KEY=sk-or-...      # AI 분석
MONGO_URL=mongodb://...           # 데이터 저장

# 인증 (AUTH_ENABLED=true 시)
AUTH_ENABLED=true
AUTH_SECRET=...                   # openssl rand -base64 32
AUTH_URL=https://storygraph.catcident.com
AUTH_CATCIDENT_ISSUER=https://catcident.com
AUTH_CATCIDENT_ID=your_client_id
AUTH_CATCIDENT_SECRET=            # 공개 클라이언트는 빈 값

# 과금 연동
CATCIDENT_API_URL=https://catcident.com   # catcident-backend URL
CATCIDENT_SERVICE_KEY=sk-svc-...          # 서비스 간 인증 키
```

## 하위 문서

- [services/CLAUDE.md](src/services/CLAUDE.md) - AI 분석 + 스토리지 서비스
- [components/CLAUDE.md](src/components/CLAUDE.md) - UI 컴포넌트
- [lib/CLAUDE.md](src/lib/CLAUDE.md) - DB 연결 + 인증 헬퍼

---

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

### Feb 3, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #9999 | 9:39 PM | 🔵 | Complete project structure exploration reveals monorepo organization with deployment configurations | ~903 |
| #9991 | 9:36 PM | 🔵 | TypeScript strict mode enabled despite build error suppression in Next.js config | ~505 |
| #9981 | 9:35 PM | 🔵 | Docker Compose defines production deployment with MongoDB, health checks, and Caddy integration | ~623 |
| #9971 | 9:33 PM | 🔵 | Next.js configuration uses standalone output with build validation disabled | ~415 |
| #9969 | " | 🔵 | Complete environment configuration for dual deployment modes with MongoDB and optional OAuth | ~508 |
| #9962 | 9:32 PM | 🔵 | Multi-stage Dockerfile implements production-optimized Next.js standalone build | ~484 |
| #9952 | 9:24 PM | 🔵 | Identified Character-Relationship-Chart tech stack from demo package.json | ~381 |
| #9903 | 4:01 PM | 🔵 | Next.js configuration disables TypeScript and ESLint build validation | ~352 |
| #9893 | 3:59 PM | 🔵 | Docker ignore configuration for Next.js demo build | ~320 |
| #9890 | " | 🔵 | Next.js configuration missing standalone output setting for Docker deployment | ~411 |
| #9882 | 3:52 PM | ✅ | TypeScript configuration adapted for Next.js with bundler resolution | ~505 |
| #9876 | " | ✅ | Next.js 15 with MongoDB driver replaces Vite build system | ~482 |
| #9873 | " | 🔵 | Docker build optimization excludes Next.js cache and development artifacts | ~415 |
| #9867 | " | 🔵 | Environment configuration now requires MongoDB and OpenRouter API credentials | ~458 |
| #9857 | 3:51 PM | 🔵 | Next.js configuration bypasses TypeScript and ESLint validation during builds | ~379 |
| #9854 | 3:49 PM | 🔵 | Demo app migrated from Vite to Next.js framework | ~524 |
| #9852 | " | 🔵 | Demo app requires OpenRouter API key and MongoDB connection for backend storage | ~404 |
| #9610 | 10:07 AM | 🔵 | React 19 demo with ReactFlow graph visualization and Zustand state management | ~395 |
</claude-mem-context>
