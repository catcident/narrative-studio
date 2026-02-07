# 기능 문서

소설 인물 관계도 앱의 주요 기능 문서입니다.

## 목차

| 문서 | 설명 |
|------|------|
| [extraction-pipeline.md](extraction-pipeline.md) | 텍스트 분석 파이프라인 |
| [file-management.md](file-management.md) | 파일 추가/삭제/순서 변경 |
| [knowledge-graph-structure.md](knowledge-graph-structure.md) | 지식 그래프 데이터 구조 |
| [chat.md](chat.md) | AI 채팅 기능 |
| [storage.md](storage.md) | 저장소 및 동기화 |
| [validation.md](validation.md) | 파일 일관성 검증 |

## 주요 흐름

### 1. 소설 분석 흐름

```
파일 업로드 → 텍스트 추출 → 청크 분할 → LLM 분석 → 결과 병합 → 지식 그래프 생성 → 저장
```

**관련 문서**: [extraction-pipeline.md](extraction-pipeline.md)

### 2. 파일 관리 흐름

```
파일 추가: 파일 읽기 → 중복 체크 → 분석 → 기존 그래프에 병합
파일 삭제: 관련 장면 삭제 → 엔티티/관계 정리 → 파일 ID 재정렬
파일 순서 변경: 장면 order 재계산 → chapterNumber 업데이트 → 참조 업데이트
```

**관련 문서**: [file-management.md](file-management.md)

### 3. 데이터 구조

```
NovelKnowledgeGraph
├── metadata (제목, 모델, 소스파일)
├── entities (인물, 장소, 아이템, 개념)
├── hyperedges (관계)
├── snapshots (장면)
├── chapters (장/화)
└── stats (통계)
```

**관련 문서**: [knowledge-graph-structure.md](knowledge-graph-structure.md)

### 4. 채팅 흐름

```
질문 입력 → 의도 분석 → 데이터 검색 → LLM 선별 → 컨텍스트 생성 → 스트리밍 응답
```

**관련 문서**: [chat.md](chat.md)

### 5. 저장 흐름

```
저장 요청 → 서버 API → MongoDB 저장
```

**관련 문서**: [storage.md](storage.md)

## 핵심 컴포넌트

### 서비스 레이어

| 파일 | 설명 |
|------|------|
| `services/extraction/orchestrator.ts` | 분석 흐름 제어 |
| `services/extraction/chunker.ts` | 텍스트 청크 분할 |
| `services/extraction/extractor.ts` | LLM 추출 |
| `services/extraction/merger.ts` | 결과 병합 |
| `services/chat.ts` | 채팅 서비스 |
| `services/storage.ts` | 저장소 통합 |

### UI 컴포넌트

| 파일 | 설명 |
|------|------|
| `components/FileUpload.tsx` | 파일 업로드 |
| `components/SourceTextView.tsx` | 파일 목록 관리 |
| `components/RelationshipGraph.tsx` | 관계도 시각화 |
| `components/ChatView.tsx` | 채팅 인터페이스 |
| `components/SceneTimeline.tsx` | 타임라인 뷰 |

## ID 체계

| 타입 | 형식 | 예시 |
|------|------|------|
| 엔티티 | E0001 | E0001, E0042 |
| 관계 | H0001 | H0001, H0023 |
| 장면 | S0001 | S0001, S0015 |
| 파일 | F0001 | F0001, F0002 |
| 챕터 | C0001 | C0001, C0005 |
## 기술 스택

| 기술 | 용도 |
|------|------|
| Next.js 15 | 프레임워크 |
| React 19 | UI |
| TypeScript | 타입 시스템 |
| Zustand | 상태 관리 |
| @xyflow/react | 그래프 시각화 |
| MongoDB | 서버 저장소 |
| OpenRouter API | LLM 분석 |
