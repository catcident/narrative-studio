# 05. 결제 시스템 — TossPayments 연동

> catcident-backend에 TossPayments 결제 게이트웨이 구현

## 아키텍처 개요

### 핵심 원칙

**결제 UI와 로직은 catcident-backend에서 처리**. storygraph는 리다이렉트만.

```
[storygraph.catcident.com]
  │ "업그레이드" / "크레딧 충전" 버튼
  │
  ↓ 리다이렉트
[catcident.com/billing/checkout/]     ← 크레딧 패키지 결제
[catcident.com/billing/subscribe/]    ← 플랜 구독 결제
  │
  │ TossPayments SDK v2 (프론트엔드)
  │ 결제 위젯 → 카드/간편결제 선택
  │
  ↓ 성공 리다이렉트
[catcident.com/billing/success/]
  │
  │ paymentKey + orderId + amount 검증
  ↓
[catcident-backend]
  │ → TossPayments REST API (결제 승인)
  │ → CreditService.grant() (크레딧 지급)
  │ → PaymentHistory 기록
  │
  ↓ 결제 완료 후
[storygraph.catcident.com]            ← 리다이렉트 또는 팝업 닫기
  │ loadSubscription() 재호출 → 잔액 갱신
```

### 이 구조의 장점

1. 결제 로직이 catcident-backend에 집중 (단일 책임)
2. PCI DSS 관련 복잡성을 한 곳에서 관리
3. storygraph에 TossPayments SDK 의존성 불필요
4. 향후 다른 서비스 추가 시 동일 결제 페이지 재사용
5. 결제 관련 법적 요건 (이용약관, 환불 정책)을 catcident.com에서 통합 관리

---

## 두 가지 결제 유형

| 유형 | 용도 | TossPayments API | 구현 우선순위 |
|------|------|-----------------|-------------|
| **일회성 결제** | 크레딧 패키지 구매 | Payment Widget → confirm | Phase 1 (우선) |
| **정기결제 (빌링키)** | 플랜 월간 구독 | Billing Auth → 빌링키 → 자동 청구 | Phase 2 |

---

## Phase 1: 일회성 크레딧 패키지 결제

### 흐름

```
[사용자]
  → 크레딧 패키지 선택 (550cr / 1,200cr / 2,800cr)
  → TossPayments 결제 위젯 (카드, 간편결제 등)
  → 결제 완료
  → successUrl 리다이렉트 (?paymentKey&orderId&amount)
  → 서버: TossPayments confirm API 호출 (금액 검증)
  → 서버: CreditService.grant() → 크레딧 지급
  → 사용자: 잔액 갱신 확인
```

### 프론트엔드 (catcident.com — Vite + Alpine.js)

#### 결제 페이지 URL
```
catcident.com/ko/billing/checkout/                 → 패키지 선택 + 결제 위젯
catcident.com/ko/billing/checkout/success/         → 결제 성공 콜백
catcident.com/ko/billing/checkout/fail/            → 결제 실패 콜백
```

#### TossPayments SDK 설치
```bash
npm install @tosspayments/tosspayments-sdk
```

#### 결제 위젯 호출 (Alpine.js 예시)

```html
<!-- templates/billing/checkout.html -->
<div x-data="checkoutWidget()">
  <!-- 패키지 선택 -->
  <div class="grid grid-cols-3 gap-4">
    <template x-for="pkg in packages" :key="pkg.id">
      <button @click="selectedPackage = pkg"
              :class="selectedPackage?.id === pkg.id ? 'ring-2 ring-blue-500' : ''"
              class="p-4 rounded-lg border">
        <div x-text="pkg.name" class="font-bold"></div>
        <div x-text="pkg.credits + ' 크레딧'" class="text-sm"></div>
        <div x-text="pkg.price.toLocaleString() + '원'" class="text-lg font-bold"></div>
        <div x-show="pkg.bonus > 0" x-text="'+' + pkg.bonus + '% 보너스'" class="text-green-500 text-sm"></div>
      </button>
    </template>
  </div>

  <!-- 결제 버튼 -->
  <button @click="requestPayment()" :disabled="!selectedPackage"
          class="mt-4 w-full py-3 bg-blue-500 text-white rounded-lg">
    <span x-text="selectedPackage ? selectedPackage.price.toLocaleString() + '원 결제하기' : '패키지를 선택하세요'"></span>
  </button>
</div>

<script type="module">
import { loadTossPayments } from '@tosspayments/tosspayments-sdk';

const CLIENT_KEY = '{{ TOSS_CLIENT_KEY }}';  // 서버에서 주입

document.addEventListener('alpine:init', () => {
  Alpine.data('checkoutWidget', () => ({
    packages: [
      { id: 1, name: '스타터', credits: 550, price: 4900, bonus: 0 },
      { id: 2, name: '스탠다드', credits: 1200, price: 9900, bonus: 10 },
      { id: 3, name: '프로', credits: 2800, price: 19900, bonus: 30 },
    ],
    selectedPackage: null,

    async requestPayment() {
      if (!this.selectedPackage) return;

      const tossPayments = await loadTossPayments(CLIENT_KEY);
      const customerKey = '{{ customer_key }}';  // 서버에서 사용자 UUID 주입
      const payment = tossPayments.payment({ customerKey });

      const orderId = `credit_${this.selectedPackage.id}_${crypto.randomUUID().slice(0, 12)}`;

      await payment.requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: this.selectedPackage.price },
        orderId,
        orderName: `${this.selectedPackage.name} (${this.selectedPackage.credits} 크레딧)`,
        successUrl: `${window.location.origin}/ko/billing/checkout/success/`,
        failUrl: `${window.location.origin}/ko/billing/checkout/fail/`,
      });
    },
  }));
});
</script>
```

#### 성공 콜백 페이지

```html
<!-- templates/billing/checkout_success.html -->
<div x-data="confirmPayment()" x-init="confirm()">
  <template x-if="status === 'loading'">
    <p>결제 처리 중...</p>
  </template>
  <template x-if="status === 'success'">
    <div>
      <p>결제가 완료되었습니다!</p>
      <p x-text="creditsGranted + ' 크레딧이 지급되었습니다.'"></p>
      <a href="https://storygraph.catcident.com">스토리그래프로 돌아가기</a>
    </div>
  </template>
  <template x-if="status === 'error'">
    <p>결제 처리에 실패했습니다. 고객센터에 문의하세요.</p>
  </template>
</div>

<script>
Alpine.data('confirmPayment', () => ({
  status: 'loading',
  creditsGranted: 0,

  async confirm() {
    const params = new URLSearchParams(window.location.search);
    const paymentKey = params.get('paymentKey');
    const orderId = params.get('orderId');
    const amount = params.get('amount');

    if (!paymentKey || !orderId || !amount) {
      this.status = 'error';
      return;
    }

    try {
      const res = await fetch('/api/v1/billing/confirm-credit-purchase/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
        },
        body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      this.creditsGranted = data.credits_granted;
      this.status = 'success';
    } catch {
      this.status = 'error';
    }
  },
}));
</script>
```

### 백엔드 (catcident-backend — Django)

#### 새 앱 구조

```
apps/business/payment/
├── __init__.py
├── models.py              # PaymentMethod, PaymentHistory
├── admin.py
├── services/
│   ├── __init__.py
│   ├── toss_service.py    # TossPayments API 클라이언트
│   └── payment_service.py # 결제 흐름 오케스트레이션
├── views.py               # 결제 위젯 페이지, 성공/실패 콜백
├── api_views.py           # REST API (결제 승인)
├── webhooks.py            # 웹훅 수신
├── urls.py
└── tasks.py               # Celery 태스크 (정기결제)
```

#### Django 모델

```python
# apps/business/payment/models.py

class PaymentMethod(BaseModel):
    """사용자 결제 수단 (빌링키 저장)"""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='payment_methods')
    customer_key = models.CharField(max_length=100, unique=True,
                                    help_text='TossPayments customerKey (UUID)')
    billing_key = models.CharField(max_length=200,
                                   help_text='암호화된 빌링키')
    card_company = models.CharField(max_length=50, blank=True)
    card_number_masked = models.CharField(max_length=20, blank=True,
                                          help_text='마스킹된 카드번호 (예: 4890****406*)')
    card_type = models.CharField(max_length=20, blank=True)  # CREDIT, CHECK
    is_primary = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = 'B07. 결제 수단'
        verbose_name_plural = 'B07. 결제 수단 목록'


class PaymentHistory(BaseModel):
    """결제 이력"""
    class PaymentType(models.TextChoices):
        SUBSCRIPTION = 'subscription', '구독 결제'
        CREDIT_PURCHASE = 'credit_purchase', '크레딧 구매'

    class PaymentStatus(models.TextChoices):
        PENDING = 'pending', '대기'
        DONE = 'done', '완료'
        CANCELED = 'canceled', '취소'
        FAILED = 'failed', '실패'

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='payment_history')
    payment_key = models.CharField(max_length=200, unique=True,
                                   help_text='TossPayments paymentKey')
    order_id = models.CharField(max_length=64, unique=True)
    order_name = models.CharField(max_length=100)
    amount = models.IntegerField()
    payment_type = models.CharField(max_length=20, choices=PaymentType.choices)
    status = models.CharField(max_length=20, choices=PaymentStatus.choices,
                              default=PaymentStatus.PENDING)
    toss_response = models.JSONField(default=dict, blank=True)
    idempotency_key = models.CharField(max_length=100, unique=True, null=True, blank=True)
    subscription = models.ForeignKey('billing.ServiceSubscription', null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name='payments')
    credit_package = models.ForeignKey('billing.CreditPackage', null=True, blank=True,
                                       on_delete=models.SET_NULL, related_name='payments')

    class Meta:
        verbose_name = 'B08. 결제 이력'
        verbose_name_plural = 'B08. 결제 이력 목록'
        ordering = ['-created_at']
```

#### TossPayments API 서비스

```python
# apps/business/payment/services/toss_service.py

import base64
import logging
import requests
from django.conf import settings

logger = logging.getLogger(__name__)

TOSS_API_BASE = "https://api.tosspayments.com"
TOSS_TIMEOUT = 60  # TossPayments 권장: >= 60초


class TossPaymentError(Exception):
    """TossPayments API 에러"""
    def __init__(self, status_code: int, error_data: dict):
        self.status_code = status_code
        self.code = error_data.get("code", "UNKNOWN")
        self.message = error_data.get("message", "Unknown error")
        super().__init__(f"[{self.code}] {self.message}")


def _get_auth_headers():
    """TossPayments Basic Auth 헤더 (시크릿 키 뒤에 콜론 필수)"""
    secret_key = settings.TOSS_SECRET_KEY
    encoded = base64.b64encode(f"{secret_key}:".encode()).decode()
    return {
        "Authorization": f"Basic {encoded}",
        "Content-Type": "application/json",
    }


def confirm_payment(payment_key: str, order_id: str, amount: int) -> dict:
    """
    일회성 결제 승인 (successUrl 리다이렉트 후 10분 이내 호출 필수)

    Returns: TossPayments Payment 객체
    Raises: TossPaymentError
    """
    response = requests.post(
        f"{TOSS_API_BASE}/v1/payments/confirm",
        headers=_get_auth_headers(),
        json={"paymentKey": payment_key, "orderId": order_id, "amount": amount},
        timeout=TOSS_TIMEOUT,
    )
    if not response.ok:
        logger.error("결제 승인 실패: status=%d, body=%s",
                      response.status_code, response.text)
        raise TossPaymentError(response.status_code, response.json())
    return response.json()


def issue_billing_key(auth_key: str, customer_key: str) -> dict:
    """
    빌링키 발급 (정기결제용)

    Returns: {billingKey, customerKey, card: {...}}
    Raises: TossPaymentError
    """
    response = requests.post(
        f"{TOSS_API_BASE}/v1/billing/authorizations/issue",
        headers=_get_auth_headers(),
        json={"authKey": auth_key, "customerKey": customer_key},
        timeout=TOSS_TIMEOUT,
    )
    if not response.ok:
        logger.error("빌링키 발급 실패: status=%d, body=%s",
                      response.status_code, response.text)
        raise TossPaymentError(response.status_code, response.json())
    return response.json()


def charge_billing_key(
    billing_key: str, customer_key: str, amount: int,
    order_id: str, order_name: str, idempotency_key: str | None = None,
) -> dict:
    """
    빌링키 자동결제 승인 (정기결제 갱신)

    Returns: TossPayments Payment 객체
    Raises: TossPaymentError
    """
    headers = _get_auth_headers()
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    response = requests.post(
        f"{TOSS_API_BASE}/v1/billing/{billing_key}",
        headers=headers,
        json={
            "customerKey": customer_key,
            "amount": amount,
            "orderId": order_id,
            "orderName": order_name,
        },
        timeout=TOSS_TIMEOUT,
    )
    if not response.ok:
        logger.error("자동결제 실패: status=%d, body=%s",
                      response.status_code, response.text)
        raise TossPaymentError(response.status_code, response.json())
    return response.json()


def cancel_payment(payment_key: str, cancel_reason: str,
                   cancel_amount: int | None = None) -> dict:
    """결제 취소 (전액 또는 부분)"""
    body = {"cancelReason": cancel_reason}
    if cancel_amount is not None:
        body["cancelAmount"] = cancel_amount

    response = requests.post(
        f"{TOSS_API_BASE}/v1/payments/{payment_key}/cancel",
        headers=_get_auth_headers(),
        json=body,
        timeout=TOSS_TIMEOUT,
    )
    if not response.ok:
        raise TossPaymentError(response.status_code, response.json())
    return response.json()
```

#### 결제 승인 API View

```python
# apps/business/payment/api_views.py

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from apps.business.billing.models import CreditPackage, ServiceSubscription
from apps.business.billing.services.credit_service import CreditService
from .services.toss_service import confirm_payment, TossPaymentError
from .models import PaymentHistory


class ConfirmCreditPurchaseView(APIView):
    """크레딧 구매 결제 승인"""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payment_key = request.data.get("paymentKey")
        order_id = request.data.get("orderId")
        amount = request.data.get("amount")

        if not all([payment_key, order_id, amount]):
            return Response(
                {"error": "paymentKey, orderId, amount 필수"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 1. orderId에서 패키지 ID 추출 및 검증
        try:
            package_id = order_id.split("_")[1]
            package = CreditPackage.objects.get(pk=package_id, is_active=True)
        except (IndexError, ValueError, CreditPackage.DoesNotExist):
            return Response(
                {"error": "유효하지 않은 주문입니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 2. 금액 위변조 검증
        if int(amount) != package.price_krw:
            return Response(
                {"error": "결제 금액이 일치하지 않습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 3. 중복 결제 방지
        if PaymentHistory.objects.filter(order_id=order_id).exists():
            return Response(
                {"error": "이미 처리된 주문입니다."},
                status=status.HTTP_409_CONFLICT,
            )

        # 4. TossPayments 결제 승인
        try:
            result = confirm_payment(payment_key, order_id, int(amount))
        except TossPaymentError:
            return Response(
                {"error": "결제 승인에 실패했습니다."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # 5. 크레딧 지급
        subscription = CreditService.get_or_create_subscription(
            request.user, 'storygraph'
        )
        total_credits = package.credits + (package.credits * package.bonus_pct // 100)

        CreditService.grant(
            subscription_id=subscription.pk,
            amount=total_credits,
            tx_type='purchase',
            description=f"{package.name} 구매 ({total_credits} 크레딧)",
        )

        # 6. 결제 이력 저장
        PaymentHistory.objects.create(
            user=request.user,
            payment_key=payment_key,
            order_id=order_id,
            order_name=f"{package.name} ({total_credits} 크레딧)",
            amount=int(amount),
            payment_type=PaymentHistory.PaymentType.CREDIT_PURCHASE,
            status=PaymentHistory.PaymentStatus.DONE,
            toss_response=result,
            subscription=subscription,
            credit_package=package,
        )

        return Response({
            "credits_granted": total_credits,
            "new_balance": subscription.credit_balance + subscription.purchased_credit_balance,
        })
```

---

## Phase 2: 정기결제 (빌링키)

### 흐름

```
[사용자]
  → 플랜 선택 (Basic/Pro/Business)
  → TossPayments 카드 등록 (requestBillingAuth)
  → successUrl 리다이렉트 (?authKey&customerKey)
  → 서버: 빌링키 발급 (issue_billing_key)
  → 서버: 즉시 첫 결제 (charge_billing_key)
  → 서버: 구독 활성화 + 크레딧 리셋
  → [매월 Celery Beat]
    → 만료 구독 조회
    → 빌링키 자동 청구
    → 성공: 구독 연장 + 크레딧 리셋
    → 실패: past_due 마킹 + 재시도/알림
```

### Celery Beat 설정

```python
# config/celery.py (beat_schedule 추가)
CELERY_BEAT_SCHEDULE = {
    # 기존 태스크...
    'process-subscription-renewals': {
        'task': 'apps.business.payment.tasks.process_subscription_renewals',
        'schedule': crontab(hour=9, minute=0),  # 매일 09:00 KST
    },
}
```

### 정기결제 갱신 태스크

```python
# apps/business/payment/tasks.py

import uuid
from celery import shared_task
from django.utils import timezone

from apps.business.billing.models import ServiceSubscription
from .models import PaymentHistory, PaymentMethod
from .services.toss_service import charge_billing_key, TossPaymentError


@shared_task
def process_subscription_renewals():
    """만료된 유료 구독 자동 갱신"""
    now = timezone.now()
    due = ServiceSubscription.objects.filter(
        status='active',
        plan__price_krw__gt=0,
        expires_at__lte=now,
        is_deleted=False,
    ).select_related('user', 'plan')

    for sub in due:
        try:
            _renew(sub, now)
        except Exception as err:
            sub.status = 'past_due'
            sub.save(update_fields=['status', 'updated_at'])


def _renew(sub, now):
    pm = PaymentMethod.objects.filter(
        user=sub.user, is_active=True, is_primary=True
    ).first()
    if not pm:
        return

    order_id = f"sub_{sub.pk}_{uuid.uuid4().hex[:12]}"
    idem_key = f"renewal_{sub.pk}_{now.strftime('%Y%m')}"

    result = charge_billing_key(
        billing_key=pm.billing_key,
        customer_key=pm.customer_key,
        amount=sub.plan.price_krw,
        order_id=order_id,
        order_name=f"{sub.plan.name} 월간 구독",
        idempotency_key=idem_key,
    )

    PaymentHistory.objects.create(
        user=sub.user,
        payment_key=result["paymentKey"],
        order_id=order_id,
        order_name=f"{sub.plan.name} 월간 구독",
        amount=sub.plan.price_krw,
        payment_type=PaymentHistory.PaymentType.SUBSCRIPTION,
        status=PaymentHistory.PaymentStatus.DONE,
        toss_response=result,
        subscription=sub,
    )

    # 구독 연장
    from dateutil.relativedelta import relativedelta
    sub.expires_at = now + relativedelta(months=1)
    sub.status = 'active'
    sub.save(update_fields=['expires_at', 'status', 'updated_at'])
```

---

## 웹훅 처리

### 엔드포인트

```
POST catcident.com/api/v1/payment/webhook/toss/
```

### 서명 검증

TossPayments는 `tosspayments-webhook-signature` 헤더로 HMAC-SHA256 서명 전송.

```python
# apps/business/payment/webhooks.py

import base64
import hashlib
import hmac
import json
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .models import PaymentHistory, PaymentMethod


@csrf_exempt
@require_POST
def toss_webhook(request):
    sig_header = request.headers.get("Tosspayments-Webhook-Signature", "")
    tx_time = request.headers.get("Tosspayments-Webhook-Transmission-Time", "")

    try:
        body = request.body.decode("utf-8")
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return JsonResponse({"error": "Invalid body"}, status=400)

    if not _verify_signature(body, tx_time, sig_header):
        return JsonResponse({"error": "Invalid signature"}, status=401)

    event_type = payload.get("eventType")
    data = payload.get("data", {})

    if event_type == "PAYMENT_STATUS_CHANGED":
        _handle_payment_status(data)
    elif event_type == "BILLING_KEY_STATUS_CHANGED":
        _handle_billing_key_status(data)

    return JsonResponse({"message": "OK"})


def _handle_payment_status(data):
    """결제 승인 응답의 secret 필드와 비교하여 웹훅 검증"""
    payment_key = data.get("paymentKey")
    webhook_secret = data.get("secret", "")
    new_status = data.get("status")

    history = PaymentHistory.objects.filter(payment_key=payment_key).first()
    if not history:
        return

    # secret 검증: 결제 승인 시 DB에 저장한 값과 비교
    if history.webhook_secret:
        if not webhook_secret or not hmac.compare_digest(history.webhook_secret, webhook_secret):
            return  # 검증 실패 → 무시

    STATUS_MAP = {
        "DONE": "done", "CANCELED": "canceled",
        "PARTIAL_CANCELED": "canceled",
        "ABORTED": "failed", "EXPIRED": "failed",
    }
    if new_status in STATUS_MAP:
        history.status = STATUS_MAP[new_status]
        history.toss_response = data
        history.save(update_fields=["status", "toss_response", "updated_at"])


def _handle_billing_key_status(data):
    billing_key = data.get("billingKey")
    new_status = data.get("status")
    if new_status in ("EXPIRED", "CANCELED"):
        PaymentMethod.objects.filter(billing_key=billing_key).update(is_active=False)
```

---

## 환경 변수

### catcident-backend (Django)

```python
# settings.py
TOSS_CLIENT_KEY = env("TOSS_CLIENT_KEY")         # test_ck_... (프론트엔드용)
TOSS_SECRET_KEY = env("TOSS_SECRET_KEY")          # test_sk_... (서버 전용)
# 웹훅 검증: 결제 승인 응답의 secret 필드를 PaymentHistory에 저장하여 비교 (별도 키 불필요)
```

### narrative-studio (storygraph)

**변경 없음**. storygraph는 결제 페이지로 리다이렉트만 수행.

---

## storygraph 연동 (최소 변경)

storygraph의 `SubscriptionPage` 모달에서:

```typescript
// "업그레이드" 버튼 → catcident.com 결제 페이지로 이동
const handleUpgrade = (planId: string) => {
  window.open(
    `https://catcident.com/ko/billing/subscribe/?plan=${planId}&return_url=${encodeURIComponent(window.location.href)}`,
    '_blank'
  );
};

// "크레딧 충전" 버튼 → catcident.com 결제 페이지로 이동
const handleBuyCredits = () => {
  window.open(
    `https://catcident.com/ko/billing/checkout/?return_url=${encodeURIComponent(window.location.href)}`,
    '_blank'
  );
};
```

결제 완료 후 storygraph 탭으로 돌아오면 `loadSubscription()` 재호출로 잔액 갱신.
포커스 이벤트 또는 `return_url` 리다이렉트로 처리 가능.

---

## 에러 처리 UX

### 주요 TossPayments 에러 코드

| 코드 | 의미 | UX 대응 |
|------|------|---------|
| `REJECT_CARD_PAYMENT` | 카드 거부 | 다른 카드 사용 안내 |
| `BELOW_MINIMUM_AMOUNT` | 최소 금액 미달 (100원) | 사전 검증 |
| `EXCEED_MAX_PAYMENT_AMOUNT` | 한도 초과 | 한도 안내 |
| `ALREADY_PROCESSED_PAYMENT` | 이미 처리됨 | 성공 상태 표시 |
| `PROVIDER_ERROR` | PG사 오류 | 재시도 안내 |

### 보안 주의사항

- **금액 검증**: 서버에서 반드시 패키지/플랜 가격과 대조 (클라이언트 amount 신뢰 금지)
- **customerKey**: UUID 사용, 이메일/전화번호/순차 ID 금지
- **billingKey**: 암호화 저장, 프론트엔드 노출 금지
- **웹훅 서명**: HMAC 검증 후에만 처리
- **멱등성 키**: POST 요청에 항상 포함 (중복 결제 방지)
- **confirm 시간 제한**: successUrl 리다이렉트 후 10분 이내 confirm 호출 필수

---

## 참고 자료

- [TossPayments v2 빌링 가이드](https://docs.tosspayments.com/guides/v2/billing)
- [TossPayments v2 SDK](https://docs.tosspayments.com/sdk/v2/js)
- [TossPayments 결제 위젯](https://docs.tosspayments.com/guides/payment-widget/integration)
- [TossPayments 웹훅](https://docs.tosspayments.com/en/webhooks)
- [TossPayments 결제 취소](https://docs.tosspayments.com/guides/v2/cancel-payment)
- [@tosspayments/tosspayments-sdk (npm)](https://www.npmjs.com/package/@tosspayments/tosspayments-sdk)
