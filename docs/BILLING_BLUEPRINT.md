# 서비스별 구독 + 크레딧 시스템 청사진

StoryGraph 수익화를 위한 과금 시스템 설계 문서.
catcident-backend(플랫폼)과 narrative-studio(서비스)에 걸친 전체 구현 청사진.

## 설계 원칙

- **플랫폼 등급과 서비스 구독은 분리**: `MemberGrade`(플랫폼)는 건드리지 않음
- **서비스별 독립 구독**: 각 서비스가 자체 요금제/크레딧/기능을 가짐
- **크레딧 기반 과금**: 실제 API 사용량에 비례하는 크레딧 차감
- **BYOK 지원**: 유료 사용자는 개인 API 키로 크레딧 소모 없이 사용 가능

---

## 시스템 전체 구조도

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        catcident-backend (Django)                       │
│                                                                         │
│  기존 ──────────────────────   신규 ─────────────────────────────────── │
│  ┌──────────────┐              ┌──────────────────────────────────────┐ │
│  │ users/       │              │ billing/ (신규 앱)                    │ │
│  │  accounts/   │              │                                      │ │
│  │  members/    │──grade 유지──│  Service         서비스 등록          │ │
│  │  partners/   │              │  ServicePlan     서비스별 요금제      │ │
│  │  oauth/ ─────│──claims 확장─│  ServiceSubscription  사용자 구독    │ │
│  │              │              │  CreditLedger    크레딧 원장          │ │
│  └──────────────┘              │  CreditPackage   크레딧 상품          │ │
│                                │                                      │ │
│                                │  API: /api/v1/billing/               │ │
│                                │  Tasks: 월간 리셋, 만료 체크          │ │
│                                └──────────────────────────────────────┘ │
│                                                                         │
│  OAuth Endpoints                 Billing API Endpoints                  │
│  /oauth/token/                   /api/v1/billing/subscription/          │
│  /oauth/userinfo/                /api/v1/billing/credits/               │
│  /.well-known/openid-config      /api/v1/billing/usage/                 │
└────────────┬──────────────────────────────┬─────────────────────────────┘
             │ OAuth (OIDC)                 │ REST API (Bearer Token)
             │                              │
┌────────────┴──────────────────────────────┴─────────────────────────────┐
│                     narrative-studio (Next.js)                           │
│                                                                         │
│  수정 ──────────────────────   신규 ─────────────────────────────────── │
│  ┌──────────────────────┐      ┌──────────────────────────────────────┐ │
│  │ /api/analyze          │      │ /api/billing/         catcident 프록시│ │
│  │  + usage 캡처         │      │   subscription/       구독 조회      │ │
│  │  + 크레딧 차감 호출   │      │   credits/balance     잔액 조회      │ │
│  │  + BYOK 분기          │      │   credits/estimate    예상 비용      │ │
│  │                       │      │   credits/deduct      차감 (내부)    │ │
│  │ store.ts              │      │   usage/              사용 내역      │ │
│  │  + billingSlice       │      │                                      │ │
│  │                       │      │ components/                          │ │
│  │ App.tsx               │      │   CreditBadge.tsx     헤더 잔액      │ │
│  │  + CreditBadge 배치   │      │   UsageEstimate.tsx   분석전 예상    │ │
│  │                       │      │   UsageSummary.tsx    분석후 결과     │ │
│  │ FileUpload.tsx        │      │   SubscriptionPage.tsx 구독 관리     │ │
│  │  + 잔액 확인/차감     │      │   UsageHistory.tsx   사용 내역       │ │
│  │  + 예상 비용 표시     │      │                                      │ │
│  │                       │      │ services/                            │ │
│  │ UserMenu.tsx          │      │   billing.ts          billing API    │ │
│  │  + 구독 정보 표시     │      │                                      │ │
│  └──────────────────────┘      └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. catcident-backend: billing 앱

### 1-1. 모델

```python
# apps/billing/models.py

class Service(BaseModel):
    """catcident 산하 서비스 등록"""
    code         = CharField(max_length=50, unique=True)     # 'storygraph'
    name         = CharField(max_length=100)                  # 'StoryGraph - 인물 관계도'
    base_url     = URLField(blank=True)                       # 'https://storygraph.catcident.com'
    api_key_hash = CharField(max_length=128, blank=True)      # 서비스 간 인증용
    is_active    = BooleanField(default=True)


class ServicePlan(BaseModel):
    """서비스별 요금제 정의"""
    service         = FK(Service, related_name='plans')
    code            = CharField(max_length=50)            # 'free', 'basic', 'pro'
    name            = CharField(max_length=100)            # 'Pro 플랜'
    sort_order      = IntegerField(default=0)
    monthly_credits = IntegerField(default=0)              # 월 무료 크레딧
    price_krw       = IntegerField(default=0)              # 월 구독료 (0=무료)
    features        = JSONField(default=dict)              # 기능 플래그 (아래 참조)
    is_active       = BooleanField(default=True)

    class Meta:
        unique_together = ['service', 'code']
        ordering = ['service', 'sort_order']


class ServiceSubscription(BaseTransactionDataModel):
    """사용자의 서비스별 구독"""
    user            = FK(AUTH_USER_MODEL, related_name='service_subscriptions')
    service         = FK(Service, related_name='subscriptions')
    plan            = FK(ServicePlan, on_delete=PROTECT)
    status          = CharField(max_length=20)    # 'active', 'cancelled', 'expired', 'past_due'
    credit_balance  = IntegerField(default=0)     # 현재 크레딧 잔액
    credit_reset_at = DateTimeField(null=True)    # 다음 월간 리셋일
    started_at      = DateTimeField(auto_now_add=True)
    expires_at      = DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ['user', 'service']     # 서비스당 구독 1개


class CreditLedger(BaseModel):
    """크레딧 거래 원장 (불변 append-only)"""
    subscription    = FK(ServiceSubscription, related_name='ledger')
    amount          = IntegerField()              # +충전 / -차감
    balance_after   = IntegerField()              # 거래 후 잔액
    tx_type         = CharField(max_length=30)    # 아래 참조
    description     = CharField(max_length=200)
    metadata        = JSONField(default=dict)     # 서비스별 상세
    idempotency_key = CharField(max_length=100, unique=True, null=True)  # 중복 차감 방지

    class Meta:
        ordering = ['-created_at']
        indexes = [Index(fields=['subscription', '-created_at'])]


class CreditPackage(BaseModel):
    """크레딧 충전 상품"""
    service     = FK(Service, related_name='credit_packages')
    name        = CharField(max_length=100)
    credits     = IntegerField()
    price_krw   = IntegerField()
    bonus_pct   = IntegerField(default=0)         # 보너스 %
    is_active   = BooleanField(default=True)
    sort_order  = IntegerField(default=0)
```

#### features JSON 스키마 (storygraph)

```json
{
  "byok": false,
  "models": ["google/gemini-2.0-flash-001", "deepseek/deepseek-chat"],
  "max_file_size_mb": 5,
  "can_purchase_credits": false
}
```

- `models`가 문자열 `"all"`이면 전체 모델 사용 가능
- `models`가 배열이면 해당 모델만 사용 가능

#### tx_type 종류

| tx_type | 설명 |
|---------|------|
| `monthly_grant` | 월간 리셋 충전 |
| `purchase` | 크레딧 구매 |
| `usage` | 서비스 사용 차감 |
| `refund` | 환불 |
| `admin_adjust` | 관리자 조정 |
| `expiry` | 미사용 크레딧 만료 |

#### CreditLedger metadata 예시 (storygraph usage)

```json
{
  "model": "google/gemini-2.0-flash-001",
  "prompt_tokens": 12500,
  "completion_tokens": 3200,
  "api_cost_usd": 0.0035,
  "chunks_processed": 10,
  "file_name": "춘향전.txt",
  "analysis_id": "507f1f77bcf86cd799439011"
}
```

### 1-2. 서비스 레이어

```python
# apps/billing/services/credit_service.py

class CreditService:
    """크레딧 조회/차감/충전 — 모든 잔액 변경은 여기를 통해"""

    @staticmethod
    def get_or_create_subscription(user, service_code) -> ServiceSubscription:
        """구독 조회. 없으면 free 플랜으로 자동 생성"""

    @staticmethod
    def check_balance(subscription, required_credits) -> bool:
        """잔액 충분 여부"""

    @staticmethod
    @transaction.atomic  # select_for_update로 동시성 제어
    def deduct(subscription, amount, description, metadata, idempotency_key) -> CreditLedger:
        """크레딧 차감 (잔액 부족 시 InsufficientCreditsError)"""

    @staticmethod
    @transaction.atomic
    def grant(subscription, amount, tx_type, description) -> CreditLedger:
        """크레딧 충전 (월간/구매/관리자)"""

    @staticmethod
    def estimate_cost(service_code, params: dict) -> dict:
        """예상 크레딧 계산. 서비스별로 다른 로직 적용"""


# apps/billing/services/subscription_service.py

class SubscriptionService:
    """구독 생성/변경/해지"""

    @staticmethod
    def get_subscription_info(user, service_code) -> dict:
        """구독 + 플랜 + 잔액 + features 종합 정보"""

    @staticmethod
    def change_plan(user, service_code, new_plan_code):
        """플랜 변경 (업/다운그레이드)"""

    @staticmethod
    def monthly_reset():
        """월간 크레딧 리셋 (Celery beat task에서 호출)"""
```

### 1-3. API 엔드포인트

```
/api/v1/billing/
├── subscription/                         # 구독 관리
│   ├── GET  ?service=storygraph         # 내 구독 정보 조회
│   └── POST                             # 플랜 변경/구독 시작
│
├── credits/
│   ├── GET  balance/?service=storygraph  # 잔액 조회
│   ├── POST estimate/                    # 예상 크레딧 (char_count, model)
│   ├── POST deduct/                      # 크레딧 차감 (서비스 내부 호출)
│   └── GET  transactions/?service=storygraph  # 거래 내역
│
├── packages/
│   └── GET  ?service=storygraph          # 구매 가능 크레딧 상품 목록
│
└── plans/
    └── GET  ?service=storygraph          # 요금제 목록 (공개)
```

인증: 모든 엔드포인트는 OAuth2 Bearer Token 필수.
`deduct/`는 추가로 `X-Service-Key` 헤더 검증 필수 (서비스 간 인증).

### 1-4. 서비스 간 인증

```
narrative-studio 서버 → catcident API 호출 시:
  1. Authorization: Bearer {사용자 access_token}   (사용자 식별)
  2. X-Service-Key: {서비스 API 키}                (서비스 식별 + 권한)

catcident 측:
  - Service.api_key_hash로 X-Service-Key 검증
  - deduct/ 같은 민감 엔드포인트는 X-Service-Key 필수
```

### 1-5. OAuth Claims 확장

```python
# apps/users/oauth/validators.py 수정

class CustomOAuth2Validator(OAuth2Validator):
    oidc_claim_scope = {
        ...기존,
        "billing": ["subscriptions"],     # 신규 scope 추가
    }

    def _build_all_claims(self, user, include_roles=True):
        claims = ...기존...
        claims["subscriptions"] = self._get_subscriptions(user)
        return claims

    def _get_subscriptions(self, user):
        """사용자의 활성 구독 목록 (경량)"""
        # 결과 예시:
        # {
        #   "storygraph": {
        #     "plan": "free",
        #     "credit_balance": 87,
        #     "features": {"byok": false, "models": ["default"]}
        #   }
        # }
```

narrative-studio auth.ts에서 scope에 `billing` 추가:
```
scope: 'openid profile email member billing'
```

### 1-6. Celery Tasks

```python
# apps/billing/tasks.py

@shared_task  # celery beat: 매월 1일 00:00
def monthly_credit_reset():
    """활성 구독의 크레딧 리셋. 잔액을 plan.monthly_credits로 재설정"""

@shared_task  # celery beat: 매일 00:00
def check_subscription_expiry():
    """만료된 구독을 expired로 전환"""

@shared_task  # celery beat: 매일
def usage_daily_report():
    """서비스별 일간 사용량 집계 (관리자 보고용)"""
```

### 1-7. Admin

```python
# apps/billing/admin.py
ServiceAdmin               # 서비스 등록/관리
ServicePlanAdmin            # 요금제 CRUD (features JSON 에디터)
ServiceSubscriptionAdmin    # 사용자 구독 조회/조정
CreditLedgerAdmin           # 거래 원장 조회 (읽기 전용)
CreditPackageAdmin          # 충전 상품 관리

# 주요 admin action:
# - 크레딧 수동 조정 (admin_adjust)
# - 구독 상태 변경
# - 대량 크레딧 지급 (프로모션)
```

---

## 2. narrative-studio: 백엔드 (API Routes)

### 2-1. `/api/analyze` 수정

```
현재 흐름:
  request → OpenRouter 호출 → response 반환

변경 후:
  request
    → 1. 인증 확인 (userId + accessToken)
    → 2. BYOK 여부 분기
         ├── BYOK=true: 사용자 키로 OpenRouter 호출, 크레딧 차감 없음
         └── BYOK=false: 서버 키로 OpenRouter 호출
    → 3. OpenRouter 응답에서 usage 추출 {prompt_tokens, completion_tokens}
    → 4. 크레딧 비용 계산
    → 5. catcident에 차감 요청 (POST /billing/credits/deduct/)
    → 6. response + usage 정보 반환
```

응답에 `_billing` 필드 추가:
```json
{
  "choices": [...],
  "usage": {...},
  "_billing": {
    "prompt_tokens": 12500,
    "completion_tokens": 3200,
    "credits_used": 8,
    "balance_after": 79
  }
}
```

차감 시점: 전체 분석 완료 후 한 번에 차감 (청크별 차감 X).
- 중간 실패 시 부분 차감 환불이 복잡해지므로
- 전체 완료 후 정확한 실사용량으로 1회 차감이 단순하고 정확

### 2-2. `/api/billing/` 프록시 라우트 (신규)

```
web/src/app/api/billing/
├── subscription/
│   └── route.ts          # GET → catcident /billing/subscription/?service=storygraph
├── credits/
│   ├── balance/
│   │   └── route.ts      # GET → catcident /billing/credits/balance/
│   ├── estimate/
│   │   └── route.ts      # POST → catcident /billing/credits/estimate/
│   └── transactions/
│       └── route.ts      # GET → catcident /billing/credits/transactions/
├── packages/
│   └── route.ts          # GET → catcident /billing/packages/
└── plans/
    └── route.ts          # GET → catcident /billing/plans/
```

프론트엔드는 catcident를 직접 호출하지 않고, Next.js API 라우트를 통해 프록시.

```typescript
// 프록시 패턴 (공통)
async function proxyToCatcident(path: string, req: NextRequest) {
  const session = await auth();
  const accessToken = /* session에서 추출 */;

  return fetch(`${CATCIDENT_API_URL}${path}`, {
    method: req.method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Service-Key': process.env.CATCIDENT_SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: req.method !== 'GET' ? await req.text() : undefined,
  });
}
```

### 2-3. `requireAuth()` 확장

```typescript
// web/src/lib/auth.ts — 수정

// 기존: { userId: string }
// 변경: { userId: string, accessToken: string }
// accessToken: catcident billing API 호출에 필요
// NextAuth JWT callback에서 account.access_token을 저장하고 refresh token으로 갱신
```

---

## 3. narrative-studio: Zustand Store

```typescript
// web/src/store.ts — billing 상태 추가

interface BillingState {
  // 구독 정보 (로그인 시 로드)
  subscription: {
    plan: 'free' | 'basic' | 'pro';
    creditBalance: number;
    features: {
      byok: boolean;
      models: string[] | 'all';
      maxFileSizeMb: number;
      canPurchaseCredits: boolean;
    };
  } | null;

  // 현재 분석 세션의 누적 사용량
  currentUsage: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCreditsUsed: number;
    perChunk: Array<{
      chunkIndex: number;
      promptTokens: number;
      completionTokens: number;
      creditsUsed: number;
      model: string;
    }>;
  };

  // 액션
  loadSubscription: () => Promise<void>;
  updateCreditBalance: (newBalance: number) => void;
  addChunkUsage: (chunk: ChunkUsage) => void;
  resetCurrentUsage: () => void;
}
```

---

## 4. narrative-studio: UI 컴포넌트

### 4-1. 배치도 — 업로드 화면

```
┌─ 업로드 화면 (knowledgeGraph === null) ─────────────────────────────┐
│                                                                       │
│  ┌─ 우상단 ──────────────────────────────────────────────────────┐   │
│  │  [CreditBadge]  [UserMenu]                                    │   │
│  │   C 87 크레딧    닉네임  로그아웃                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─ 메인 영역 ──────────────────────────────────────────────────┐   │
│  │  ┌ FileUpload.tsx (기존) ──────────────────────────────────┐  │   │
│  │  │  드래그앤드롭 업로드                                     │  │   │
│  │  │  모델 선택 (plan.features.models 기반 필터링)            │  │   │
│  │  │                                                          │  │   │
│  │  │  ┌ UsageEstimate (신규) ─────────────────────────────┐  │  │   │
│  │  │  │  예상 사용량                                       │  │  │   │
│  │  │  │  파일: 춘향전.txt (52,340자)                       │  │  │   │
│  │  │  │  예상 토큰: ~35,000 input / ~16,000 output        │  │  │   │
│  │  │  │  예상 비용: ~12 크레딧 (잔액: 87)                  │  │  │   │
│  │  │  │  분석 가능                                         │  │  │   │
│  │  │  └──────────────────────────────────────────────────┘  │  │   │
│  │  │                                                          │  │   │
│  │  │  [분석 시작] 버튼                                        │  │   │
│  │  └─────────────────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─ 하단: SavedDataGrid (기존 — 변경 없음) ─────────────────────┐   │
│  └───────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

### 4-2. 배치도 — 분석 결과 화면 헤더

```
┌─ header ──────────────────────────────────────────────────────────────┐
│  [인물관계도]  제목  │ 엔티티 N  관계 N  장면 N                       │
│                                                                       │
│  [관계도][타임라인][연대기][세계관][원본]                              │
│                                                                       │
│  [CreditBadge]  저장상태  데이터관리  파일추가  새파일  [UserMenu]    │
└───────────────────────────────────────────────────────────────────────┘
```

### 4-3. 분석 완료 모달

```
┌ UsageSummary (신규) ──────────────────────────────────┐
│  분석 완료                                             │
│                                                        │
│  총 청크: 10개                                         │
│  사용 토큰: 34,521 input + 15,230 output              │
│  차감 크레딧: 12                                       │
│  잔여 크레딧: 75                                       │
│                                                        │
│  [확인]                                                │
└────────────────────────────────────────────────────────┘
```

### 4-4. 컴포넌트 목록

| 컴포넌트 | 파일 | 위치 | 역할 |
|----------|------|------|------|
| **CreditBadge** | `components/CreditBadge.tsx` (신규) | 헤더 우측, UserMenu 좌측 | 현재 크레딧 잔액 표시. 클릭 시 구독 관리 모달. 잔액 부족 시 경고 색상 |
| **UsageEstimate** | `components/UsageEstimate.tsx` (신규) | FileUpload 내부, 파일 선택 후 분석 버튼 전 | 글자수 기반 토큰 추정, 크레딧 예상, 잔액 대비 가능/불가능 표시 |
| **UsageSummary** | `components/UsageSummary.tsx` (신규) | 분석 완료 후 모달 | 실제 사용된 토큰, 차감 크레딧, 잔여 잔액 |
| **SubscriptionPage** | `components/SubscriptionPage.tsx` (신규) | CreditBadge 클릭 시 모달 | 현재 플랜, 플랜 비교, 업그레이드, 크레딧 구매, BYOK 설정 |
| **UsageHistory** | `components/UsageHistory.tsx` (신규) | SubscriptionPage 내 탭 | CreditLedger 기반 사용 내역 테이블 |

### 4-5. 기존 컴포넌트 수정

**`FileUpload.tsx`:**
1. 모델 선택 드롭다운 — `plan.features.models` 기반 필터링
2. 파일 선택 후 — `UsageEstimate` 컴포넌트 렌더
3. [분석 시작] 클릭 시 — BYOK 모드 확인, 잔액 사전 확인
4. 각 청크 분석 완료 시 — 응답의 `_billing` 데이터를 store에 누적
5. 전체 분석 완료 시 — `UsageSummary` 표시

**`UserMenu.tsx`:**
- 닉네임 옆에 구독 플랜 배지 표시 (예: `[Pro]`)

**`App.tsx`:**
- 업로드 화면: UserMenu 좌측에 CreditBadge 배치
- 결과 화면 헤더: 기존 버튼들 사이에 CreditBadge 배치
- 로그인 시 `billing.loadSubscription()` 호출

---

## 5. 서비스 레이어 (narrative-studio)

```typescript
// web/src/services/billing.ts (신규)

const BASE = '/api/billing';

export async function getSubscription(): Promise<SubscriptionInfo>;
export async function getCreditBalance(): Promise<{ balance: number }>;
export async function estimateCredits(params: {
  charCount: number; model: string;
}): Promise<{ estimatedCredits: number; estimatedTokens: { input: number; output: number } }>;
export async function getUsageHistory(page?: number): Promise<PaginatedResponse<CreditTransaction>>;
export async function getPlans(): Promise<ServicePlan[]>;
export async function getCreditPackages(): Promise<CreditPackage[]>;
```

---

## 6. 토큰 추정 로직

```python
# catcident-backend: apps/billing/services/estimator.py

class StorygraphEstimator:
    CHARS_PER_TOKEN = 1.5          # 한국어 평균: 1 토큰 ~ 1.5자
    CHUNK_SIZE = 5000
    CHUNK_OVERLAP = 300
    MARGIN_MULTIPLIER = 3.0        # 마진 배수
    KRW_PER_CREDIT = 10            # 1 크레딧 = 10원
    USD_TO_KRW = 1400              # 환율 (주기적 업데이트 또는 고정)

    MODEL_COSTS = {                # USD per 1M tokens (types.ts와 동기화)
        'google/gemini-2.0-flash-001': {'input': 0.10, 'output': 0.40},
        'anthropic/claude-3.5-sonnet': {'input': 3.00, 'output': 15.00},
        'openai/gpt-4o':               {'input': 2.50, 'output': 10.00},
        'deepseek/deepseek-chat':      {'input': 0.14, 'output': 0.28},
        # ...
    }

    def estimate(self, char_count: int, model: str) -> dict:
        # 1. 청크 수 계산
        # 2. 토큰 추정 (input + output + 엔티티 선별 호출)
        # 3. USD 비용 계산
        # 4. 크레딧 변환: ceil(total_usd * USD_TO_KRW * MARGIN / KRW_PER_CREDIT)
        return {
            'estimated_credits': credits,
            'estimated_input_tokens': input_tokens,
            'estimated_output_tokens': output_tokens,
            'estimated_cost_usd': total_usd,
            'chunks': chunks,
        }
```

---

## 7. 데이터 흐름 (분석 1건)

```
사용자                narrative-studio              catcident-backend
  │                        │                              │
  │  1. 파일 업로드        │                              │
  │───────────────────────>│                              │
  │                        │  2. 예상 크레딧 요청          │
  │                        │─────────────────────────────>│
  │                        │  {charCount, model}           │
  │                        │<─────────────────────────────│
  │  3. 예상 표시          │  {estimatedCredits: 12}       │
  │<───────────────────────│                              │
  │                        │                              │
  │  4. [분석 시작]        │                              │
  │───────────────────────>│                              │
  │                        │  5. 잔액 사전 확인            │
  │                        │─────────────────────────────>│
  │                        │<─────────────────────────────│
  │                        │  {balance: 87, ok: true}      │
  │                        │                              │
  │                        │  6. 청크별 루프               │
  │  진행률 표시           │    OpenRouter 호출             │
  │<───────────────────────│    usage 수집                 │
  │                        │                              │
  │                        │  7. 총 사용량 합산            │
  │                        │  8. 크레딧 차감 요청          │
  │                        │─────────────────────────────>│
  │                        │  {amount:12, idempotencyKey}  │
  │                        │<─────────────────────────────│
  │                        │  {balance_after: 75}          │
  │                        │                              │
  │  9. UsageSummary 표시  │                              │
  │<───────────────────────│                              │
```

---

## 8. 환경 변수

### catcident-backend 추가

```bash
STORYGRAPH_SERVICE_KEY=sk-svc-...    # storygraph 서비스 인증 키
```

### narrative-studio 추가

```bash
CATCIDENT_API_URL=https://catcident.com    # catcident backend URL
CATCIDENT_SERVICE_KEY=sk-svc-...           # 서비스 간 인증 키
```

---

## 9. 요금제 초기 데이터

### ServicePlan

| code | name | 월 크레딧 | 월 가격 | features |
|------|------|----------|---------|----------|
| free | Free | 100 | 0 | `byok: false`, `models: [기본모델들]`, `max_file_size_mb: 2`, `can_purchase_credits: false` |
| basic | Basic | 1,000 | 4,900 | `byok: false`, `models: "all"`, `max_file_size_mb: 10`, `can_purchase_credits: true` |
| pro | Pro | 5,000 | 14,900 | `byok: true`, `models: "all"`, `max_file_size_mb: 50`, `can_purchase_credits: true` |

### CreditPackage

| name | credits | price_krw | bonus_pct |
|------|---------|-----------|-----------|
| 500 크레딧 | 500 | 4,900 | 0% |
| 1,200 크레딧 | 1,000 | 9,900 | 20% |
| 3,000 크레딧 | 2,000 | 19,900 | 50% |

---

## 10. 구현 단계 (의존성 순서)

```
Phase 1: 기반 (catcident-backend)
  ├── billing 앱 생성 + 모델 정의 + migration
  ├── Service, ServicePlan fixture 데이터
  ├── CreditService (잔액 조회, 차감, 충전)
  ├── SubscriptionService (조회, 자동 생성)
  ├── billing API 엔드포인트
  ├── 서비스 간 인증 (X-Service-Key)
  └── Admin 인터페이스

Phase 2: 연동 (narrative-studio 백엔드)
  ├── /api/billing/ 프록시 라우트
  ├── requireAuth() 확장 (accessToken 포함)
  ├── /api/analyze 수정 (usage 캡처 + 차감 호출)
  └── services/billing.ts

Phase 3: UI (narrative-studio 프론트엔드)
  ├── store.ts billing 상태 추가
  ├── CreditBadge 컴포넌트
  ├── UsageEstimate 컴포넌트
  ├── UsageSummary 컴포넌트
  ├── FileUpload 수정 (잔액 확인, 모델 필터링)
  └── App.tsx / UserMenu.tsx 수정

Phase 4: 구독 관리 UI
  ├── SubscriptionPage (플랜 비교, 업그레이드)
  ├── UsageHistory (사용 내역)
  ├── BYOK 설정 UI (Pro 전용)
  └── OAuth claims 확장 (billing scope)

Phase 5: 결제 연동
  ├── Toss Payments 또는 PortOne 연동
  ├── 구독 결제 흐름
  ├── 크레딧 구매 흐름
  └── Celery tasks (월간 리셋, 만료 체크)
```
