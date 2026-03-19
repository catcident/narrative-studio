# Demo Application

Next.js 기반 웹 애플리케이션 - 소설 인물 관계도 시각화

## 빠른 참조

```bash
# 개발/프로덕션 모두 Docker Compose 기반 (Caddy 리버스 프록시)
docker compose up --build -d        # 빌드 + 실행
docker compose logs -f storygraph   # 로그 확인
docker compose restart storygraph   # 재시작
docker compose down                 # 중지
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
클라이언트 → /api/billing/public-pricing, /api/billing/subscription, /api/billing/credits/*
서버 → billingBackend.ts / billingProxy.ts → catcident-backend
클라이언트 → /api/session/* → 세션 hold/settle/release
```

**현재 backend 정렬 계약**:
- 공개 pricing 카탈로그: `/api/v1/billing/public/pricing/?service=storygraph`
- 인증 구독 목록: `/api/v1/billing/subscriptions/`
- wallet 요약: `/api/v1/billing/credits/wallet/`
- 거래 내역: `/api/v1/billing/credits/transactions/?service=storygraph`
- hold/settle/release: `/api/v1/billing/credits/*`

**정규화 계층**:
- `lib/billingBackend.ts`가 backend raw 응답을 StoryGraph 전용 normalized shape로 변환
- `/api/billing/subscription`은 `subscriptions/` row를 선택하여 UI 구독 shape로 반환
- `storygraph` row가 아직 없으면 공개 pricing + wallet 요약으로 free fallback을 합성
- `/api/billing/credits/balance`는 동일 정규화 결과에서 `{ balance, plan }` 스냅샷을 반환
- `/api/billing/public-pricing`는 랜딩/구독 모달 공용 source

**과금 흐름 (세션 hold/settle/release)**:

1. `checkSufficientBalance()` → 잔액 > 0 확인
2. `holdCredits(estimatedAmount)` → `/api/session/hold` → 예상 크레딧 선점 (hold)
3. `extractKnowledgeGraph({ onChunkBilling })` → 청크별 분석 (토큰 사용량 누적만)
4. 성공 시: `settleCredits(sessionId, actualUsage)` → `/api/session/settle` → 실제 사용량 정산
5. 실패 시: `releaseCredits(sessionId)` → `/api/session/release` → hold 해제 (크레딧 복원)

**핵심 원칙**:
- **hold → 분석 → settle (성공) / release (실패)** 세션 패턴
- **`/api/analyze`는 과금 없이 순수 LLM 프록시** — 토큰 정보만 반환
- **`_billing` 응답에는 토큰 정보만 포함**: `{ model, prompt_tokens, completion_tokens, byok }`
- **settle 시에만 실제 크레딧 차감** + CreditBadge 잔액 갱신

> 상세 흐름도: [services/AGENTS.md](src/services/AGENTS.md#billing-추적-필수-규칙)
> 서버 모듈 상세: [lib/AGENTS.md](src/lib/AGENTS.md#modelcoststs--모델-비용-공유-모듈)

**서버 측 방어선**:
- 잔액 체크 (`balanceCache.ts`) + Rate Limiting (`rateLimit.ts`)
- 크레딧 계산: 연속 마크업 함수 (10x→5x 로그 보간) 적용 (`modelCosts.ts`)
- OpenRouter usage 누락 시 토큰 추정 폴백

**AUTH_ENABLED=false 배포** (Railway 등):
- billing API 프록시에 OAuth 토큰 없이 요청 → billing 기능 비활성화됨
- 공개 데모에서는 billing 없이 무료 사용 가능 (의도된 동작)
- 클라이언트 셀렉터 permissive fallback: `useByokEnabled`→true, `useExportFormats`→전체, `useCanBatchAnalysis`→true
- Hold/settle 스킵: `subscription === null`이면 hold/settle 전체 생략, extraction만 진행 (`holdToken`이 null로 유지)

**채팅 과금 흐름 (세션 hold/settle + 최대 4회 호출)**:

채팅 1건 = LLM 호출 최대 4회 (①의도분석, ②데이터선별, ③최종답변, ④연결노드판단). `/api/chat`은 토큰 정보만 반환 (과금 없음).

```
①②④ 비스트리밍 (DEFAULT_MODEL): _billing에 토큰 정보 반환
③   스트리밍 (사용자 모델): ReadableStream 인터셉트 → 종료 후 event: billing SSE 이벤트
```

- 서버: 각 호출의 `_billing`에 토큰 정보만 포함 (`model`, `prompt_tokens`, `completion_tokens`, `byok`)
- 클라이언트: `sendChatMessage()` → `chunkUsages: ChunkUsage[]` 수집
- **세션 패턴**: `holdCredits(estimatedCredits)` → `sendChatMessage()` → `finalizeHold(holdToken, chunkUsages)`
- 사전 체크: `ensureSufficientBalance(subscription, authEnabled, estimatedCredits)` → 예상 비용 > 잔액 시 전송 차단
- 인라인 표시: `ChatMessage.creditsUsed` — settle 응답 `actual_credits` 기반
- 대화 이력 제한: `MAX_HISTORY_CHARS = 45000` (~30K tokens)
- `fetchWithTimeout(120s)`: analyze와 동일한 타임아웃

**프록시 라우트 패턴** (`billingProxy.ts` 팩토리 사용):
```typescript
// 공개 pricing: custom route + proxyToCatcident (비인증)
const response = await proxyToCatcident('/public/pricing/?service=storygraph', undefined);

// 인증 POST 프록시: billingPostHandler(path, logLabel)
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
| `GET /api/billing/public-pricing` | 공개 pricing 카탈로그 (`public/pricing` 프록시) |
| `GET /api/billing/subscription` | StoryGraph 구독 정보 조회 (`subscriptions/` row → normalized) |
| `GET /api/billing/credits/balance` | 정규화된 구독/지갑 기준 크레딧 스냅샷 |
| `GET /api/billing/credits/transactions` | 거래 내역 (페이지네이션) |
| `POST /api/session/hold` | 분석 세션 크레딧 선점 (hold) |
| `POST /api/session/settle` | 분석 세션 정산 (실제 차감) |
| `POST /api/session/release` | 분석 세션 해제 (hold 복원) |

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

## Docker 배포 (테스트/프로덕션 동일 구조)

모든 환경이 Docker Compose + Caddy 리버스 프록시로 운영됨. 베어 `npm` 명령이나 `docker run` 직접 실행 없음.

### Compose 환경 변수
- `${VAR}` 치환은 `.env`만 읽음 (`.env.local` 미참조)
- 시크릿은 `env_file: .env.local`로 컨테이너에 직접 주입
- MongoDB는 `MONGO_INITDB_ROOT_USERNAME`/`MONGO_INITDB_ROOT_PASSWORD` 변수명 필수 (mongo:7 이미지 규격)

### Healthcheck
- Alpine 컨테이너에서 `localhost` → IPv6(`[::1]`) 해석 가능 → 반드시 `127.0.0.1` 사용
- 인증 미들웨어가 리다이렉트하는 경로 사용 금지 → 공개 API(`/api/config`) 사용
- `wget --spider`(HEAD) 대신 `-O /dev/null`(GET) 사용 (API 라우트는 GET만 지원)

### Zustand 셀렉터 참조 안정성
- 셀렉터 콜백 내 `?? []`/`?? {}` 사용 금지 → React #185 무한 루프
- 모듈 수준 상수 사용 (예: `const EMPTY: T[] = []`)
- 원시값(`null`, `false`, `0`)은 안전 (`Object.is` 비교 통과)

## 하위 문서

- [services/AGENTS.md](src/services/AGENTS.md) - AI 분석 + 스토리지 서비스
- [components/AGENTS.md](src/components/AGENTS.md) - UI 컴포넌트
- [lib/AGENTS.md](src/lib/AGENTS.md) - DB 연결 + 인증 헬퍼
