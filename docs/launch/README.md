# StoryGraph 서비스 런칭 계획

> 2026-02-09 작성 | narrative-studio를 storygraph.catcident.com으로 공개 서비스 런칭하기 위한 종합 계획

## 문서 구조

| 문서 | 내용 |
|------|------|
| [01-현황분석.md](01-현황분석.md) | catcident.com, storygraph 현재 상태 및 기술 스택 분석 |
| [02-브랜딩-전략.md](02-브랜딩-전략.md) | 브랜드 아키텍처, 네이밍, 비주얼 아이덴티티 |
| [03-네비게이션-연동.md](03-네비게이션-연동.md) | catcident.com ↔ storygraph 양방향 네비게이션 설계 |
| [04-랜딩페이지.md](04-랜딩페이지.md) | 랜딩 페이지 구조, 섹션 설계, CTA 전략 |
| [05-결제시스템-TossPayments.md](05-결제시스템-TossPayments.md) | TossPayments 연동 아키텍처, API, 코드 예시 |
| [06-런칭-체크리스트.md](06-런칭-체크리스트.md) | 런칭 전 필수 항목 및 실행 로드맵 |
| [07-SaaS-리서치.md](07-SaaS-리서치.md) | 업계 사례 분석 (Vercel, GitHub, Atlassian, 뤼튼 등) |
| [USER_ACTIONS.md](USER_ACTIONS.md) | 사용자 직접 작업 목록 (환경 변수, 마이그레이션, 법적 문서 등) |

## 핵심 결정 사항 요약

| 항목 | 결정 |
|------|------|
| **도메인** | `storygraph.catcident.com` (서브도메인 유지) |
| **브랜드 모델** | Endorsed Brand — "스토리그래프 by 고양이의 만행" |
| **결제** | TossPayments → catcident-backend에서 처리, storygraph는 리다이렉트만 |
| **랜딩 페이지** | storygraph.catcident.com/ (미로그인 시 표시) |
| **과금 모델** | 크레딧 기반 (기존 hold/settle/release 패턴 유지) |

## 실행 순서

1. 브랜딩 적용 (로고, "by 고양이의 만행" 배지)
2. 랜딩 페이지 구현
3. catcident.com 네비게이션 연동
4. TossPayments 일회성 결제 (크레딧 패키지)
5. 이용약관 + SEO 기본 설정
6. 프로덕션 배포 + 모니터링
7. TossPayments 정기결제 (플랜 구독)
