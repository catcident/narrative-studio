# 저장소 및 동기화

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

## 1. 아키텍처 (Dual Layer)

```
클라이언트 요청
      ↓
서버 API (MongoDB) ← 1차 시도
      ↓ 실패 시
로컬 IndexedDB ← 폴백
```

### 저장소 구분

| 저장소 | ID 형식 | 용도 |
|--------|---------|------|
| 서버 (MongoDB) | ObjectId | 기본 저장소 |
| 로컬 (IndexedDB) | `kg_` 접두사 | 폴백/오프라인 |

## 2. 데이터 구조

### SavedKnowledgeGraph

```typescript
interface SavedKnowledgeGraph {
  id: string;
  title: string;
  savedAt: string;       // 최초 저장 시간
  updatedAt: string;     // 최종 수정 시간
  version: number;       // 버전 번호
  data: NovelKnowledgeGraph;
  entityCount: number;
  edgeCount: number;
  sceneCount: number;
}
```

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

## 3. 통합 API

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
// 또는
const localGraph = await loadKnowledgeGraph('kg_1234567890_abc123');
```

### saveKnowledgeGraph(graph, novelId?, userId?, existingId?)

지식 그래프를 저장합니다.

```typescript
const meta = await saveKnowledgeGraph(
  knowledgeGraph,
  novelId,        // 연결된 소설 ID (선택)
  userId,         // 사용자 ID (선택)
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
  userId?: string;
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

## 6. 로컬 IndexedDB

### 데이터베이스 구조

```
character-relationship-db
├── knowledgeGraphs (keyPath: id)
└── versions (keyPath: [dataId, version])
    └── index: dataId
```

### 주요 함수

| 함수 | 설명 |
|------|------|
| `openDB()` | DB 연결 및 스키마 생성 |
| `getLocalList()` | 목록 조회 |
| `loadLocal(id)` | 개별 로드 |
| `saveLocal(graph, existingId?)` | 저장 |
| `updateLocal(id, graph)` | 업데이트 |
| `deleteLocal(id)` | 삭제 |
| `getLocalVersionHistory(dataId)` | 버전 히스토리 |
| `restoreLocalVersion(dataId, version)` | 버전 복원 |

### 기존 데이터 매칭 로직

```typescript
// 1. ID로 직접 찾기
if (existingId) {
  existing = await store.get(existingId);
}

// 2. 제목의 첫 부분으로 찾기 (하위 호환)
if (!existing) {
  const baseTitle = title.split(' + ')[0]; // "01화 + 02화" -> "01화"
  existing = allItems.find(o => {
    const existingBaseTitle = o.title.split(' + ')[0];
    return existingBaseTitle === baseTitle;
  });
}
```

## 7. 소설 원본 저장

### saveNovelText(title, text, knowledgeGraphId?, userId?)

```typescript
const { id, title } = await saveNovelText(
  '나의 소설',
  '소설 텍스트...',
  knowledgeGraphId,
  userId
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

## 8. 내보내기/가져오기

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

## 9. 저장소 초기화

```typescript
await clearAllStorage();
// IndexedDB의 knowledgeGraphs, versions 스토어 전체 삭제
```

## 10. 에러 처리

### 폴백 전략

```typescript
try {
  // 서버 API 시도
  const response = await fetch(`${API_BASE}/knowledge-graphs`);
  if (!response.ok) throw new Error('API 응답 오류');
  return await response.json();
} catch (err) {
  console.warn('[storage] 서버 실패, 로컬 사용:', err);
  return getLocalList();  // 로컬 폴백
}
```

### 로그 패턴

```
[storage] 서버 목록 조회 실패, 로컬 사용: Error
[storage] 서버 저장 실패, 로컬 저장: Error
[storage] 기존 데이터 업데이트: 01화 -> 01화 + 02화 (v2)
[storage] 새 데이터 저장: 03화 (v1)
```

## 11. 시퀀스 다이어그램

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

### 폴백 흐름

```
App          storage.ts        Server API        IndexedDB
 |               |                  |               |
 |--저장 요청--->|                  |               |
 |               |--POST----------->|               |
 |               |<--오류 발생------|               |
 |               |                  |               |
 |               |--saveLocal()-------------------->|
 |               |<--SavedMeta----------------------|
 |<--완료--------|                  |               |
```

## 12. 주의사항

1. **ID 구분**: 로컬 ID(`kg_`)와 서버 ID를 구분하여 처리
2. **버전 충돌**: 동시 편집 시 버전 히스토리로 복구 가능
3. **오프라인**: 서버 연결 실패 시 자동으로 로컬 저장
4. **데이터 마이그레이션**: 로컬 → 서버 마이그레이션은 별도 구현 필요
