/**
 * SourceTextView 컴포넌트의 상태 및 핸들러를 관리하는 커스텀 훅
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import { useStore, useIsValidating, useValidatingFileId } from '../store';
import { updateKnowledgeGraph } from '../services/storage';
import { validateFile } from '../services/validation';
import { useAddFileAnalysis } from './useAddFileAnalysis';
import type { SceneSnapshot, NovelKnowledgeGraph, SourceFile, FileValidationResult } from '../types';

export function useSourceTextView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const currentDataId = useStore((s) => s.currentDataId);
  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const isValidating = useIsValidating();
  const validatingFileId = useValidatingFileId();
  const setIsValidating = useStore((s) => s.setIsValidating);
  const setValidatingFileId = useStore((s) => s.setValidatingFileId);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [movingFileId, setMovingFileId] = useState<string | null>(null);
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
  const [isValidatingAll, setIsValidatingAll] = useState(false);
  const abortValidationRef = useRef(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // 파일 추가 분석 훅 (수정 시 재분석용)
  const { execute: executeAddFile, isAdding: isReanalyzing, progress: reanalyzeProgress } = useAddFileAnalysis();

  // 검증 결과를 knowledgeGraph에서 직접 읽음 (store의 Map은 UI용)
  const getValidationStatus = (fileId: string): FileValidationResult | undefined => {
    return knowledgeGraph?.validationResults?.[fileId];
  };

  // 검증 결과 저장 - 최신 상태에서 가져와서 저장
  const saveValidationResult = async (fileId: string, result: FileValidationResult) => {
    const state = useStore.getState();
    const latestGraph = state.knowledgeGraph;
    const dataId = state.currentDataId;

    if (!latestGraph || !dataId) return;

    const updatedGraph: NovelKnowledgeGraph = {
      ...latestGraph,
      validationResults: {
        ...latestGraph.validationResults,
        [fileId]: result,
      },
    };

    setKnowledgeGraph(updatedGraph);
    await updateKnowledgeGraph(dataId, updatedGraph);
  };

  const sourceFiles = useMemo(() => {
    return knowledgeGraph?.metadata.sourceFiles || [];
  }, [knowledgeGraph]);

  // 파일별 장면 매핑 (파일 ID 기준으로 일관되게 매핑)
  const scenesByFile = useMemo(() => {
    const map: Record<string, SceneSnapshot[]> = {};
    if (!knowledgeGraph?.snapshots) return map;

    // 파일명 → 파일 ID 매핑 생성
    const fileNameToId: Record<string, string> = {};
    sourceFiles.forEach(f => {
      fileNameToId[f.fileName] = f.id;
    });

    // 파일이 1개뿐이면 모든 장면이 그 파일에서 온 것
    const singleFileMode = sourceFiles.length === 1;
    const singleFileId = singleFileMode ? sourceFiles[0].id : null;

    Object.values(knowledgeGraph.snapshots).forEach(scene => {
      let fileId: string | null = null;

      // 1. sourceFileId가 있으면 그걸 사용
      if (scene.sourceFileId) {
        fileId = scene.sourceFileId;
      }
      // 2. sourceFile(파일명)이 있으면 ID로 변환
      else if (scene.sourceFile && fileNameToId[scene.sourceFile]) {
        fileId = fileNameToId[scene.sourceFile];
      }
      // 3. 파일 1개면 모든 장면이 그 파일
      else if (singleFileId) {
        fileId = singleFileId;
      }
      // 4. chapterNumber로 파일 매핑 시도 (하위 호환)
      else if (scene.chapterNumber && sourceFiles.length > 0) {
        const targetChapter = scene.chapterNumber;
        const matchedFile = sourceFiles.find(f => {
          const match = f.fileName.match(/(\d+)/);
          return match && parseInt(match[1]) === targetChapter;
        });
        if (matchedFile) {
          fileId = matchedFile.id;
        }
      }

      const key = fileId || '_unknown';
      if (!map[key]) map[key] = [];
      map[key].push(scene);
    });

    // 각 파일의 장면들을 order 순으로 정렬
    Object.keys(map).forEach(key => {
      map[key].sort((a, b) => a.order - b.order);
    });

    return map;
  }, [knowledgeGraph?.snapshots, sourceFiles]);

  // 검색 결과 하이라이트
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;

    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 px-0.5 rounded">{part}</mark>
        : part
    );
  };

  // 파일 토글
  const toggleFile = (fileId: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  // 모두 펼치기/접기
  const toggleAll = () => {
    if (expandedFiles.size === sourceFiles.length) {
      setExpandedFiles(new Set());
    } else {
      setExpandedFiles(new Set(sourceFiles.map(f => f.id)));
    }
  };

  // 텍스트 복사
  const copyText = async (fileId: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(fileId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 검색어가 포함된 파일 필터링
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return sourceFiles;
    const query = searchQuery.toLowerCase();
    return sourceFiles.filter(f =>
      f.fileName.toLowerCase().includes(query) ||
      f.text.toLowerCase().includes(query)
    );
  }, [sourceFiles, searchQuery]);

  // 파일 삭제 핸들러
  const handleDeleteFile = useCallback(async (fileId: string, fileName: string) => {
    if (!knowledgeGraph || !currentDataId) return;

    setDeletingFileId(fileId);
    try {
      // 1. 삭제할 파일과 관련된 장면 ID 찾기
      const scenesToDelete = new Set<string>();
      Object.entries(knowledgeGraph.snapshots).forEach(([sceneId, scene]) => {
        const matchByName = scene.sourceFile === fileName;
        const matchById = scene.sourceFileId === fileId;
        if (matchByName || matchById) {
          scenesToDelete.add(sceneId);
          console.log(`[SourceTextView] 삭제 대상 장면: ${sceneId}, sourceFile=${scene.sourceFile}, sourceFileId=${scene.sourceFileId}`);
        }
      });

      console.log(`[SourceTextView] 삭제할 장면들: ${[...scenesToDelete].join(', ')} (총 ${scenesToDelete.size}개)`);
      console.log(`[SourceTextView] 전체 장면: ${Object.keys(knowledgeGraph.snapshots).join(', ')}`);

      // 2. 새 snapshots 객체 생성 (삭제된 장면 제외)
      const newSnapshots: Record<string, SceneSnapshot> = {};
      Object.entries(knowledgeGraph.snapshots).forEach(([sceneId, scene]) => {
        if (!scenesToDelete.has(sceneId)) {
          newSnapshots[sceneId] = scene;
        }
      });

      // 3. 남은 장면들의 order 재정렬 (기존 order 순으로 1부터 다시 번호 매기기)
      const remainingSourceFiles = knowledgeGraph.metadata.sourceFiles?.filter(f => f.id !== fileId) || [];
      const sortedScenes = Object.values(newSnapshots).sort((a, b) => a.order - b.order);
      let newOrder = 1;
      sortedScenes.forEach(scene => {
        newSnapshots[scene.sceneId] = { ...scene, order: newOrder++ };
      });

      // 4. entities의 scenes 배열에서 삭제된 장면 제거
      const newEntities = { ...knowledgeGraph.entities };
      Object.keys(newEntities).forEach(entityId => {
        const entity = newEntities[entityId];
        if (entity.scenes) {
          newEntities[entityId] = {
            ...entity,
            scenes: entity.scenes.filter(sceneId => !scenesToDelete.has(sceneId)),
          };
        }
      });

      // 5. hyperedges의 scenes 배열에서 삭제된 장면 제거 + 빈 관계 삭제
      const newHyperedges: typeof knowledgeGraph.hyperedges = {};
      Object.entries(knowledgeGraph.hyperedges).forEach(([edgeId, edge]) => {
        const filteredScenes = edge.scenes?.filter(sceneId => !scenesToDelete.has(sceneId)) || [];
        // 장면이 남아있는 관계만 유지
        if (filteredScenes.length > 0) {
          newHyperedges[edgeId] = {
            ...edge,
            scenes: filteredScenes,
          };
        }
      });

      // 6. 관계가 있는 엔티티 ID 수집 (양쪽 노드)
      const entitiesWithRelations = new Set<string>();
      Object.values(newHyperedges).forEach(edge => {
        edge.entities.forEach(entityId => entitiesWithRelations.add(entityId));
      });

      // 7. entities에서 관계가 없는 엔티티 삭제
      const finalEntities: typeof knowledgeGraph.entities = {};
      Object.entries(newEntities).forEach(([entityId, entity]) => {
        // 관계가 있거나 장면이 남아있는 엔티티만 유지
        const hasRelations = entitiesWithRelations.has(entityId);
        const hasScenes = entity.scenes && entity.scenes.length > 0;
        if (hasRelations || hasScenes) {
          finalEntities[entityId] = entity;
        }
      });

      // 8. sourceFiles에서 해당 파일 제거 + 파일 ID 재정렬
      // 기존 파일 ID → 새 파일 ID 매핑 생성
      const fileIdMapping: Record<string, string> = {};
      const newSourceFiles: SourceFile[] = remainingSourceFiles.map((file, index) => {
        const newId = `F${String(index + 1).padStart(4, '0')}`;
        fileIdMapping[file.id] = newId;
        console.log(`[SourceTextView] 파일 ID 재매핑: ${file.id} → ${newId}`);
        return {
          ...file,
          id: newId,
        };
      });

      // 9. 장면의 sourceFileId도 새 ID로 업데이트
      Object.keys(newSnapshots).forEach(sceneId => {
        const scene = newSnapshots[sceneId];
        if (scene.sourceFileId && fileIdMapping[scene.sourceFileId]) {
          newSnapshots[sceneId] = {
            ...scene,
            sourceFileId: fileIdMapping[scene.sourceFileId],
          };
        }
      });

      // 10. 새 지식 그래프 생성
      // 11. 검증 결과 정리 (삭제된 파일 제거 + 파일 ID 재매핑)
      const oldValidationResults = knowledgeGraph.validationResults || {};
      const newValidationResults: Record<string, FileValidationResult> = {};
      Object.entries(oldValidationResults).forEach(([oldFileId, result]) => {
        if (oldFileId === fileId) return; // 삭제된 파일 제외
        const newId = fileIdMapping[oldFileId];
        if (newId) {
          newValidationResults[newId] = {
            ...result,
            fileId: newId,
            comparedWith: result.comparedWith
              .filter((id) => id !== fileId)
              .map((id) => fileIdMapping[id] || id),
          };
        }
      });

      const updatedGraph: NovelKnowledgeGraph = {
        ...knowledgeGraph,
        metadata: {
          ...knowledgeGraph.metadata,
          sourceFiles: newSourceFiles,
          updatedAt: new Date().toISOString(),
        },
        entities: finalEntities,
        hyperedges: newHyperedges,
        snapshots: newSnapshots,
        validationResults: newValidationResults,
        stats: {
          ...knowledgeGraph.stats,
          totalEntities: Object.keys(finalEntities).length,
          totalEdges: Object.keys(newHyperedges).length,
        },
      };

      // 12. 서버에 업데이트
      await updateKnowledgeGraph(currentDataId, updatedGraph);

      // 13. 스토어 업데이트
      setKnowledgeGraph(updatedGraph, undefined, currentDataId);

      const deletedEntities = Object.keys(knowledgeGraph.entities).length - Object.keys(finalEntities).length;
      const deletedEdges = Object.keys(knowledgeGraph.hyperedges).length - Object.keys(newHyperedges).length;
      console.log(`[SourceTextView] 파일 삭제 완료: ${fileName}, 삭제된 장면: ${scenesToDelete.size}개, 삭제된 엔티티: ${deletedEntities}개, 삭제된 관계: ${deletedEdges}개`);
    } catch (error) {
      console.error('[SourceTextView] 파일 삭제 실패:', error);
      alert('파일 삭제에 실패했습니다.');
    } finally {
      setDeletingFileId(null);
      setConfirmDeleteId(null);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph]);

  // 파일 순서 변경 핸들러 (위로/아래로 이동)
  const handleMoveFile = useCallback(async (fileIndex: number, direction: 'up' | 'down') => {
    if (!knowledgeGraph || !currentDataId) return;

    const currentFiles = knowledgeGraph.metadata.sourceFiles || [];
    if (currentFiles.length < 2) return;

    const targetIndex = direction === 'up' ? fileIndex - 1 : fileIndex + 1;
    if (targetIndex < 0 || targetIndex >= currentFiles.length) return;

    const fileA = currentFiles[fileIndex];
    const fileB = currentFiles[targetIndex];

    setMovingFileId(fileA.id);
    try {
      console.log(`[SourceTextView] 파일 순서 변경: ${fileA.fileName} ↔ ${fileB.fileName}`);

      // 1. sourceFiles 배열 순서 변경
      const newSourceFiles: SourceFile[] = [...currentFiles];
      newSourceFiles[fileIndex] = fileB;
      newSourceFiles[targetIndex] = fileA;

      // 2. 파일명 → 파일 ID 매핑 생성 (scenesByFile과 동일한 로직)
      const fileNameToId: Record<string, string> = {};
      currentFiles.forEach(f => {
        fileNameToId[f.fileName] = f.id;
      });

      // 장면 → 파일 ID 매핑 함수
      const getFileIdForScene = (scene: SceneSnapshot): string | null => {
        // 1. sourceFileId가 있으면 그걸 사용
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

      // 3. 장면 order 재계산
      // 모든 장면을 order 순으로 정렬 후 sourceFiles 순서대로 재배치
      const newSnapshots = { ...knowledgeGraph.snapshots };

      // 새 sourceFiles 순서대로 모든 장면 수집
      const allScenesInNewOrder: SceneSnapshot[] = [];
      for (const file of newSourceFiles) {
        const fileScenes = Object.values(knowledgeGraph.snapshots)
          .filter(scene => getFileIdForScene(scene) === file.id)
          .sort((a, b) => a.order - b.order);
        allScenesInNewOrder.push(...fileScenes);
        console.log(`[SourceTextView] 파일 ${file.fileName} 장면: ${fileScenes.map(s => s.sceneId).join(', ')}`);
      }

      // 기존 order → 새 order 매핑 생성
      const orderMapping: Record<number, number> = {};
      allScenesInNewOrder.forEach((scene, idx) => {
        orderMapping[scene.order] = idx + 1;
      });

      // "장면 N" 패턴을 새 order로 변환하는 함수
      const updateSceneReferences = (text: string | null | undefined): string | null => {
        if (!text) return text as null;
        return text.replace(/장면\s*(\d+)/g, (match, num) => {
          const oldOrder = parseInt(num);
          const newOrder = orderMapping[oldOrder];
          if (newOrder !== undefined) {
            return `장면 ${newOrder}`;
          }
          return match; // 매핑 없으면 그대로
        });
      };

      // 파일 인덱스 → chapterNumber 매핑 생성
      const fileIdToChapterNumber: Record<string, number> = {};
      newSourceFiles.forEach((file, idx) => {
        fileIdToChapterNumber[file.id] = idx + 1;
      });

      // 연속된 order 재부여 (1부터 시작) + chapterNumber도 파일 순서에 맞게 업데이트
      allScenesInNewOrder.forEach((scene, idx) => {
        const fileId = getFileIdForScene(scene);
        const newChapterNumber = fileId ? fileIdToChapterNumber[fileId] : scene.chapterNumber;
        const newOrder = idx + 1;
        const updatedScene = {
          ...newSnapshots[scene.sceneId],
          order: newOrder,
          chapterNumber: newChapterNumber ?? scene.chapterNumber,
        };
        // time 필드에서 "장면 N" 패턴 업데이트
        if (updatedScene.time) {
          updatedScene.time = updateSceneReferences(updatedScene.time) || updatedScene.time;
        }
        console.log(`[SourceTextView] 장면 업데이트: ${scene.sceneId} order ${scene.order}→${newOrder}, chapter ${scene.chapterNumber}→${newChapterNumber}`);
        newSnapshots[scene.sceneId] = updatedScene;
      });

      // 최종 확인용 로그
      console.log(`[SourceTextView] 업데이트된 snapshots:`, Object.values(newSnapshots).map(s => `${s.sceneId}(order=${s.order}, ch=${s.chapterNumber})`).join(', '));
      console.log(`[SourceTextView] 새 장면 순서: ${allScenesInNewOrder.map(s => `${s.sceneId}(${s.order}→${allScenesInNewOrder.indexOf(s) + 1})`).join(', ')}`)
      console.log(`[SourceTextView] order 매핑: ${JSON.stringify(orderMapping)}`)

      // 4. hyperedges의 statement 필드도 업데이트 (장면 번호 텍스트 포함)
      const newHyperedges = { ...knowledgeGraph.hyperedges };
      Object.keys(newHyperedges).forEach(edgeId => {
        const edge = newHyperedges[edgeId];
        if (edge.statement) {
          const updatedStatement = updateSceneReferences(edge.statement);
          if (updatedStatement && updatedStatement !== edge.statement) {
            newHyperedges[edgeId] = { ...edge, statement: updatedStatement };
          }
        }
      });

      // 5. 검증 결과 - 기존 결과 유지 (둘 다 통과면 순서 바꿔도 OK)
      const newValidationResults: Record<string, FileValidationResult> = {};
      newSourceFiles.forEach((file, idx) => {
        if (idx === 0) {
          // 첫 파일은 항상 기준
          newValidationResults[file.id] = {
            fileId: file.id,
            status: 'passed',
            validatedAt: new Date().toISOString(),
            issues: [],
            comparedWith: [],
          };
        } else {
          // 기존 결과 유지
          const oldResult = knowledgeGraph.validationResults?.[file.id];
          if (oldResult) {
            newValidationResults[file.id] = oldResult;
          }
        }
      });

      // 6. 새 지식 그래프 생성
      const updatedGraph: NovelKnowledgeGraph = {
        ...knowledgeGraph,
        metadata: {
          ...knowledgeGraph.metadata,
          sourceFiles: newSourceFiles,
          updatedAt: new Date().toISOString(),
        },
        snapshots: newSnapshots,
        hyperedges: newHyperedges,
        validationResults: newValidationResults,
      };

      // 7. 서버에 업데이트
      await updateKnowledgeGraph(currentDataId, updatedGraph);

      // 8. 스토어 업데이트
      setKnowledgeGraph(updatedGraph, undefined, currentDataId);

      console.log(`[SourceTextView] 파일 순서 변경 완료`);
    } catch (error) {
      console.error('[SourceTextView] 파일 순서 변경 실패:', error);
      alert('파일 순서 변경에 실패했습니다.');
    } finally {
      setMovingFileId(null);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph]);

  // 파일 검증 핸들러 - 단순화
  const handleValidateFile = async (fileId: string) => {
    if (!knowledgeGraph || !currentDataId || isValidating) return;

    setIsValidating(true);
    setValidatingFileId(fileId);

    try {
      const result = await validateFile(knowledgeGraph, fileId, {
        apiKey: localStorage.getItem('OPENROUTER_API_KEY') || undefined,
        model: knowledgeGraph.metadata.model,
      });

      // 결과 저장
      await saveValidationResult(fileId, result);

      if (result.status === 'failed') {
        setExpandedIssues(prev => new Set([...prev, fileId]));
      }

      return result;
    } catch (error) {
      console.error('[validation] 검증 실패:', error);
    } finally {
      setIsValidating(false);
      setValidatingFileId(null);
    }
  };

  // 전체/이어서 검증 핸들러 - 단순화
  const handleValidateAll = async (continueFromLast: boolean = false) => {
    if (!knowledgeGraph || !currentDataId || isValidating || isValidatingAll) return;

    const files = knowledgeGraph.metadata.sourceFiles || [];
    if (files.length <= 1) return;

    setIsValidatingAll(true);
    abortValidationRef.current = false;

    try {
      // 시작 인덱스: 처음부터면 1, 이어서면 통과 안 된 첫 번째 파일
      let startIndex = 1;
      if (continueFromLast) {
        for (let i = 1; i < files.length; i++) {
          const result = knowledgeGraph.validationResults?.[files[i].id];
          if (!result || result.status !== 'passed') {
            startIndex = i;
            break;
          }
        }
      }

      for (let i = startIndex; i < files.length; i++) {
        if (abortValidationRef.current) break;

        const file = files[i];
        setValidatingFileId(file.id);
        setIsValidating(true);

        // 검증 실행
        const result = await validateFile(knowledgeGraph, file.id, {
          apiKey: localStorage.getItem('OPENROUTER_API_KEY') || undefined,
          model: knowledgeGraph.metadata.model,
        });

        // 결과 저장
        await saveValidationResult(file.id, result);

        if (result.status === 'failed') {
          setExpandedIssues(prev => new Set([...prev, file.id]));
          break;
        }
      }
    } catch (error) {
      console.error('[validation] 전체 검증 중 오류:', error);
    } finally {
      setIsValidating(false);
      setValidatingFileId(null);
      setIsValidatingAll(false);
    }
  };

  // 검증 중단
  const handleAbortValidation = () => {
    abortValidationRef.current = true;
  };

  // 텍스트 수정 시작
  const handleStartEdit = (fileId: string, text: string) => {
    setEditingFileId(fileId);
    setEditingText(text);
  };

  // 텍스트 수정 취소
  const handleCancelEdit = () => {
    setEditingFileId(null);
    setEditingText('');
  };

  // 텍스트 수정 저장 + 재분석
  const handleSaveEdit = async (fileId: string) => {
    if (!knowledgeGraph || !currentDataId) return;

    const currentFiles = knowledgeGraph.metadata.sourceFiles || [];
    const fileIndex = currentFiles.findIndex(f => f.id === fileId);
    if (fileIndex < 0) return;

    const file = currentFiles[fileIndex];
    if (file.text === editingText) {
      // 변경 없음
      handleCancelEdit();
      return;
    }

    setIsSavingEdit(true);
    try {
      console.log(`[SourceTextView] 텍스트 수정 시작: ${file.fileName} (위치: ${fileIndex})`);

      // 1. 해당 파일 삭제 (handleDeleteFile 로직 사용)
      await handleDeleteFile(fileId, file.fileName);

      // 2. 삭제 후 최신 상태 가져오기
      const afterDeleteGraph = useStore.getState().knowledgeGraph;

      // 3. 수정된 텍스트로 재분석 (파일이 맨 뒤에 추가됨)
      console.log(`[SourceTextView] 재분석 시작: ${file.fileName}`);
      handleCancelEdit(); // 편집 모드 종료 (UI 갱신)

      await executeAddFile(editingText, file.fileName, afterDeleteGraph);

      // 3. 재분석 완료 후 파일을 원래 위치로 이동
      // (executeAddFile이 완료되면 store가 업데이트되므로 최신 상태 사용)
      const state = useStore.getState();
      const updatedGraph = state.knowledgeGraph;
      const updatedDataId = state.currentDataId;

      if (updatedGraph && updatedDataId) {
        const updatedFiles = updatedGraph.metadata.sourceFiles || [];
        const newFileIndex = updatedFiles.findIndex(f => f.fileName === file.fileName);

        // 새로 추가된 파일이 맨 뒤에 있고, 원래 위치와 다르면 이동
        if (newFileIndex >= 0 && newFileIndex !== fileIndex && newFileIndex === updatedFiles.length - 1) {
          console.log(`[SourceTextView] 파일 원래 위치로 이동: ${newFileIndex} → ${fileIndex}`);

          // 파일을 맨 뒤에서 원래 위치로 이동
          const reorderedFiles = [...updatedFiles];
          const [movedFile] = reorderedFiles.splice(newFileIndex, 1);
          reorderedFiles.splice(fileIndex, 0, movedFile);

          // 파일 ID 재정렬
          const reorderedWithIds = reorderedFiles.map((f, idx) => ({
            ...f,
            id: `F${String(idx + 1).padStart(4, '0')}`,
          }));

          // 파일명 → 파일 ID 매핑 (reorderedFiles 기준)
          const fileNameToNewId: Record<string, string> = {};
          reorderedWithIds.forEach(f => {
            fileNameToNewId[f.fileName] = f.id;
          });

          // 장면 → 파일 ID 매핑 함수 (파일명 기준)
          const getFileIdForScene = (scene: SceneSnapshot): string | null => {
            if (scene.sourceFile && fileNameToNewId[scene.sourceFile]) {
              return fileNameToNewId[scene.sourceFile];
            }
            // sourceFileId가 있으면 매핑
            if (scene.sourceFileId) {
              const oldFile = updatedFiles.find(f => f.id === scene.sourceFileId);
              if (oldFile && fileNameToNewId[oldFile.fileName]) {
                return fileNameToNewId[oldFile.fileName];
              }
            }
            return null;
          };

          // 새 sourceFiles 순서대로 모든 장면 수집 + order 재계산
          const allScenesInNewOrder: SceneSnapshot[] = [];
          for (const f of reorderedWithIds) {
            const fileScenes = Object.values(updatedGraph.snapshots)
              .filter(scene => {
                const sceneFileId = getFileIdForScene(scene);
                return sceneFileId === f.id;
              })
              .sort((a, b) => a.order - b.order);
            allScenesInNewOrder.push(...fileScenes);
            console.log(`[SourceTextView] 파일 ${f.fileName} 장면: ${fileScenes.map(s => s.sceneId).join(', ')}`);
          }

          // 기존 order → 새 order 매핑 생성
          const orderMapping: Record<number, number> = {};
          allScenesInNewOrder.forEach((scene, idx) => {
            orderMapping[scene.order] = idx + 1;
          });

          // "장면 N" 패턴을 새 order로 변환하는 함수
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

          // 파일 ID → chapterNumber 매핑
          const fileIdToChapterNumber: Record<string, number> = {};
          reorderedWithIds.forEach((f, idx) => {
            fileIdToChapterNumber[f.id] = idx + 1;
          });

          // 장면 order + sourceFileId + chapterNumber 업데이트
          const reorderedSnapshots: Record<string, SceneSnapshot> = {};
          allScenesInNewOrder.forEach((scene, idx) => {
            const newFileId = getFileIdForScene(scene);
            const newChapterNumber = newFileId ? fileIdToChapterNumber[newFileId] : scene.chapterNumber;
            const newOrder = idx + 1;
            const updatedScene = {
              ...scene,
              order: newOrder,
              sourceFileId: newFileId || scene.sourceFileId,
              chapterNumber: newChapterNumber ?? scene.chapterNumber,
            };
            // time 필드에서 "장면 N" 패턴 업데이트
            if (updatedScene.time) {
              updatedScene.time = updateSceneReferences(updatedScene.time) || updatedScene.time;
            }
            console.log(`[SourceTextView] 장면 업데이트: ${scene.sceneId} order ${scene.order}→${newOrder}`);
            reorderedSnapshots[scene.sceneId] = updatedScene;
          });

          // hyperedges의 statement 필드도 업데이트
          const newHyperedges = { ...updatedGraph.hyperedges };
          Object.keys(newHyperedges).forEach(edgeId => {
            const edge = newHyperedges[edgeId];
            if (edge.statement) {
              const updatedStatement = updateSceneReferences(edge.statement);
              if (updatedStatement && updatedStatement !== edge.statement) {
                newHyperedges[edgeId] = { ...edge, statement: updatedStatement };
              }
            }
          });

          // 검증 결과 초기화 (fileIndex 이후)
          const newValidationResults: Record<string, FileValidationResult> = {};
          reorderedWithIds.forEach((f, idx) => {
            if (idx < fileIndex) {
              // 이전 파일들의 검증 결과 유지 (ID 매핑 적용)
              const oldFile = updatedFiles.find(uf => uf.fileName === f.fileName);
              if (oldFile && updatedGraph.validationResults?.[oldFile.id]) {
                newValidationResults[f.id] = {
                  ...updatedGraph.validationResults[oldFile.id],
                  fileId: f.id,
                };
              }
            }
          });

          const finalGraph: NovelKnowledgeGraph = {
            ...updatedGraph,
            metadata: {
              ...updatedGraph.metadata,
              sourceFiles: reorderedWithIds,
              updatedAt: new Date().toISOString(),
            },
            snapshots: reorderedSnapshots,
            hyperedges: newHyperedges,
            validationResults: newValidationResults,
          };

          await updateKnowledgeGraph(updatedDataId, finalGraph);
          setKnowledgeGraph(finalGraph, undefined, updatedDataId);

          console.log(`[SourceTextView] 텍스트 수정 + 재분석 + 위치 복원 완료: ${file.fileName}`);
        } else {
          console.log(`[SourceTextView] 텍스트 수정 + 재분석 완료: ${file.fileName}`);
        }
      }
    } catch (error) {
      console.error('[SourceTextView] 텍스트 수정 실패:', error);
      alert('텍스트 수정에 실패했습니다.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  return {
    // Store state
    knowledgeGraph,
    isValidating,
    validatingFileId,

    // Local state
    expandedFiles,
    searchQuery,
    setSearchQuery,
    copiedId,
    deletingFileId,
    confirmDeleteId,
    setConfirmDeleteId,
    movingFileId,
    expandedIssues,
    setExpandedIssues,
    isValidatingAll,
    editingFileId,
    editingText,
    setEditingText,
    isSavingEdit,
    isReanalyzing,
    reanalyzeProgress,

    // Computed
    sourceFiles,
    scenesByFile,
    filteredFiles,

    // Functions
    getValidationStatus,
    saveValidationResult,
    highlightText,
    toggleFile,
    toggleAll,
    copyText,
    handleDeleteFile,
    handleMoveFile,
    handleValidateFile,
    handleValidateAll,
    handleAbortValidation,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
  };
}
