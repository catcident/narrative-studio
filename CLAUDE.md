# Character-Relationship-Chart

AI가 소설을 분석하여 인물 관계도를 자동으로 생성하는 웹 애플리케이션

## 빠른 참조

```bash
# 개발 서버 (web 디렉토리에서)
cd web && npm run dev

# 프로덕션 빌드
cd web && npm run build && npm run start

# Docker 빌드 및 실행
cd web && docker build -t storygraph . && docker run -p 3000:3000 storygraph
```

## 프로젝트 구조

```
Character-Relationship-Chart/
├── web/                     # Next.js 웹 애플리케이션 (메인)
│   ├── src/
│   │   ├── app/            # Next.js App Router
│   │   │   ├── api/        # API 라우트
│   │   │   ├── login/      # 로그인 페이지
│   │   │   └── page.tsx    # 메인 페이지
│   │   ├── components/     # React 컴포넌트
│   │   ├── services/       # 비즈니스 로직
│   │   ├── lib/            # 유틸리티 (DB, Auth)
│   │   ├── store.ts        # Zustand 상태 관리
│   │   └── types.ts        # TypeScript 타입 정의
│   ├── Dockerfile          # 프로덕션 Docker 이미지
│   └── CLAUDE.md           # 웹 앱 상세 문서
├── src/                     # 핵심 라이브러리 (향후 확장용)
├── docs/                    # 문서
│   ├── FEATURES.md         # 기능 상세 설명
│   └── KNOWLEDGE_GRAPH.md  # 지식 그래프 구조 설명
└── README.md
```

> **참고**: `src/` 디렉토리는 향후 공유 라이브러리용으로 예약됨. 현재 모든 구현은 `web/`에 있음.

## 기술 스택

| 기술 | 용도 |
|------|------|
| Next.js 15 | 프레임워크 (App Router) |
| React 19 | UI 라이브러리 |
| TypeScript 5.9 | 타입 시스템 |
| Tailwind CSS 4 | 스타일링 |
| @xyflow/react | 관계도 그래프 시각화 |
| Zustand | 클라이언트 상태 관리 |
| MongoDB | 서버 데이터 저장소 |
| NextAuth.js 5 | 인증 (OAuth/OIDC) |
| pdfjs-dist | PDF 파일 처리 |
| OpenRouter API | AI 분석 (LLM 프록시) |

## 환경 변수

### 필수

| 변수 | 설명 |
|------|------|
| `OPENROUTER_API_KEY` | OpenRouter API 키 (AI 분석용) |
| `MONGO_URL` | MongoDB 연결 문자열 |

### 선택 (인증 활성화 시 필수)

| 변수 | 설명 |
|------|------|
| `AUTH_ENABLED` | 기본 활성. `false`로 명시적 비활성화 |
| `AUTH_SECRET` | NextAuth.js 비밀 키 |
| `AUTH_URL` | 앱 URL (예: `https://storygraph.catcident.com`) |
| `AUTH_CATCIDENT_ISSUER` | Catcident OAuth issuer URL |
| `AUTH_CATCIDENT_ID` | OAuth 클라이언트 ID |
| `AUTH_CATCIDENT_SECRET` | OAuth 클라이언트 시크릿 |

## API 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/analyze` | POST | AI 분석 요청 (OpenRouter 프록시) |
| `/api/knowledge-graphs` | GET, POST | 지식 그래프 목록/저장 |
| `/api/knowledge-graphs/[id]` | GET, DELETE | 개별 그래프 조회/삭제 |
| `/api/knowledge-graphs/[id]/versions` | GET | 버전 히스토리 |
| `/api/knowledge-graphs/[id]/restore/[version]` | POST | 버전 복원 |
| `/api/novels` | GET, POST | 소설 원본 목록/저장 |
| `/api/novels/[id]` | GET | 소설 원본 조회 |

## 주요 패턴

### 스토리지 (Dual Layer)
1. **서버 API (MongoDB)** - 우선 시도
2. **IndexedDB** - API 실패 시 폴백

로컬 ID는 `kg_` 접두사로 구분됨.

### AI 분석 흐름
1. 텍스트를 5,000자 청크로 분할
2. 각 청크를 순차 분석 (이전 인물 컨텍스트 전달)
3. 결과 병합 + 관계 추론
4. 지식 그래프 구조화

### 인증 모드
- 기본값 (미설정 또는 `true`): Catcident OAuth 인증 필수
- `AUTH_ENABLED=false`: 익명 모드 (userId='anonymous', Railway 데모용)

## 배포

### Railway (테스트)
- `main` 브랜치 자동 배포
- `AUTH_ENABLED=false` (공개 데모)

### Oracle Cloud (프로덕션)
- Docker + Caddy 리버스 프록시
- `AUTH_ENABLED=true` (회원 전용)
- `storygraph.catcident.com` 도메인

## 앱별 문서

- [web/CLAUDE.md](web/CLAUDE.md) - Next.js 웹 앱 상세
- [web/src/services/CLAUDE.md](web/src/services/CLAUDE.md) - 서비스 레이어
- [web/src/components/CLAUDE.md](web/src/components/CLAUDE.md) - UI 컴포넌트
- [web/src/lib/CLAUDE.md](web/src/lib/CLAUDE.md) - 유틸리티 모듈
