# 사용자 직접 작업 목록

> 코드 구현 완료 후 사용자가 직접 수행해야 하는 작업. 순서대로 진행 권장.

## 즉시 필요 (코드 실행 전)

### H1. Django 마이그레이션 실행

catcident-backend에서 payment 앱의 DB 마이그레이션 생성 및 적용.

```bash
cd /path/to/catcident-backend
python manage.py makemigrations payment
python manage.py migrate
```

### H2. TossPayments 환경 변수 설정

catcident-backend `.env.local`에 추가:

```bash
TOSS_CLIENT_KEY=test_ck_...      # TossPayments 테스트 클라이언트 키
TOSS_SECRET_KEY=test_sk_...      # TossPayments 테스트 시크릿 키
TOSS_WEBHOOK_SECRET=whsec_...    # 웹훅 시크릿 (TossPayments 대시보드에서 발급)
```

### H3. Sentry DSN 설정

storygraph `.env.local`에 추가:

```bash
NEXT_PUBLIC_SENTRY_DSN=https://xxx@yyy.ingest.sentry.io/zzz
```

Sentry 프로젝트 생성: https://sentry.io → Create Project → Next.js 선택

---

## 테스트 환경 확인 후

### H4. 웹훅 URL 등록

TossPayments 대시보드 → 개발자 센터 → 웹훅 설정:
- URL: `https://catcident.com/api/v1/payment/webhook/toss/`
- 이벤트: `PAYMENT_STATUS_CHANGED`, `BILLING_KEY_STATUS_CHANGED`

### H5. CMS 네비게이션 데이터 입력

Django Admin (`cms.catcident.com`)에서:
1. **NavigationGroup** "서비스" 생성 (order=2, 타입: 드롭다운)
2. **NavigationSubMenu** "스토리그래프 - AI 인물 관계도" → `https://storygraph.catcident.com`
3. **FooterSubMenu** "스토리그래프" → 서비스 섹션에 추가
4. **FamilySite** "스토리그래프" 추가

---

## 런칭 전 필수

### H6. 법적 문서 작성/업데이트

- [ ] **이용약관**: 스토리그래프 서비스 조항 추가 (AI 분석, 크레딧 시스템, 저작권 면책)
- [ ] **개인정보처리방침**: AI 분석 데이터 수집/처리/보관, 소설 원본 MongoDB 저장 관련
- [ ] **결제/환불 정책**: TossPayments 연동, 크레딧 환불 조건, 구독 해지 조건

### H7. 프로덕션 배포 준비

1. **Docker 빌드 확인**
   ```bash
   cd web && docker build -t storygraph .
   ```
2. **프로덕션 환경 변수 설정** (서버에서)
   - `NEXT_PUBLIC_SENTRY_DSN` 프로덕션 DSN
   - TossPayments 라이브 키로 전환 (H8 심사 통과 후)
3. **Caddy 리버스 프록시 확인**
   - `storygraph.catcident.com` → Next.js 컨테이너
4. **스모크 테스트 실행** → [06-런칭-체크리스트.md](06-런칭-체크리스트.md) 참조

### H8. TossPayments 심사 제출

테스트 환경에서 실결제 흐름 확인 후:
1. TossPayments 대시보드 → 심사 신청
2. 필요 정보: 사업자등록증, 서비스 URL, 결제 흐름 설명
3. 심사 통과 후 라이브 키(`live_ck_...`, `live_sk_...`) 발급
4. 환경 변수 전환

---

## 런칭 후 (후속)

### H9. 랜딩 페이지 스크린샷 교체

현재 플레이스홀더 이미지 사용 중. 실제 서비스 캡처로 교체:
- Hero 섹션: 관계도 그래프 스크린샷
- Features 섹션: 각 기능별 실제 화면
- ChatShowcase 섹션: 실제 채팅 대화 예시

### H10. 업타임 모니터링 설정

healthcheck 엔드포인트: `https://storygraph.catcident.com/api/config`
- UptimeRobot, Better Uptime 등 외부 서비스 연동

### H11. 결제 실패 재시도 + 이메일 알림

정기결제 갱신 실패 시 이메일 알림 기능 (Phase 4-4). 현재 로깅만 구현됨.
