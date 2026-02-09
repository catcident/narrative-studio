# 결제 테스트 모드 + 프로모션 시스템 구현 계획

**목표:** TossPayments PG 심사 통과 전까지 결제 버튼을 비활성화하고 테스트 모드임을 명시하되, 프로모션 코드를 통해 크레딧을 배포하여 사용자 유입과 서비스 체험을 가능하게 한다.

**배경:**
- TossPayments 테스트 키로 결제 연동 구현 완료
- PG 심사 전이라 실제 결제 불가 (테스트 카드번호만 허용)
- 런칭 시 무료 크레딧 + 프로모션 코드로 사용자에게 크레딧 제공 필요

**Tech Stack:** Next.js 15, Django 5.2, DRF, Zustand, Celery

---

## Phase 1: 결제 테스트 모드 배너

### 개요

환경 변수 `PAYMENT_ENABLED`로 결제 가능 여부를 제어. `false`일 때 결제 버튼 비활성화 + 테스트 배너 표시.

### 1-1. catcident-backend — Django 설정 + 템플릿

**수정 파일:**
- `config/settings/base.py` — `PAYMENT_ENABLED = env.bool("PAYMENT_ENABLED", default=False)` 추가
- `apps/business/payment/views.py` — 모든 결제 뷰에 `payment_enabled` context 전달

**수정 파일 (템플릿):**
- `templates/billing/checkout.html` — `payment_enabled=false`일 때:
  - 상단 배너: "결제 시스템 준비 중입니다. 프로모션 코드로 크레딧을 받을 수 있습니다."
  - 결제 위젯 숨김, 패키지 목록은 표시 (가격 확인용)
- `templates/billing/subscribe.html` — 동일 패턴

**API 노출:**
- `GET /api/v1/billing/config/` (또는 기존 config 엔드포인트에 추가)
  - 응답: `{ "payment_enabled": false }`
  - storygraph 프론트엔드가 이 값을 읽어 UI 제어

### 1-2. narrative-studio/web — 프론트엔드 UI

**수정 파일:**
- `web/src/components/SubscriptionPage.tsx`:
  - billing config에서 `payment_enabled` 조회
  - `false`일 때 플랜 탭: 업그레이드 버튼 → disabled + "준비 중" 텍스트
  - `false`일 때 크레딧 탭: 구매 버튼 → disabled + "준비 중" 텍스트
  - 모달 상단에 테스트 배너: "현재 결제 시스템 테스트 중입니다. 프로모션 코드로 크레딧을 받을 수 있습니다."
- `web/src/components/landing/PricingSection.tsx`:
  - "시작하기" 버튼은 유지 (로그인 → 무료 플랜)
  - 유료 플랜 가격 옆에 "출시 준비 중" 배지

### 1-3. 환경 변수 전환

```bash
# 테스트 기간 (PG 심사 전)
PAYMENT_ENABLED=false

# PG 심사 통과 후
PAYMENT_ENABLED=true
```

변경 후 `docker compose restart api`만 하면 즉시 전환.

---

## Phase 2: 프로모션 코드 시스템

### 개요

관리자가 프로모션 코드를 생성하고, 사용자가 코드를 입력하면 크레딧이 지급되는 시스템.

### 2-1. Django 모델

**생성 파일:** `apps/business/billing/models.py`에 추가 (별도 앱 불필요)

```python
class PromotionCode(BaseModel):
    """프로모션 코드"""
    code = models.CharField(max_length=50, unique=True, verbose_name='코드')
    description = models.CharField(max_length=200, verbose_name='설명')
    credits = models.IntegerField(verbose_name='지급 크레딧')
    max_uses = models.IntegerField(default=0, verbose_name='최대 사용 횟수',
        help_text='0이면 무제한')
    used_count = models.IntegerField(default=0, verbose_name='사용 횟수')
    starts_at = models.DateTimeField(null=True, blank=True, verbose_name='시작일')
    expires_at = models.DateTimeField(null=True, blank=True, verbose_name='만료일')
    is_active = models.BooleanField(default=True, verbose_name='활성')

    class Meta:
        verbose_name = 'B09. 프로모션 코드'
        verbose_name_plural = 'B09. 프로모션 코드 목록'


class PromotionRedemption(BaseModel):
    """프로모션 코드 사용 내역"""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='promotion_redemptions')
    promotion = models.ForeignKey(PromotionCode, on_delete=models.CASCADE,
        related_name='redemptions')
    credits_granted = models.IntegerField(verbose_name='지급된 크레딧')

    class Meta:
        verbose_name = 'B10. 프로모션 사용 내역'
        verbose_name_plural = 'B10. 프로모션 사용 내역 목록'
        unique_together = ['user', 'promotion']  # 1인 1회 사용
```

### 2-2. TransactionType 추가

**수정 파일:** `apps/business/billing/models.py`

```python
class TransactionType:
    MONTHLY_GRANT = 'monthly_grant'
    SIGNUP_BONUS = 'signup_bonus'
    PURCHASE = 'purchase'
    PROMOTION = 'promotion'      # ← 추가
    USAGE = 'usage'
    REFUND = 'refund'
    ADMIN_ADJUST = 'admin_adjust'
    EXPIRY = 'expiry'

    CHOICES = [
        ...
        (PROMOTION, '프로모션'),  # ← 추가
        ...
    ]
```

### 2-3. 프로모션 적용 서비스

**생성 파일:** `apps/business/billing/services/promotion_service.py`

```python
class PromotionService:
    @staticmethod
    @transaction.atomic
    def redeem(user, code_string):
        """
        프로모션 코드 적용

        검증 순서:
        1. 코드 존재 + 활성 확인
        2. 유효기간 확인
        3. 사용 횟수 확인
        4. 중복 사용 확인 (1인 1회)
        5. 크레딧 지급
        """
        promo = PromotionCode.objects.select_for_update().get(
            code=code_string.strip().upper(), is_active=True)

        # 유효기간
        now = timezone.now()
        if promo.starts_at and now < promo.starts_at:
            raise ValidationError('아직 시작되지 않은 프로모션입니다.')
        if promo.expires_at and now > promo.expires_at:
            raise ValidationError('만료된 프로모션 코드입니다.')

        # 사용 횟수
        if promo.max_uses > 0 and promo.used_count >= promo.max_uses:
            raise ValidationError('사용 횟수가 초과된 코드입니다.')

        # 중복 사용
        if PromotionRedemption.objects.filter(user=user, promotion=promo).exists():
            raise ValidationError('이미 사용한 프로모션 코드입니다.')

        # 크레딧 지급
        subscription = ServiceSubscription.objects.get(
            user=user, service__code=DEFAULT_SERVICE_CODE)
        CreditService.grant(
            subscription.pk, promo.credits,
            TransactionType.PROMOTION,
            f'프로모션: {promo.description} ({promo.code})')

        # 사용 기록
        PromotionRedemption.objects.create(
            user=user, promotion=promo, credits_granted=promo.credits)
        promo.used_count += 1
        promo.save(update_fields=['used_count', 'updated_at'])

        return {'credits_granted': promo.credits, 'description': promo.description}
```

### 2-4. API 엔드포인트

**수정 파일:** `apps/business/billing/views.py` + `urls.py`

```
POST /api/v1/billing/promotions/redeem/
Body: { "code": "LAUNCH500" }
Response 200: { "credits_granted": 500, "description": "런칭 이벤트" }
Response 400: { "error": "이미 사용한 프로모션 코드입니다." }
Response 404: { "error": "유효하지 않은 프로모션 코드입니다." }
```

인증 필수 (기존 billing API와 동일). storygraph 프론트엔드에서 프록시.

### 2-5. Django Admin 등록

**수정 파일:** `apps/business/billing/admin.py`

- `PromotionCodeAdmin`: code, description, credits, max_uses, used_count, expires_at 표시
  - 관리자가 Django Admin에서 코드 생성/비활성화
- `PromotionRedemptionAdmin`: user, promotion, credits_granted, created_at (읽기 전용)

### 2-6. narrative-studio/web — 프론트엔드 UI

**수정 파일:**
- `web/src/components/SubscriptionPage.tsx`:
  - 새 탭 또는 크레딧 탭 하단에 "프로모션 코드" 입력 섹션
  - 텍스트 입력 + "적용" 버튼
  - 성공: "500 크레딧이 지급되었습니다!" 토스트 + 잔액 갱신
  - 실패: 에러 메시지 표시
- `web/src/services/billing.ts` — `redeemPromotionCode(code)` 함수 추가
- `web/src/app/api/billing/promotions/redeem/route.ts` — 프록시 API 라우트

---

## Phase 3: management command (관리자 일괄 지급)

### 개요

특정 조건의 사용자에게 크레딧을 일괄 지급하는 관리 명령어.

**생성 파일:** `apps/business/billing/management/commands/grant_event_credits.py`

```bash
# 모든 활성 사용자에게 300cr 지급
docker compose run --rm api python manage.py grant_event_credits \
  --credits 300 --reason "오픈 베타 감사 이벤트" --all

# 특정 사용자에게 지급
docker compose run --rm api python manage.py grant_event_credits \
  --credits 500 --reason "버그 리포트 감사" --users user1@email.com user2@email.com

# 특정일 이전 가입자에게 지급
docker compose run --rm api python manage.py grant_event_credits \
  --credits 200 --reason "얼리어답터 보너스" --joined-before 2026-03-01
```

`TransactionType.ADMIN_ADJUST` 사용 (이미 정의됨).

---

## 이벤트 운영 예시

### 런칭 이벤트 시나리오

```
1. 서비스 오픈 (PAYMENT_ENABLED=false)
   - 가입 시 무료 크레딧 100cr 자동 지급 (기존 기능)

2. 프로모션 코드 배포
   - Django Admin에서 생성:
     코드: LAUNCH500
     크레딧: 500
     만료: 2026-03-31
     최대 사용: 1000명
   - SNS/블로그에 코드 공개

3. PG 심사 통과 후
   - PAYMENT_ENABLED=true 전환
   - 프로모션 코드 비활성화 또는 유지 (선택)
   - 실제 결제 가능

4. 추가 이벤트
   - "친구 초대" 코드 (INVITE100)
   - "후기 작성" 코드 (REVIEW200)
   - 관리자 일괄 지급 (얼리어답터 감사)
```

### 사용자 경험 흐름

```
1. storygraph.catcident.com 방문 → 랜딩 페이지
2. "무료로 시작하기" → 회원가입 → 100cr 자동 지급
3. 소설 업로드 → AI 분석 체험 (무료 크레딧 사용)
4. 크레딧 부족 → SubscriptionPage 열기
5. "결제 시스템 준비 중" 배너 확인
6. 프로모션 코드 입력: LAUNCH500 → 500cr 즉시 지급
7. 추가 분석 계속 진행
```

---

## 수정 파일 목록

### catcident-backend

| 파일 | 변경 내용 | Phase |
|------|----------|-------|
| `config/settings/base.py` | `PAYMENT_ENABLED` 환경 변수 | 1 |
| `apps/business/payment/views.py` | `payment_enabled` context 전달 | 1 |
| `templates/billing/checkout.html` | 테스트 배너 + 위젯 조건부 표시 | 1 |
| `templates/billing/subscribe.html` | 테스트 배너 + 위젯 조건부 표시 | 1 |
| `apps/business/billing/models.py` | `PromotionCode`, `PromotionRedemption` 모델, `TransactionType.PROMOTION` | 2 |
| `apps/business/billing/admin.py` | 프로모션 Admin 등록 | 2 |
| `apps/business/billing/services/promotion_service.py` | 프로모션 적용 서비스 (새 파일) | 2 |
| `apps/business/billing/views.py` | `RedeemPromotionView` 추가 | 2 |
| `apps/business/billing/urls.py` | 프로모션 URL 추가 | 2 |
| `apps/business/billing/management/commands/grant_event_credits.py` | 일괄 지급 명령어 (새 파일) | 3 |

### narrative-studio/web

| 파일 | 변경 내용 | Phase |
|------|----------|-------|
| `web/src/components/SubscriptionPage.tsx` | 테스트 배너 + 결제 버튼 비활성화 + 프로모션 코드 UI | 1, 2 |
| `web/src/components/landing/PricingSection.tsx` | 유료 플랜 "준비 중" 배지 | 1 |
| `web/src/services/billing.ts` | `getPaymentConfig()`, `redeemPromotionCode()` | 1, 2 |
| `web/src/app/api/billing/promotions/redeem/route.ts` | 프록시 API (새 파일) | 2 |
| `web/src/app/api/billing/config/route.ts` | payment_enabled 프록시 (새 파일 또는 기존 config 확장) | 1 |

---

## 의존성 그래프

```
Phase 1 (테스트 배너)     ← 즉시 필요, 런칭 전 필수
    │
    ▼
Phase 2 (프로모션 코드)   ← 런칭과 동시 또는 직후
    │
    ▼
Phase 3 (일괄 지급 CLI)   ← 운영 편의, 언제든 추가 가능
```

Phase 1은 독립적으로 먼저 배포 가능. Phase 2는 Phase 1과 병렬 구현 가능.

---

## 사용자 직접 작업

| # | 시점 | 작업 | 설명 |
|---|------|------|------|
| P1 | Phase 1 | `PAYMENT_ENABLED=false` 설정 | catcident-backend `.env.local` |
| P2 | Phase 2 후 | 프로모션 코드 생성 | Django Admin에서 코드/크레딧/만료일 설정 |
| P3 | PG 심사 후 | `PAYMENT_ENABLED=true` 전환 | 심사 통과 + 라이브 키 적용 후 |
