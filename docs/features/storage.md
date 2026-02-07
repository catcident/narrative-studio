# 저장소

지식 그래프 데이터의 저장, 로드, 버전 관리 기능입니다.

## 파일 구조

```
web/src/
├── services/storage.ts           # 저장소 통합 API
├── app/api/knowledge-graphs/     # 서버 API
│   ├── route.ts                  # 목록/저장
│   └── [id]/
│       ├── route.ts              # 조회/수정/삭제
│       ├── versions/route.ts     # 버전 히스토리
│       └── restore/[version]/route.ts  # 버전 복원
└── lib/mongodb.ts                # MongoDB 연결
```

## 1. 아키텍처 (서버 전용)

서버 API를 통해 MongoDB에 저장. 서버 실패 시 에러 반환 또는 빈 결과.

### 서버 실패 시 동작

| 함수 | 서버 실패 시 |
|------|------------|
| `getSavedKnowledgeGraphList` | `[]` 반환 |
| `loadKnowledgeGraph` | `null` 반환 |
| `saveKnowledgeGraph` | **throw** (데이터 유실 방지) |
| `saveNovelText` | **throw** (데이터 유실 방지) |
| `updateKnowledgeGraph` | `false` 반환 |
| `deleteKnowledgeGraph` | `false` 반환 |
| `getVersionHistory` | `[]` 반환 |
| `restoreVersion` | `null` 반환 |

## 2. 데이터 구조

### SavedKnowledgeGraphMeta (목록용)

```typescript
interface SavedKnowledgeGraphMeta {
  id: string;
  title: string;
  savedAt: string;
  updatedAt: string;
  version: number;
  entityCount: number;
  edgeCount: number;
  sceneCount: number;
  model?: string;        // 분석에 사용된 LLM 모델
}
```

### KnowledgeGraphVersion

```typescript
interface KnowledgeGraphVersion {
  version: number;
  savedAt: string;
  note?: string;
  data: NovelKnowledgeGraph;
}
```

## 3. 클라이언트 API

### getSavedKnowledgeGraphList()

저장된 모든 지식 그래프 목록을 가져옵니다.

```typescript
const list = await getSavedKnowledgeGraphList();
// [{ id, title, savedAt, updatedAt, version, entityCount, edgeCount, sceneCount, model }]
```

### loadKnowledgeGraph(id)

특정 지식 그래프를 불러옵니다.

```typescript
const graph = await loadKnowledgeGraph('507f1f77bcf86cd799439011');
```

### saveKnowledgeGraph(graph, novelId?, existingId?)

지식 그래프를 저장합니다. 서버가 세션에서 userId를 추출합니다.

```typescript
const meta = await saveKnowledgeGraph(
  knowledgeGraph,
  novelId,        // 연결된 소설 ID (선택)
  existingId      // 기존 데이터 ID (업데이트 시)
);
```

### updateKnowledgeGraph(id, graph)

기존 지식 그래프를 부분 업데이트합니다.

```typescript
const success = await updateKnowledgeGraph(id, updatedGraph);
```

### deleteKnowledgeGraph(id)

지식 그래프를 삭제합니다.

```typescript
const success = await deleteKnowledgeGraph(id);
```

## 4. 버전 관리

### 버전 생성 시점

- 기존 데이터 업데이트 시 이전 버전을 자동 저장
- 버전 번호는 1부터 증가

### getVersionHistory(dataId)

버전 히스토리를 조회합니다.

```typescript
const versions = await getVersionHistory(dataId);
// [{ version: 3, savedAt, note }, { version: 2, savedAt, note }, ...]
```

### restoreVersion(dataId, version)

특정 버전으로 복원합니다.

```typescript
const restored = await restoreVersion(dataId, 2);
// 버전 2의 NovelKnowledgeGraph 반환
```

## 5. 서버 API

### GET /api/knowledge-graphs

목록 조회

```
Response: SavedKnowledgeGraphMeta[]
```

### POST /api/knowledge-graphs

새로 저장 또는 업데이트

```typescript
// Request
{
  knowledgeGraph: NovelKnowledgeGraph;
  novelId?: string;
  existingId?: string;
}

// Response
SavedKnowledgeGraphMeta
```

### GET /api/knowledge-graphs/[id]

개별 조회

```
Response: NovelKnowledgeGraph
```

### PUT /api/knowledge-graphs/[id]

부분 업데이트

```typescript
// Request
{ knowledgeGraph: NovelKnowledgeGraph }

// Response
{ success: boolean }
```

### DELETE /api/knowledge-graphs/[id]

삭제

```
Response: { success: boolean }
```

### GET /api/knowledge-graphs/[id]/versions

버전 히스토리

```
Response: Array<{ version, savedAt, note }>
```

### POST /api/knowledge-graphs/[id]/restore/[version]

버전 복원

```
Response: NovelKnowledgeGraph
```

## 6. 소설 원본 저장

### saveNovelText(title, text, knowledgeGraphId?)

```typescript
const { id, title } = await saveNovelText(
  '나의 소설',
  '소설 텍스트...',
  knowledgeGraphId
);
```

### loadNovelText(id)

```typescript
const novel = await loadNovelText(id);
// { title, text }
```

### getNovelList()

```typescript
const novels = await getNovelList();
// [{ id, title, textLength, savedAt, knowledgeGraphId }]
```

## 7. 내보내기/가져오기

### exportKnowledgeGraph(data)

JSON 파일로 다운로드합니다.

```typescript
exportKnowledgeGraph(knowledgeGraph);
// "{제목}_knowledge_graph.json" 다운로드
```

### importKnowledgeGraph(file)

JSON 파일에서 가져옵니다.

```typescript
const imported = await importKnowledgeGraph(file);
// NovelKnowledgeGraph 반환
```

### 유효성 검사

```typescript
if (!data.metadata || !data.entities || !data.hyperedges) {
  throw new Error('유효하지 않은 데이터 파일입니다.');
}
```

## 8. 에러 처리

### 로그 패턴

```
[storage] 서버 목록 조회 실패: Error
[storage] 서버 로드 실패: Error
[storage] 서버 업데이트 실패: Error
[storage] 서버 삭제 실패: Error
```

## 9. 시퀀스 다이어그램

### 저장 흐름

```
App          storage.ts        Server API        MongoDB
 |               |                  |               |
 |--저장 요청--->|                  |               |
 |               |--POST----------->|               |
 |               |                  |--저장-------->|
 |               |                  |<--성공--------|
 |               |<--SavedMeta-----|               |
 |<--완료--------|                  |               |
```

## 10. 주의사항

1. **버전 충돌**: 동시 편집 시 버전 히스토리로 복구 가능
2. **인증 모드**: `AUTH_ENABLED=false` 시 `userId='anonymous'`로 공유 네임스페이스
