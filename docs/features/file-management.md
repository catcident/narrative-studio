# 파일 관리

소스 파일의 추가, 삭제, 순서 변경 기능입니다.

## 파일 구조

```
web/src/
├── hooks/useAddFileAnalysis.ts    # 파일 추가 분석 훅
├── components/SourceTextView.tsx   # 파일 목록 및 관리 UI
└── services/fileReader.ts          # 파일 읽기 (TXT, PDF, MD)
```

## 1. 파일 추가

### useAddFileAnalysis 훅

```typescript
const { addFile, execute, isAdding, progress, localError, clearLocalError } = useAddFileAnalysis();
```

### 처리 흐름

```
파일 선택 → 파일 읽기 → 중복 체크 → 분석 → 병합 → 저장
```

### 중복 파일 체크

```typescript
// useAddFileAnalysis.ts:85-96
const existingFileNames = (knowledgeGraph.metadata.sourceFiles || [])
  .map(f => f.fileName);

if (existingFileNames.includes(file.name)) {
  // 에러 표시: "파일명" 파일이 이미 존재합니다.
  setLocalError(`"${file.name}" 파일이 이미 존재합니다.`);
  return;
}
```

### 파일 형식 지원

| 형식 | MIME 타입 | 처리 방법 |
|------|-----------|-----------|
| .txt | text/plain | 직접 읽기 |
| .md | text/markdown | 직접 읽기 |
| .pdf | application/pdf | pdfjs-dist로 텍스트 추출 |

### 분석 옵션

```typescript
await extractKnowledgeGraph({
  text,
  title: knowledgeGraph.metadata.title,
  model: knowledgeGraph.metadata.model,
  fileNames: [fileName],
  existingGraph: knowledgeGraph,  // 기존 그래프 전달
  // ...
});
```

## 2. 파일 삭제

### 위치

`SourceTextView.tsx` → `handleDeleteFile()`

### 삭제 흐름

```
삭제 확인 → 관련 장면 찾기 → 장면 삭제 → 엔티티 scenes 정리
→ 관계 scenes 정리 → 고아 엔티티 삭제 → 파일 ID 재정렬 → 저장
```

### 단계별 상세

#### 1. 관련 장면 찾기

```typescript
const scenesToDelete = new Set<string>();
Object.entries(knowledgeGraph.snapshots).forEach(([sceneId, scene]) => {
  const matchByName = scene.sourceFile === fileName;
  const matchById = scene.sourceFileId === fileId;
  if (matchByName || matchById) {
    scenesToDelete.add(sceneId);
  }
});
```

#### 2. 장면 삭제

```typescript
const newSnapshots = {};
Object.entries(knowledgeGraph.snapshots).forEach(([sceneId, scene]) => {
  if (!scenesToDelete.has(sceneId)) {
    newSnapshots[sceneId] = scene;
  }
});
```

#### 3. 엔티티 scenes 배열 정리

```typescript
Object.keys(newEntities).forEach(entityId => {
  const entity = newEntities[entityId];
  if (entity.scenes) {
    newEntities[entityId] = {
      ...entity,
      scenes: entity.scenes.filter(sceneId => !scenesToDelete.has(sceneId)),
    };
  }
});
```

#### 4. 관계 scenes 배열 정리 + 빈 관계 삭제

```typescript
Object.entries(knowledgeGraph.hyperedges).forEach(([edgeId, edge]) => {
  const filteredScenes = edge.scenes?.filter(sceneId => !scenesToDelete.has(sceneId)) || [];
  // 장면이 남아있는 관계만 유지
  if (filteredScenes.length > 0) {
    newHyperedges[edgeId] = { ...edge, scenes: filteredScenes };
  }
});
```

#### 5. 고아 엔티티 삭제

```typescript
// 관계가 있는 엔티티 ID 수집
const entitiesWithRelations = new Set<string>();
Object.values(newHyperedges).forEach(edge => {
  edge.entities.forEach(entityId => entitiesWithRelations.add(entityId));
});

// 관계가 있거나 장면이 남아있는 엔티티만 유지
Object.entries(newEntities).forEach(([entityId, entity]) => {
  const hasRelations = entitiesWithRelations.has(entityId);
  const hasScenes = entity.scenes && entity.scenes.length > 0;
  if (hasRelations || hasScenes) {
    finalEntities[entityId] = entity;
  }
});
```

#### 6. 파일 ID 재정렬

```typescript
const newSourceFiles = remainingSourceFiles.map((file, index) => {
  const newId = `F${String(index + 1).padStart(4, '0')}`;
  fileIdMapping[file.id] = newId;
  return { ...file, id: newId };
});

// 장면의 sourceFileId도 새 ID로 업데이트
Object.keys(newSnapshots).forEach(sceneId => {
  const scene = newSnapshots[sceneId];
  if (scene.sourceFileId && fileIdMapping[scene.sourceFileId]) {
    newSnapshots[sceneId] = {
      ...scene,
      sourceFileId: fileIdMapping[scene.sourceFileId],
    };
  }
});
```

## 3. 파일 순서 변경

### 위치

`SourceTextView.tsx` → `handleMoveFile()`

### 변경 흐름

```
순서 변경 → 장면 order 재계산 → chapterNumber 업데이트
→ 텍스트 내 "장면 N" 참조 업데이트 → 저장
```

### 단계별 상세

#### 1. 장면 수집 (새 순서대로)

```typescript
const allScenesInNewOrder: SceneSnapshot[] = [];
for (const file of newSourceFiles) {
  const fileScenes = Object.values(knowledgeGraph.snapshots)
    .filter(scene => getFileIdForScene(scene) === file.id)
    .sort((a, b) => a.order - b.order);
  allScenesInNewOrder.push(...fileScenes);
}
```

#### 2. order 매핑 생성

```typescript
const orderMapping: Record<number, number> = {};
allScenesInNewOrder.forEach((scene, idx) => {
  orderMapping[scene.order] = idx + 1;
});
// 예: { 1: 5, 2: 6, 3: 7, 4: 8, 5: 1, 6: 2, 7: 3, 8: 4 }
```

#### 3. 장면 업데이트

```typescript
allScenesInNewOrder.forEach((scene, idx) => {
  const fileId = getFileIdForScene(scene);
  const newChapterNumber = fileId ? fileIdToChapterNumber[fileId] : scene.chapterNumber;
  const newOrder = idx + 1;

  newSnapshots[scene.sceneId] = {
    ...scene,
    order: newOrder,
    chapterNumber: newChapterNumber ?? scene.chapterNumber,
  };
});
```

#### 4. 텍스트 내 장면 참조 업데이트

```typescript
const updateSceneReferences = (text: string | null | undefined): string | null => {
  if (!text) return text as null;
  return text.replace(/장면\s*(\d+)/g, (match, num) => {
    const oldOrder = parseInt(num);
    const newOrder = orderMapping[oldOrder];
    if (newOrder !== undefined) {
      return `장면 ${newOrder}`;
    }
    return match;
  });
};

// hyperedges의 statement 필드 업데이트
Object.keys(newHyperedges).forEach(edgeId => {
  const edge = newHyperedges[edgeId];
  if (edge.statement) {
    const updatedStatement = updateSceneReferences(edge.statement);
    if (updatedStatement !== edge.statement) {
      newHyperedges[edgeId] = { ...edge, statement: updatedStatement };
    }
  }
});
```

## 4. 장면 → 파일 매핑

파일이 여러 개일 때 각 장면이 어느 파일에 속하는지 결정하는 로직입니다.

### 매핑 우선순위

```typescript
const getFileIdForScene = (scene: SceneSnapshot): string | null => {
  // 1. sourceFileId가 있으면 그걸 사용 (가장 정확)
  if (scene.sourceFileId) {
    return scene.sourceFileId;
  }

  // 2. sourceFile(파일명)이 있으면 ID로 변환
  if (scene.sourceFile && fileNameToId[scene.sourceFile]) {
    return fileNameToId[scene.sourceFile];
  }

  // 3. 파일 1개면 모든 장면이 그 파일
  if (currentFiles.length === 1) {
    return currentFiles[0].id;
  }

  // 4. chapterNumber로 파일 매핑 시도 (하위 호환)
  if (scene.chapterNumber) {
    const matchedFile = currentFiles.find(f => {
      const match = f.fileName.match(/(\d+)/);
      return match && parseInt(match[1]) === scene.chapterNumber;
    });
    if (matchedFile) {
      return matchedFile.id;
    }
  }

  return null;
};
```

## 5. 데이터 구조

### SourceFile

```typescript
interface SourceFile {
  id: string;           // "F0001"
  fileName: string;     // "01화.md"
  uploadedAt: string;   // ISO timestamp
  text: string;         // 원본 텍스트
  charCount: number;    // 문자 수
}
```

### SceneSnapshot (파일 관련 필드)

```typescript
interface SceneSnapshot {
  sceneId: string;        // "S0001"
  order: number;          // 전체 순서
  sourceFile?: string;    // 파일명 (하위 호환)
  sourceFileId?: string;  // 파일 ID (권장)
  chapterNumber?: number; // 챕터 번호
  // ...
}
```

## 6. UI 상태

### 파일 목록

```typescript
const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
const [searchQuery, setSearchQuery] = useState('');
const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
const [movingFileId, setMovingFileId] = useState<string | null>(null);
const [errorMessage, setErrorMessage] = useState<string | null>(null);
```

### 에러 표시

파일 작업 실패 시 빨간 토스트로 에러 메시지 표시:

```tsx
{errorMessage && (
  <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">
    <span>{errorMessage}</span>
    <button onClick={() => setErrorMessage(null)}>✕</button>
  </div>
)}
```
