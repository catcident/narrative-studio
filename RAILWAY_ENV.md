# Railway 배포 가이드

## 아키텍처

```
[브라우저] → [Express 서버 (정적 파일 + API)] → [MongoDB]
                    ↓
              /api/* → MongoDB CRUD
              /* → dist/index.html (SPA)
```

## 필요한 환경 변수

Railway 대시보드 → Character-Relationship-Chart 서비스 → Variables 탭:

```
# MongoDB 연결 (필수)
MONGO_URL=mongodb://mongo:UgweaQtCWVnKyOqqckQYVjcAWxlyjkpP@mongodb.railway.internal:27017

# OpenRouter API (필수)
OPENROUTER_API_KEY=sk-or-v1-xxxxx
```

## 빌드 & 시작 명령어

Railway 대시보드 → Settings 탭:

- **Build Command**: `npm run build`
- **Start Command**: `npm start`

## 로컬 개발

```bash
cd demo

# 환경 변수 설정 (.env 파일)
# MONGO_URL=mongodb://localhost:27017
# 또는 Railway Public URL 사용

# 개발 서버 실행 (클라이언트 + API 서버 동시 실행)
npm run dev

# 클라이언트: http://localhost:3002
# API 서버: http://localhost:3001
```

## API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/health | 헬스 체크 |
| GET | /api/knowledge-graphs | 목록 조회 |
| GET | /api/knowledge-graphs/:id | 단일 조회 |
| POST | /api/knowledge-graphs | 저장 (신규/업데이트) |
| DELETE | /api/knowledge-graphs/:id | 삭제 |
| GET | /api/knowledge-graphs/:id/versions | 버전 히스토리 |
| POST | /api/knowledge-graphs/:id/restore/:version | 버전 복원 |

## 데이터베이스 구조

### Collections

1. **knowledgeGraphs** - 지식 그래프 데이터
   - title: 소설 제목
   - data: NovelKnowledgeGraph 객체
   - version: 버전 번호
   - entityCount, edgeCount, sceneCount
   - createdAt, updatedAt

2. **knowledgeGraphVersions** - 버전 히스토리
   - knowledgeGraphId: 참조
   - version: 버전 번호
   - data: 해당 버전의 데이터
   - createdAt
   - 최근 10개만 유지

## 문제 해결

### MongoDB 연결 실패
- `MONGO_URL` 환경 변수 확인
- Railway 내부 네트워크 사용 시 `mongodb.railway.internal` 도메인 사용

### API 호출 실패
- 브라우저 콘솔에서 네트워크 탭 확인
- `/api/health` 엔드포인트로 서버 상태 확인
