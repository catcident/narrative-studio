/**
 * 지식 그래프 조작 순수함수
 * 파일 삭제/이동/수정 시 KG 데이터를 변환하는 로직을 중앙화
 * 모든 함수는 순수함수 (입력 → 출력, side effect 없음)
 */

import type {
  NovelKnowledgeGraph,
  SceneSnapshot,
  SourceFile,
  FileValidationResult,
  LoreEntry,
  Lorebook,
} from '../types';

// ─── 파일명 → 파일 ID 매핑 ───

export function buildFileNameToIdMap(sourceFiles: SourceFile[]): Record<string, string> {
  const map: Record<string, string> = {};
  sourceFiles.forEach(f => { map[f.fileName] = f.id; });
  return map;
}

// ─── 장면 → 파일 매핑 (4단계 폴백) ───

/**
 * 장면이 어떤 소스 파일에 속하는지 결정 (단일 정의)
 * 1. sourceFileId 직접 매핑
 * 2. sourceFile(파일명) → ID 역탐색
 * 3. 파일 1개면 모든 장면이 그 파일
 * 4. chapterNumber로 파일명 숫자 매칭
 */
export function getFileIdForScene(
  scene: SceneSnapshot,
  sourceFiles: SourceFile[],
  fileNameToId: Record<string, string>,
): string | null {
  if (scene.sourceFileId) {
    return scene.sourceFileId;
  }
  if (scene.sourceFile && fileNameToId[scene.sourceFile]) {
    return fileNameToId[scene.sourceFile];
  }
  if (sourceFiles.length === 1) {
    return sourceFiles[0].id;
  }
  if (scene.chapterNumber && sourceFiles.length > 0) {
    const matchedFile = sourceFiles.find(f => {
      const match = f.fileName.match(/(\d+)/);
      return match && parseInt(match[1]) === scene.chapterNumber;
    });
    if (matchedFile) return matchedFile.id;
  }
  return null;
}

// ─── 파일별 장면 그룹핑 ───

/**
 * 스냅샷을 소스 파일별로 그룹핑, 각 파일 내 order 정렬
 */
export function getScenesByFile(
  snapshots: Record<string, SceneSnapshot>,
  sourceFiles: SourceFile[],
): Record<string, SceneSnapshot[]> {
  const map: Record<string, SceneSnapshot[]> = {};
  const fileNameToId = buildFileNameToIdMap(sourceFiles);

  Object.values(snapshots).forEach(scene => {
    const fileId = getFileIdForScene(scene, sourceFiles, fileNameToId) || '_unknown';
    if (!map[fileId]) map[fileId] = [];
    map[fileId].push(scene);
  });

  Object.keys(map).forEach(key => {
    map[key].sort((a, b) => a.order - b.order);
  });

  return map;
}

// ─── "장면 N" 텍스트 참조 치환 ───

/**
 * "장면 N" 패턴을 새 order 번호로 치환
 */
export function updateSceneReferences(
  text: string | null | undefined,
  orderMapping: Record<number, number>,
): string | null {
  if (!text) return text as null;
  return text.replace(/장면\s*(\d+)/g, (match, num) => {
    const oldOrder = parseInt(num);
    const newOrder = orderMapping[oldOrder];
    return newOrder !== undefined ? `장면 ${newOrder}` : match;
  });
}

// ─── 로어북 헬퍼 ───

/**
 * 삭제된 장면의 로어 엔트리 제거 + 파일 ID 재매핑
 */
function filterAndRemapLorebook(
  lorebook: Lorebook | undefined,
  scenesToDelete: Set<string>,
  fileIdMapping?: Record<string, string>,
): Lorebook | undefined {
  if (!lorebook) return undefined;
  const newEntries: Record<string, LoreEntry> = {};
  Object.entries(lorebook.entries).forEach(([id, entry]) => {
    if (scenesToDelete.has(entry.sceneId)) return;
    const remappedFileId = entry.sourceFileId && fileIdMapping
      ? fileIdMapping[entry.sourceFileId] || entry.sourceFileId
      : entry.sourceFileId;
    newEntries[id] = remappedFileId !== entry.sourceFileId
      ? { ...entry, sourceFileId: remappedFileId }
      : entry;
  });
  return { entries: newEntries };
}

/**
 * 로어북 엔트리의 sourceFileId를 재매핑
 */
function remapLorebookFileIds(
  lorebook: Lorebook | undefined,
  fileIdMapping: Record<string, string>,
): Lorebook | undefined {
  if (!lorebook) return undefined;
  const newEntries: Record<string, LoreEntry> = {};
  Object.entries(lorebook.entries).forEach(([id, entry]) => {
    const newFileId = entry.sourceFileId ? fileIdMapping[entry.sourceFileId] || entry.sourceFileId : entry.sourceFileId;
    newEntries[id] = newFileId !== entry.sourceFileId
      ? { ...entry, sourceFileId: newFileId }
      : entry;
  });
  return { entries: newEntries };
}

// ─── 파일 ID 재번호화 ───

/**
 * 소스 파일 ID를 F0001, F0002... 순차 재할당하고,
 * 장면의 sourceFileId, 검증 결과 키를 모두 업데이트
 */
export function renumberFileIds(
  sourceFiles: SourceFile[],
  snapshots: Record<string, SceneSnapshot>,
  validationResults: Record<string, FileValidationResult>,
  deletedFileId?: string,
): {
  sourceFiles: SourceFile[];
  snapshots: Record<string, SceneSnapshot>;
  validationResults: Record<string, FileValidationResult>;
  fileIdMapping: Record<string, string>;
} {
  // 파일 ID 매핑 생성
  const fileIdMapping: Record<string, string> = {};
  const newSourceFiles = sourceFiles.map((file, index) => {
    const newId = `F${String(index + 1).padStart(4, '0')}`;
    fileIdMapping[file.id] = newId;
    return { ...file, id: newId };
  });

  // 장면 sourceFileId 업데이트
  const newSnapshots: Record<string, SceneSnapshot> = {};
  Object.entries(snapshots).forEach(([sceneId, scene]) => {
    if (scene.sourceFileId && fileIdMapping[scene.sourceFileId]) {
      newSnapshots[sceneId] = { ...scene, sourceFileId: fileIdMapping[scene.sourceFileId] };
    } else {
      newSnapshots[sceneId] = scene;
    }
  });

  // 검증 결과 키/참조 업데이트
  const newValidation: Record<string, FileValidationResult> = {};
  Object.entries(validationResults).forEach(([oldFileId, result]) => {
    if (deletedFileId && oldFileId === deletedFileId) return;
    const newId = fileIdMapping[oldFileId];
    if (newId) {
      newValidation[newId] = {
        ...result,
        fileId: newId,
        comparedWith: result.comparedWith
          .filter(id => id !== deletedFileId)
          .map(id => fileIdMapping[id] || id),
      };
    }
  });

  return {
    sourceFiles: newSourceFiles,
    snapshots: newSnapshots,
    validationResults: newValidation,
    fileIdMapping,
  };
}

// ─── 장면 순서 재계산 ───

/**
 * 새 소스 파일 순서에 맞게 장면 order/chapter를 재계산하고
 * "장면 N" 참조를 업데이트
 */
export function reorderScenes(
  graph: NovelKnowledgeGraph,
  newSourceFiles: SourceFile[],
): Pick<NovelKnowledgeGraph, 'snapshots' | 'hyperedges' | 'chapters'> {
  const fileNameToId = buildFileNameToIdMap(newSourceFiles);
  const oldSourceFiles = graph.metadata.sourceFiles || [];

  // 새 파일 순서대로 장면 수집
  const allScenesInNewOrder: SceneSnapshot[] = [];
  for (const file of newSourceFiles) {
    const fileScenes = Object.values(graph.snapshots)
      .filter(scene => getFileIdForScene(scene, newSourceFiles, fileNameToId) === file.id)
      .sort((a, b) => a.order - b.order);
    allScenesInNewOrder.push(...fileScenes);
  }

  // 매핑 안 된 장면 끝에 추가
  const collectedIds = new Set(allScenesInNewOrder.map(s => s.sceneId));
  Object.values(graph.snapshots)
    .filter(s => !collectedIds.has(s.sceneId))
    .sort((a, b) => a.order - b.order)
    .forEach(s => allScenesInNewOrder.push(s));

  // order 매핑 (기존 → 새)
  const orderMapping: Record<number, number> = {};
  allScenesInNewOrder.forEach((scene, idx) => {
    orderMapping[scene.order] = idx + 1;
  });

  // 파일 ID → chapterNumber 매핑
  const fileIdToChapterNumber: Record<string, number> = {};
  newSourceFiles.forEach((file, idx) => {
    fileIdToChapterNumber[file.id] = idx + 1;
  });

  // 장면 업데이트
  const newSnapshots: Record<string, SceneSnapshot> = {};
  allScenesInNewOrder.forEach((scene, idx) => {
    const fileId = getFileIdForScene(scene, newSourceFiles, fileNameToId);
    const newChapterNumber = fileId ? fileIdToChapterNumber[fileId] : scene.chapterNumber;
    const newChapterId = newChapterNumber ? `C${String(newChapterNumber).padStart(4, '0')}` : undefined;
    const newOrder = idx + 1;
    const updatedScene: SceneSnapshot = {
      ...scene,
      order: newOrder,
      chapterNumber: newChapterNumber ?? scene.chapterNumber,
      chapter: newChapterId ?? scene.chapter,
    };
    if (updatedScene.time) {
      updatedScene.time = updateSceneReferences(updatedScene.time, orderMapping) || updatedScene.time;
    }
    newSnapshots[scene.sceneId] = updatedScene;
  });

  // 엣지 statement 업데이트
  const newHyperedges = { ...graph.hyperedges };
  Object.keys(newHyperedges).forEach(edgeId => {
    const edge = newHyperedges[edgeId];
    if (edge.statement) {
      const updated = updateSceneReferences(edge.statement, orderMapping);
      if (updated && updated !== edge.statement) {
        newHyperedges[edgeId] = { ...edge, statement: updated };
      }
    }
  });

  // chapters 재배치
  let newChapters = graph.chapters;
  if (graph.chapters) {
    const oldChapters = graph.chapters;
    const reorderedChapters: Record<string, typeof oldChapters[string]> = {};

    newSourceFiles.forEach((file, idx) => {
      const newChapterNum = idx + 1;
      const newChapterId = `C${String(newChapterNum).padStart(4, '0')}`;
      const oldFileIdx = oldSourceFiles.findIndex(f => f.id === file.id);
      const oldChapterNum = oldFileIdx + 1;
      const oldChapterId = `C${String(oldChapterNum).padStart(4, '0')}`;

      if (oldChapters[oldChapterId]) {
        reorderedChapters[newChapterId] = {
          ...oldChapters[oldChapterId],
          id: newChapterId,
          number: newChapterNum,
        };
      }
    });

    // 매핑 안 된 챕터 유지
    Object.entries(oldChapters).forEach(([id, ch]) => {
      if (!reorderedChapters[id]) {
        reorderedChapters[id] = ch;
      }
    });

    newChapters = reorderedChapters;
  }

  return { snapshots: newSnapshots, hyperedges: newHyperedges, chapters: newChapters };
}

// ─── 파일 삭제 ───

/**
 * 지식 그래프에서 파일을 삭제하고 관련 데이터 정리
 * 순수함수: graph 입력 → 새 graph 출력
 */
export function deleteFileFromGraph(
  graph: NovelKnowledgeGraph,
  fileId: string,
  fileName: string,
): NovelKnowledgeGraph {
  // 1. 삭제할 장면 찾기
  const scenesToDelete = new Set<string>();
  Object.entries(graph.snapshots).forEach(([sceneId, scene]) => {
    if (scene.sourceFile === fileName || scene.sourceFileId === fileId) {
      scenesToDelete.add(sceneId);
    }
  });

  // 2. 장면 제거
  const newSnapshots: Record<string, SceneSnapshot> = {};
  Object.entries(graph.snapshots).forEach(([sceneId, scene]) => {
    if (!scenesToDelete.has(sceneId)) {
      newSnapshots[sceneId] = scene;
    }
  });

  // 3. 남은 장면 order 재정렬
  const sortedScenes = Object.values(newSnapshots).sort((a, b) => a.order - b.order);
  let newOrder = 1;
  sortedScenes.forEach(scene => {
    newSnapshots[scene.sceneId] = { ...scene, order: newOrder++ };
  });

  // 4. entity scenes에서 삭제된 장면 제거
  const newEntities = { ...graph.entities };
  Object.keys(newEntities).forEach(entityId => {
    const entity = newEntities[entityId];
    if (entity.scenes) {
      newEntities[entityId] = {
        ...entity,
        scenes: entity.scenes.filter(sid => !scenesToDelete.has(sid)),
      };
    }
  });

  // 5. 장면이 없는 엔티티 삭제 + description 재구성
  const finalEntities: typeof graph.entities = {};
  Object.entries(newEntities).forEach(([entityId, entity]) => {
    const hasScenes = entity.scenes && entity.scenes.length > 0;
    if (hasScenes) {
      const remainingSceneSummaries = (entity.scenes || [])
        .map(sid => newSnapshots[sid]?.summary)
        .filter(Boolean);
      finalEntities[entityId] = {
        ...entity,
        description: remainingSceneSummaries.length > 0
          ? remainingSceneSummaries.join(' ')
          : `${entity.name} (${entity.category})`,
      };
    }
  });

  // 6. edge scenes에서 삭제된 장면 제거 + 빈 엣지/고아 엣지 삭제
  const survivingEntityIds = new Set(Object.keys(finalEntities));
  const newHyperedges: typeof graph.hyperedges = {};
  Object.entries(graph.hyperedges).forEach(([edgeId, edge]) => {
    const filteredScenes = edge.scenes?.filter(sid => !scenesToDelete.has(sid)) || [];
    // 장면이 남아있고, 연결된 엔티티가 모두 살아있는 엣지만 유지
    if (filteredScenes.length > 0 && edge.entities.every(id => survivingEntityIds.has(id))) {
      newHyperedges[edgeId] = { ...edge, scenes: filteredScenes };
    }
  });

  // 7. 로어북에서 삭제된 장면의 엔트리 제거
  // (renumber 전에 먼저 장면 기반 필터링)
  const filteredLorebook = filterAndRemapLorebook(graph.lorebook, scenesToDelete);

  // 8. 파일 제거 + ID 재번호화
  const remainingFiles = (graph.metadata.sourceFiles || []).filter(f => f.id !== fileId);
  const renumbered = renumberFileIds(
    remainingFiles,
    newSnapshots,
    graph.validationResults || {},
    fileId,
  );

  // 로어북 파일 ID 재매핑
  const remappedLorebook = remapLorebookFileIds(filteredLorebook, renumbered.fileIdMapping);

  return {
    ...graph,
    metadata: {
      ...graph.metadata,
      sourceFiles: renumbered.sourceFiles,
      updatedAt: new Date().toISOString(),
    },
    entities: finalEntities,
    hyperedges: newHyperedges,
    snapshots: renumbered.snapshots,
    validationResults: renumbered.validationResults,
    lorebook: remappedLorebook,
    stats: {
      ...graph.stats,
      totalEntities: Object.keys(finalEntities).length,
      totalEdges: Object.keys(newHyperedges).length,
    },
  };
}

// ─── 파일 이동 ───

/**
 * 파일 순서를 변경하고 장면/챕터/참조를 모두 업데이트
 * 이동 불가 시 null 반환
 */
export function buildMoveFileGraph(
  graph: NovelKnowledgeGraph,
  fileIndex: number,
  direction: 'up' | 'down',
): NovelKnowledgeGraph | null {
  const currentFiles = graph.metadata.sourceFiles || [];
  if (currentFiles.length < 2) return null;

  const targetIndex = direction === 'up' ? fileIndex - 1 : fileIndex + 1;
  if (targetIndex < 0 || targetIndex >= currentFiles.length) return null;

  // 파일 순서 교환
  const newSourceFiles = [...currentFiles];
  newSourceFiles[fileIndex] = currentFiles[targetIndex];
  newSourceFiles[targetIndex] = currentFiles[fileIndex];

  // 장면/챕터/참조 재계산
  const reordered = reorderScenes(graph, newSourceFiles);

  // 검증 결과: 첫 파일은 항상 passed, 나머지는 기존 유지
  const newValidation: Record<string, FileValidationResult> = {};
  newSourceFiles.forEach((file, idx) => {
    if (idx === 0) {
      newValidation[file.id] = {
        fileId: file.id,
        status: 'passed',
        validatedAt: new Date().toISOString(),
        issues: [],
        comparedWith: [],
      };
    } else {
      const oldResult = graph.validationResults?.[file.id];
      if (oldResult) {
        newValidation[file.id] = oldResult;
      }
    }
  });

  return {
    ...graph,
    metadata: {
      ...graph.metadata,
      sourceFiles: newSourceFiles,
      updatedAt: new Date().toISOString(),
    },
    ...reordered,
    validationResults: newValidation,
  };
}

// ─── 수정 후 파일 원위치 복원 ───

/**
 * 재분석 후 맨 뒤에 추가된 파일을 원래 위치로 이동
 * (handleSaveEdit에서 delete → re-analyze 후 사용)
 */
export function buildEditFileGraph(
  graph: NovelKnowledgeGraph,
  originalFileIndex: number,
  fileName: string,
  savedValidationByFileName?: Record<string, FileValidationResult>,
): NovelKnowledgeGraph {
  const updatedFiles = graph.metadata.sourceFiles || [];
  const newFileIndex = updatedFiles.findIndex(f => f.fileName === fileName);

  // 파일이 맨 뒤에 없거나 이미 원래 위치면 그대로 반환
  if (newFileIndex < 0 || newFileIndex === originalFileIndex || newFileIndex !== updatedFiles.length - 1) {
    return graph;
  }

  // 파일을 맨 뒤에서 원래 위치로 이동
  const reorderedFiles = [...updatedFiles];
  const [movedFile] = reorderedFiles.splice(newFileIndex, 1);
  reorderedFiles.splice(originalFileIndex, 0, movedFile);

  // 파일 ID 재번호화
  const renumbered = renumberFileIds(
    reorderedFiles,
    graph.snapshots,
    graph.validationResults || {},
  );

  // 파일명 → 새 ID 매핑 (장면 sourceFileId 업데이트용)
  const fileNameToNewId: Record<string, string> = {};
  renumbered.sourceFiles.forEach(f => { fileNameToNewId[f.fileName] = f.id; });

  // 장면의 sourceFileId를 파일명 기반으로 재매핑
  const remappedSnapshots: Record<string, SceneSnapshot> = {};
  Object.entries(renumbered.snapshots).forEach(([sceneId, scene]) => {
    let newFileId: string | undefined;
    if (scene.sourceFile && fileNameToNewId[scene.sourceFile]) {
      newFileId = fileNameToNewId[scene.sourceFile];
    } else if (scene.sourceFileId) {
      const oldFile = updatedFiles.find(f => f.id === scene.sourceFileId);
      if (oldFile && fileNameToNewId[oldFile.fileName]) {
        newFileId = fileNameToNewId[oldFile.fileName];
      }
    }
    remappedSnapshots[sceneId] = newFileId
      ? { ...scene, sourceFileId: newFileId }
      : scene;
  });

  // 장면 순서 재계산
  const graphWithRemappedFiles: NovelKnowledgeGraph = {
    ...graph,
    metadata: { ...graph.metadata, sourceFiles: renumbered.sourceFiles },
    snapshots: remappedSnapshots,
    hyperedges: graph.hyperedges,
  };
  const reordered = reorderScenes(graphWithRemappedFiles, renumbered.sourceFiles);

  // 검증 결과: 수정된 파일만 리셋, 나머지는 파일명 기반으로 원본에서 복원
  const newValidation: Record<string, FileValidationResult> = {};
  if (savedValidationByFileName) {
    // 삭제 전에 저장해둔 파일명 → 검증결과 맵에서 복원
    renumbered.sourceFiles.forEach((f) => {
      if (f.fileName === fileName) return; // 수정된 파일은 검증 리셋
      const origResult = savedValidationByFileName[f.fileName];
      if (origResult) {
        newValidation[f.id] = { ...origResult, fileId: f.id };
      }
    });
  }

  // 로어북: 파일 ID 재매핑
  const remappedLorebook = remapLorebookFileIds(graph.lorebook, renumbered.fileIdMapping);

  return {
    ...graph,
    metadata: {
      ...graph.metadata,
      sourceFiles: renumbered.sourceFiles,
      updatedAt: new Date().toISOString(),
    },
    ...reordered,
    validationResults: newValidation,
    lorebook: remappedLorebook,
  };
}
