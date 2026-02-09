# 07. SaaS 서비스 런칭 리서치

> 업계 사례 분석 — 네비게이션, 브랜딩, 랜딩 페이지, 가격 정책

## 1. 네비게이션 아키텍처 패턴

### 주요 SaaS 네비게이션 분석

#### Vercel (vercel.com)

"Products" 메가 드롭다운으로 서브 프로덕트 조직화:

| AI Cloud | Core Platform | Security |
|----------|--------------|----------|
| v0 | CI/CD | Bot Management |
| AI SDK | Content Delivery | BotID |
| AI Gateway | Fluid Compute | Platform Security |
| Vercel Agent | Observability | Web Application Firewall |

- 각 서브 프로덕트: **이름 + 한 줄 설명** + 고유 아이콘
- 기능별 그룹화 (중요도 아님)
- v0은 별도 도메인 (v0.dev)이나 vercel.com에서 눈에 띄게 링크
- 메인 네비 5개만: Products, Resources, Solutions, Enterprise, Pricing

#### GitHub (github.com)

"Platform" 메가 드롭다운:

| AI Code Creation | Developer Workflows | Application Security | Explore |
|-----------------|-------------------|---------------------|---------|
| GitHub Copilot | Actions | Advanced Security | Why GitHub |
| GitHub Spark | Codespaces | Code security | Documentation |
| GitHub Models | Issues | Secret protection | Blog |
| MCP Registry (New) | Code Review | | Changelog |

- **"GitHub [Name]"** 네이밍 컨벤션 (GitHub Copilot, GitHub Spark 등)
- 신규 프로덕트에 **"New" 배지** (MCP Registry)
- Hero에 듀얼 CTA: "Sign up for GitHub" + "Try GitHub Copilot free"
- 드롭다운 하단 "View all features" 탈출구

#### Notion (notion.so)

- "Product" 드롭다운: Notion AI, Notion Calendar, Notion Sites, Notion Mail
- **"Notion [기능명]"** 패턴
- 단일 도메인 (notion.so/product/...)
- 이전 독립 프로덕트(Cron) → 인수 후 "Notion Calendar"로 리브랜딩

#### Atlassian (atlassian.com)

- **Endorsed Brand**: "Jira by Atlassian", "Confluence by Atlassian"
- 각 프로덕트 고유 비주얼 (Jira=파랑, Confluence=청록)
- 공유 **Atlassian Design System**으로 UX 일관성
- 앱 내 **유니버설 프로덕트 스위처** (와플 아이콘)
- 마케팅 사이트: `/software` 페이지에 전체 프로덕트 목록

### 네비게이션 아키텍처 3가지 패턴

| 패턴 | 사례 | 최적 상황 |
|------|------|----------|
| **메가 드롭다운** | Vercel, GitHub | 5-15개 프로덕트, 동일 오디언스 |
| **별도 도메인 + 크로스 링킹** | Atlassian, Google | 다른 오디언스, 독립 운영 |
| **단일 도메인 + 프로덕트 탭** | Notion | 긴밀하게 통합된 프로덕트 |

### 도메인 아키텍처 비교

| 방식 | 예시 | 장점 | 단점 |
|------|------|------|------|
| 서브도메인 | storygraph.catcident.com | 독립 배포, CDN 분리 용이 | 별도 인증 필요 |
| 경로 | catcident.com/storygraph | 인증/쿠키 공유 | 결합도 높음, 독립 확장 어려움 |
| 별도 도메인 | storygraph.io | 최대 브랜드 독립성 | 모 브랜드 SEO 혜택 없음 |

---

## 2. 랜딩 페이지 트렌드 (2025-2026)

### Hero 섹션 패턴

2026년 AI 도구 랜딩 페이지의 지배적 패턴:

1. **결과 중심 헤드라인**: 기술이 아닌 사용자 결과 강조
   - (O) "AI가 소설을 읽고 인물 관계도를 그려드립니다"
   - (X) "AI 기반 지식 그래프 추출 엔진"

2. **듀얼 CTA**: 주 액션 + 보조 액션
   - CTA가 3개 이상이면 전환율 266% 감소 (B12 리서치)

3. **Product-first 비주얼**: 추상 일러스트 대신 실제 제품 스크린샷
   - 2026 트렌드: "제품 결과물을 먼저 보여줘라"

4. **동영상/애니메이션**: SaaS 랜딩에 영상 포함 시 전환율 86% 증가

### CTA 배치 전략 (2026)

| 위치 | 목적 |
|------|------|
| Hero (above fold) | 주 전환 포인트 |
| 각 주요 섹션 후 | 가치 입증 후 맥락적 전환 |
| Sticky 헤더/푸터 | 스크롤 중 항상 노출 (특히 모바일) |
| 페이지 하단 | 마지막 포착 |

**CTA 텍스트 원칙**:
- 1인칭: "내 소설 분석하기" (O), "분석 시작" (X)
- 구체적: "무료로 시작하기" (O), "더 알아보기" (X)
- 제네릭 금지: "Submit", "Learn More" 회피

### 신뢰 지표 (AI 도구)

AI 도구의 신뢰 지표는 두 가지 우려를 해소해야 함:
- "AI가 잘 작동하는가?" → 사용 지표, before/after 예시
- "내 데이터는 안전한가?" → 데이터 프라이버시 보장

효과적인 신뢰 지표:
1. 사용 메트릭: "X건 분석 완료", "Y명 사용자"
2. 출력 품질 예시: 원본 텍스트 → 관계도 변환
3. AI 모델 투명성: 어떤 모델 사용하는지
4. 데이터 보안: "소설 원본은 암호화 저장"
5. 모 브랜드 보증: "고양이의 만행 서비스"

---

## 3. 브랜드 아키텍처 모델

### 모델 비교

| 모델 | 패턴 | 사례 | 적합 상황 |
|------|------|------|----------|
| **Branded House** | "모 브랜드 + 서비스" | Google Docs, Apple Music | 모 브랜드 신뢰가 핵심 |
| **Endorsed Brand** | "서비스 by 모 브랜드" | Jira by Atlassian | 독립 성장 + 모 브랜드 신뢰 |
| **Sub-brand** | "모 브랜드 + 서비스" (차별 스타일) | Notion AI | 긴밀 통합 + 고유 정체성 |
| **Independent** | 완전 독립 | WhatsApp (by Meta) | 완전 별도 오디언스 |

### 업계 네이밍 패턴

| 회사 | 패턴 | 예시 |
|------|------|------|
| Google | 모 + 일반명 | Google Docs, Drive, Maps |
| GitHub | 모 + 설명명 | GitHub Copilot, Actions, Spark |
| Notion | 모 + 일반명 | Notion AI, Calendar, Sites |
| Atlassian | 독립 + "by 모" | Jira, Confluence, Trello |
| Vercel | 완전 독립 | v0, Turborepo |
| Apple | 모 + 일반명 | Apple Music, TV+, Pay |
| 뤼튼 | 독립 (생태계) | 크랙 (Crack) |

---

## 4. 한국 SaaS/AI 시장 분석

### 뤼튼 (Wrtn) 사례

- **모 회사**: WRTN Technologies (wrtn.io) — 기업 사이트
- **소비자 프로덕트**: wrtn.ai — 메인 AI 서비스
- **서브 프로덕트**: 크랙 (Crack) — 캐릭터 챗, 주 수익원
- **가격 전략**: 핵심 AI 서비스 **완전 무료** → 유료 서브 프로덕트로 수익화
- **신뢰 지표**: "3억 7천만+ 사용자" 강조

### 한국 AI 서비스 공통 패턴

1. **무료 핵심 + 유료 프리미엄**: 한국 사용자는 넉넉한 무료 티어 기대
2. **한국어 우선 UX**: 전체 한국어 인터페이스, 한국어 최적화 예시
3. **모바일 우선**: 카카오톡 연동, 앱 우선 설계
4. **볼륨으로 신뢰**: 사용자 수, 분석 건수 적극 노출
5. **한국 플랫폼 연동**: 네이버, 카카오 생태계

### 한국 SaaS 가격 페이지 관례

- 월 결제가 표준 (미국처럼 연간 우선이 아님)
- KRW 표시, VAT 포함 가격
- 무료 티어 기대치 높음 — "무료"가 가장 강력한 키워드
- 크레딧 기반 모델 글로벌 트렌드 따라 확산 중
- 2025년 크레딧 기반 가격 모델 YoY 126% 증가 (Growth Unhinged)

### 한국 AI SaaS 레퍼런스

| 서비스 | 카테고리 | 가격 모델 | 랜딩 패턴 |
|--------|----------|----------|----------|
| 뤼튼 (Wrtn) | 범용 AI | 무료 + 유료 서브 | 미니멀 Hero, 프로덕트 퍼스트 |
| 클로바노트 | 회의 녹음 | 프리미엄 (분 기반) | 기능 중심, 데모 영상 |
| 크랙 (Crack) | AI 캐릭터 챗 | 구독 | 모 서비스 내 임베딩 |
| ALI (Upstage) | 문서 AI | API 크레딧 | 개발자 중심, 문서 우선 |
| 리턴제로 | 음성 AI | 사용량 기반 | B2B 엔터프라이즈 |

---

## 5. 서브도메인 아키텍처 베스트 프랙티스

### 마케팅 vs 프로덕트 분리

- 서브도메인은 마케팅 사이트와 프로덕트 앱 분리에 최적
- CDN 분리, 트래픽 분리, 도메인별 보안 설정 가능
- DNS 레벨 라우팅으로 리버스 프록시보다 단순

### 테넌트 격리

- 서브도메인 기반 테넌트 격리가 경로 기반보다 우수
- 커스텀 도메인 지원 시 서브도메인이 필수
- 경로 기반은 모든 라우트에서 테넌트 검증 필요 → 보안 복잡성

### OAuth 고려사항

- 서드파티 OAuth 통합 시 단일 서브도메인 + 경로 기반이 더 단순
- 하지만 별도 마이크로서비스라면 서브도메인이 DNS 레벨 라우팅으로 더 유리

---

## 참고 자료

### 네비게이션/UX
- [Pencil & Paper — Navigation UX Best Practices](https://www.pencilandpaper.io/articles/ux-pattern-analysis-navigation)
- [Nerd Cow — SaaS Navigation for Complex Products](https://nerdcow.co.uk/blog/website-navigation-for-a-complex-saas-product-structure/)

### 랜딩 페이지
- [SaaSFrame — 10 Landing Page Trends for 2026](https://www.saasframe.io/blog/10-saas-landing-page-trends-for-2026-with-real-examples)
- [Fibr.ai — 20 Best SaaS Landing Pages](https://fibr.ai/landing-page/saas-landing-pages)
- [LandingPageFlow — CTA Placement Strategies 2026](https://www.landingpageflow.com/post/best-cta-placement-strategies-for-landing-pages)
- [Prismic — Hero Section Best Practices](https://prismic.io/blog/website-hero-section)
- [B12 — Landing Page Conversion Factors 2026](https://www.b12.io/resource-center/website-conversions/things-to-add-to-your-landing-page-for-more-conversions-2026/)
- [Grooic — AI SaaS Landing Page Examples 2026](https://grooic.com/blog/best-ai-saas-landing-page-examples)

### 가격 정책
- [Growth Unhinged — 2025 State of SaaS Pricing](https://www.growthunhinged.com/p/2025-state-of-saas-pricing-changes)
- [Monetizely — 2026 Guide to SaaS/AI Pricing Models](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models)

### 브랜딩
- [BrandStruck — Sub-brands vs Endorsed Brands](https://brandstruck.co/blog_post/brand-architecture-part-2-difference-sub-brands-endorsed-brands/)
- [Ramotion — Sub-Branding Guide](https://www.ramotion.com/blog/sub-branding/)
- [Phase3 — Understanding Sub-Brands](https://www.phase3mc.com/thinking/understanding-the-importance-of-sub-brands)
- [TBH Creative — Endorser Brand Architecture](https://www.tbhcreative.com/blog/endorser-brand/)
- [Atlassian Design System](https://atlassian.design/)

### 도메인 구조
- [GHinda — Domain Structure for SaaS Products](https://ghinda.com/blog/products/2020/domain-structure-for-saas-products.html)
- [Serverless First — Subdomain Structure Guide](https://serverlessfirst.com/how-to-select-a-future-proof-subdomain-structure-for-saas-web-app/)

### 한국 시장
- [WRTN Technologies](https://wrtn.io/en/)
- [NIPA/MSIT 2025 SaaS 지원 프로그램](https://www.nipa.kr/home/2-2/15864)
