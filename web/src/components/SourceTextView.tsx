/**
 * 원본 텍스트 보기 컴포넌트
 * 업로드된 소스 파일들의 원문을 볼 수 있음
 * 각 파일에서 추출된 장면 목록도 표시
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { FileText, ChevronDown, ChevronRight, Search, Copy, Check, Film, Trash2, ArrowUp, ArrowDown, ShieldCheck, ShieldAlert, Loader2, AlertTriangle, PlayCircle } from 'lucide-react';
import { useStore, useIsValidating, useValidatingFileId } from '../store';
import { updateKnowledgeGraph } from '../services/storage';
import { validateFile, invalidateFilesAfter } from '../services/validation';
import type { SceneSnapshot, NovelKnowledgeGraph, SourceFile, ValidationStatus, FileValidationResult } from '../types';

export function SourceTextView() {
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

  // 검증 결과를 knowledgeGraph에서 직접 읽음 (store의 Map은 UI용)
  const getValidationStatus = (fileId: string): FileValidationResult | undefined => {
    return knowledgeGraph?.validationResults?.[fileId];
  };

  // 검증 결과 저장 - 단순하게 knowledgeGraph.validationResults에 저장
  const saveValidationResult = async (fileId: string, result: FileValidationResult) => {
    if (!knowledgeGraph || !currentDataId) return;

    const updatedGraph: NovelKnowledgeGraph = {
      ...knowledgeGraph,
      validationResults: {
        ...knowledgeGraph.validationResults,
        [fileId]: result,
      },
    };

    setKnowledgeGraph(updatedGraph);
    await updateKnowledgeGraph(currentDataId, updatedGraph);
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

      // 5. 검증 결과 초기화 (순서 변경 시 전체 재검증 필요)
      // 첫 번째 파일만 passed 유지, 나머지는 pending으로
      const newValidationResults: Record<string, FileValidationResult> = {};
      newSourceFiles.forEach((file, idx) => {
        newValidationResults[file.id] = {
          fileId: file.id,
          status: idx === 0 ? 'passed' : 'pending',
          validatedAt: idx === 0 ? new Date().toISOString() : null,
          issues: [],
          comparedWith: [],
        };
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

  // 검증 버튼 렌더링 (글자 버튼)
  const renderValidationButton = (fileId: string, fileIndex: number) => {
    // 첫 번째 파일은 기준 파일
    if (fileIndex === 0) {
      return (
        <span className="text-xs px-2 py-1 bg-gray-100 text-gray-400 rounded">
          기준
        </span>
      );
    }

    const result = getValidationStatus(fileId);
    const isCurrentlyValidating = validatingFileId === fileId;

    if (isCurrentlyValidating) {
      return (
        <span className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          검증중
        </span>
      );
    }

    if (!result || result.status === 'pending') {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleValidateFile(fileId);
          }}
          disabled={isValidating}
          className="text-xs px-2 py-1 bg-gray-100 hover:bg-blue-100 text-gray-600 hover:text-blue-600 rounded transition-colors disabled:opacity-50"
        >
          검증하기
        </button>
      );
    }

    if (result.status === 'passed') {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpandedIssues(prev => {
              const newSet = new Set(prev);
              if (newSet.has(fileId)) {
                newSet.delete(fileId);
              } else {
                newSet.add(fileId);
              }
              return newSet;
            });
          }}
          className="text-xs px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded transition-colors font-medium"
        >
          통과 {expandedIssues.has(fileId) ? '▲' : '▼'}
        </button>
      );
    }

    if (result.status === 'failed') {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpandedIssues(prev => {
              const newSet = new Set(prev);
              if (newSet.has(fileId)) {
                newSet.delete(fileId);
              } else {
                newSet.add(fileId);
              }
              return newSet;
            });
          }}
          className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors font-medium"
        >
          이슈 {result.issues.length}개 {expandedIssues.has(fileId) ? '▲' : '▼'}
        </button>
      );
    }

    if (result.status === 'invalidated') {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpandedIssues(prev => {
              const newSet = new Set(prev);
              if (newSet.has(fileId)) {
                newSet.delete(fileId);
              } else {
                newSet.add(fileId);
              }
              return newSet;
            });
          }}
          className="text-xs px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 rounded transition-colors font-medium"
        >
          재검증 필요 {expandedIssues.has(fileId) ? '▲' : '▼'}
        </button>
      );
    }

    return null;
  };

  // 검증 결과 패널 렌더링 (passed/failed 모두)
  const renderValidationPanel = (fileId: string, fileIndex: number) => {
    // 첫 번째 파일은 검증 패널 없음
    if (fileIndex === 0) return null;

    const result = getValidationStatus(fileId);
    if (!result || !expandedIssues.has(fileId)) return null;

    // passed 상태
    if (result.status === 'passed') {
      return (
        <div className="bg-green-50 border-t border-green-200 p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-green-600" />
            <span className="text-sm font-medium text-green-800">
              검증 통과
            </span>
            <span className="text-xs text-green-600">
              - 이전 {result.comparedWith.length}개 파일과 비교
            </span>
            <button
              onClick={() => handleValidateFile(fileId)}
              disabled={isValidating}
              className="ml-auto text-xs text-green-600 hover:text-green-800 underline disabled:opacity-50"
            >
              다시 검증
            </button>
          </div>
          {result.summary && (
            <p className="text-sm text-green-700 mt-2 bg-green-100 p-2 rounded">
              📋 {result.summary}
            </p>
          )}
          {result.validatedAt && (
            <p className="text-xs text-green-500 mt-1">
              검증 시간: {new Date(result.validatedAt).toLocaleString('ko-KR')}
            </p>
          )}
        </div>
      );
    }

    // failed 상태 (이슈가 있음)
    if (result.status === 'failed' && result.issues.length > 0) {
      return (
        <div className="bg-red-50 border-t border-red-200 p-3">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="w-4 h-4 text-red-600" />
            <span className="text-sm font-medium text-red-800">
              검증 이슈 ({result.issues.length}개)
            </span>
            <span className="text-xs text-red-500">
              - 이전 {result.comparedWith.length}개 파일과 비교
            </span>
            <button
              onClick={() => handleValidateFile(fileId)}
              disabled={isValidating}
              className="ml-auto text-xs text-red-600 hover:text-red-800 underline disabled:opacity-50"
            >
              다시 검증
            </button>
          </div>
          {result.summary && (
            <p className="text-sm text-red-700 mb-2 bg-red-100 p-2 rounded">
              📋 {result.summary}
            </p>
          )}
          <div className="space-y-2">
            {result.issues.map((issue) => (
              <div
                key={issue.id}
                className={`text-sm p-2 rounded ${
                  issue.severity === 'error'
                    ? 'bg-red-100 border border-red-300'
                    : 'bg-yellow-100 border border-yellow-300'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      issue.severity === 'error'
                        ? 'bg-red-200 text-red-800'
                        : 'bg-yellow-200 text-yellow-800'
                    }`}
                  >
                    {issue.severity === 'error' ? '오류' : '경고'}
                  </span>
                  <span
                    className="text-xs text-gray-500 px-1.5 py-0.5 bg-gray-100 rounded"
                  >
                    {issue.type.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="mt-1 text-gray-700">{issue.description}</p>
                {issue.suggestion && (
                  <p className="mt-1 text-gray-500 text-xs">
                    💡 {issue.suggestion}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-red-200">
            <button
              onClick={async () => {
                // 이슈를 유지하면서 passed로 변경
                const passedResult: FileValidationResult = {
                  ...result,
                  status: 'passed',
                };
                await saveValidationResult(fileId, passedResult);
                setExpandedIssues(prev => {
                  const newSet = new Set(prev);
                  newSet.delete(fileId);
                  return newSet;
                });
              }}
              className="text-xs px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded font-medium"
            >
              ✓ 확인 후 통과 처리
            </button>
            <span className="text-xs text-gray-500">
              이슈를 확인했고 문제없다고 판단하면 클릭
            </span>
          </div>
        </div>
      );
    }

    // invalidated 상태 - 이전 파일 검증 안 됨
    if (result.status === 'invalidated') {
      return (
        <div className="bg-yellow-50 border-t border-yellow-200 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800">
              재검증 필요
            </span>
            <span className="text-xs text-yellow-600">
              - 이전 파일이 아직 검증되지 않았습니다
            </span>
          </div>
          <p className="text-xs text-yellow-600 mt-2">
            앞 파일들을 먼저 검증한 후 이 파일을 검증해주세요.
          </p>
          <button
            onClick={() => handleValidateFile(fileId)}
            disabled={isValidating}
            className="mt-2 text-xs px-3 py-1 bg-yellow-200 hover:bg-yellow-300 text-yellow-800 rounded disabled:opacity-50"
          >
            그래도 검증하기
          </button>
        </div>
      );
    }

    return null;
  };

  if (sourceFiles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 text-gray-400">
        <div className="text-center">
          <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" aria-hidden="true" />
          <p>업로드된 파일이 없습니다</p>
          <p className="text-sm mt-1">파일을 업로드하면 원본 텍스트를 볼 수 있습니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 헤더 */}
      <div className="flex-shrink-0 p-4 border-b bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <FileText className="w-5 h-5" aria-hidden="true" />
            원본 텍스트
            <span className="text-sm font-normal text-gray-500">
              ({sourceFiles.length}개 파일)
            </span>
          </h2>
          <button
            onClick={toggleAll}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            {expandedFiles.size === sourceFiles.length ? '모두 접기' : '모두 펼치기'}
          </button>
        </div>

        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
          <input
            type="text"
            placeholder="텍스트 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 전체 검증 버튼 */}
        {sourceFiles.length > 1 && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
            {isValidatingAll ? (
              <>
                <button
                  onClick={handleAbortValidation}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm font-medium"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  검증 중단
                </button>
                <span className="text-xs text-gray-500">
                  {validatingFileId && `검증 중: ${sourceFiles.find(f => f.id === validatingFileId)?.fileName || '...'}`}
                </span>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleValidateAll(false)}
                  disabled={isValidating}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-sm font-medium disabled:opacity-50"
                >
                  <PlayCircle className="w-4 h-4" />
                  처음부터 검증
                </button>
                <button
                  onClick={() => handleValidateAll(true)}
                  disabled={isValidating}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded text-sm font-medium disabled:opacity-50"
                >
                  <PlayCircle className="w-4 h-4" />
                  이어서 검증
                </button>
                <span className="text-xs text-gray-500 ml-auto">
                  {(() => {
                    const results = knowledgeGraph?.validationResults || {};
                    const passedCount = Object.values(results).filter(r => r.status === 'passed').length;
                    return passedCount > 0 ? `${passedCount}/${sourceFiles.length - 1}개 통과` : '';
                  })()}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 파일 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredFiles.map((file, index) => {
          const isExpanded = expandedFiles.has(file.id);
          const isCopied = copiedId === file.id;
          const validationResult = getValidationStatus(file.id);
          const validationStatus = validationResult?.status;

          // 검증 상태에 따른 배경색
          const getBorderColor = () => {
            if (index === 0) return 'border-gray-200'; // 첫 파일은 기준
            if (validationStatus === 'passed') return 'border-green-300 bg-green-50';
            if (validationStatus === 'failed') return 'border-red-300 bg-red-50';
            if (validationStatus === 'invalidated') return 'border-yellow-300 bg-yellow-50';
            return 'border-gray-200';
          };

          return (
            <div
              key={file.id}
              className={`border rounded-lg overflow-hidden shadow-sm ${getBorderColor()}`}
            >
              {/* 파일 헤더 */}
              <button
                onClick={() => toggleFile(file.id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-opacity-80 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                      #{index + 1}
                    </span>
                    <span className="font-medium text-gray-800 truncate">
                      {file.fileName}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {file.charCount.toLocaleString()}자 ·
                    {new Date(file.uploadedAt).toLocaleString('ko-KR', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>

                {/* 검증 상태 버튼 */}
                <div onClick={(e) => e.stopPropagation()}>
                  {renderValidationButton(file.id, index)}
                </div>

                {/* 순서 이동 버튼 */}
                {sourceFiles.length > 1 && (
                  <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleMoveFile(index, 'up')}
                      disabled={index === 0 || movingFileId === file.id}
                      className="p-0.5 hover:bg-gray-200 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="위로 이동"
                      aria-label="위로 이동"
                    >
                      <ArrowUp className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => handleMoveFile(index, 'down')}
                      disabled={index === sourceFiles.length - 1 || movingFileId === file.id}
                      className="p-0.5 hover:bg-gray-200 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="아래로 이동"
                      aria-label="아래로 이동"
                    >
                      <ArrowDown className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {/* 복사 버튼 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyText(file.id, file.text);
                  }}
                  className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                  title="텍스트 복사"
                  aria-label="텍스트 복사"
                >
                  {isCopied ? (
                    <Check className="w-4 h-4 text-green-600" aria-hidden="true" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-400" aria-hidden="true" />
                  )}
                </button>

                {/* 삭제 버튼 */}
                {confirmDeleteId === file.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleDeleteFile(file.id, file.fileName)}
                      disabled={deletingFileId === file.id}
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      {deletingFileId === file.id ? '삭제 중...' : '확인'}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(file.id);
                    }}
                    className="p-1.5 hover:bg-red-100 rounded transition-colors"
                    title="파일 삭제"
                    aria-label="파일 삭제"
                  >
                    <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" aria-hidden="true" />
                  </button>
                )}
              </button>

              {/* 검증 결과 패널 */}
              {renderValidationPanel(file.id, index)}

              {/* 파일 내용 */}
              {isExpanded && (
                <div className="border-t">
                  {/* 이 파일에서 추출된 장면들 */}
                  {(() => {
                    const scenes = scenesByFile[file.id] || [];
                    if (scenes.length > 0) {
                      return (
                        <div className="bg-blue-50 border-b p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Film className="w-4 h-4 text-blue-600" />
                            <span className="text-sm font-medium text-blue-800">
                              추출된 장면 ({scenes.length}개)
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {scenes.map(scene => (
                              <div
                                key={scene.sceneId}
                                className="text-xs bg-white border border-blue-200 rounded px-2 py-1 text-blue-700"
                                title={scene.summary}
                              >
                                <span className="font-medium">{scene.sceneId}</span>
                                {scene.location && (
                                  <span className="text-blue-500 ml-1">@ {scene.location}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div className="bg-gray-50">
                    <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-[500px] overflow-y-auto">
                      {searchQuery ? highlightText(file.text, searchQuery) : file.text}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredFiles.length === 0 && searchQuery && (
          <div className="text-center text-gray-500 py-8">
            "{searchQuery}"에 대한 검색 결과가 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
