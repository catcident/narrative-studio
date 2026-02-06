/**
 * 원본 텍스트 보기 컴포넌트
 * 업로드된 소스 파일들의 원문을 볼 수 있음
 * 각 파일에서 추출된 장면 목록도 표시
 */

import { useState, useMemo, useCallback } from 'react';
import { FileText, ChevronDown, ChevronRight, Search, Copy, Check, Film, Trash2, ArrowUp, ArrowDown, Shield, ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, AlertTriangle } from 'lucide-react';
import { useStore, useValidationResults, useIsValidating, useValidatingFileId } from '../store';
import { updateKnowledgeGraph } from '../services/storage';
import { validateFile, invalidateFilesAfter } from '../services/validation';
import type { SceneSnapshot, NovelKnowledgeGraph, SourceFile, ValidationStatus, FileValidationResult } from '../types';

export function SourceTextView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const currentDataId = useStore((s) => s.currentDataId);
  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const validationResults = useValidationResults();
  const isValidating = useIsValidating();
  const validatingFileId = useValidatingFileId();
  const setValidationResults = useStore((s) => s.setValidationResults);
  const updateValidationResult = useStore((s) => s.updateValidationResult);
  const setIsValidating = useStore((s) => s.setIsValidating);
  const setValidatingFileId = useStore((s) => s.setValidatingFileId);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [movingFileId, setMovingFileId] = useState<string | null>(null);
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

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
        stats: {
          ...knowledgeGraph.stats,
          totalEntities: Object.keys(finalEntities).length,
          totalEdges: Object.keys(newHyperedges).length,
        },
      };

      // 11. 서버에 업데이트
      await updateKnowledgeGraph(currentDataId, updatedGraph);

      // 12. 스토어 업데이트
      setKnowledgeGraph(updatedGraph, undefined, currentDataId);

      const deletedEntities = Object.keys(knowledgeGraph.entities).length - Object.keys(finalEntities).length;
      const deletedEdges = Object.keys(knowledgeGraph.hyperedges).length - Object.keys(newHyperedges).length;
      console.log(`[SourceTextView] 파일 삭제 완료: ${fileName}, 삭제된 장면: ${scenesToDelete.size}개, 삭제된 엔티티: ${deletedEntities}개, 삭제된 관계: ${deletedEdges}개`);

      // 13. 검증 결과 정리 (삭제된 파일 제거 + 파일 ID 재매핑)
      const newValidationResults = new Map<string, FileValidationResult>();
      validationResults.forEach((result, oldFileId) => {
        if (oldFileId === fileId) return; // 삭제된 파일 제외
        const newId = fileIdMapping[oldFileId];
        if (newId) {
          newValidationResults.set(newId, {
            ...result,
            fileId: newId,
            comparedWith: result.comparedWith
              .filter((id) => id !== fileId)
              .map((id) => fileIdMapping[id] || id),
          });
        }
      });
      setValidationResults(newValidationResults);
    } catch (error) {
      console.error('[SourceTextView] 파일 삭제 실패:', error);
      alert('파일 삭제에 실패했습니다.');
    } finally {
      setDeletingFileId(null);
      setConfirmDeleteId(null);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph, validationResults, setValidationResults]);

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

      // 5. 새 지식 그래프 생성
      const updatedGraph: NovelKnowledgeGraph = {
        ...knowledgeGraph,
        metadata: {
          ...knowledgeGraph.metadata,
          sourceFiles: newSourceFiles,
          updatedAt: new Date().toISOString(),
        },
        snapshots: newSnapshots,
        hyperedges: newHyperedges,
      };

      // 5. 서버에 업데이트
      await updateKnowledgeGraph(currentDataId, updatedGraph);

      // 6. 스토어 업데이트
      setKnowledgeGraph(updatedGraph, undefined, currentDataId);

      // 7. 검증 결과 초기화 (순서 변경 시 전체 재검증 필요)
      // 첫 번째 파일만 passed 유지, 나머지는 pending으로
      const newValidationResults = new Map<string, FileValidationResult>();
      newSourceFiles.forEach((file, idx) => {
        newValidationResults.set(file.id, {
          fileId: file.id,
          status: idx === 0 ? 'passed' : 'pending',
          validatedAt: idx === 0 ? new Date().toISOString() : null,
          issues: [],
          comparedWith: [],
        });
      });
      setValidationResults(newValidationResults);

      console.log(`[SourceTextView] 파일 순서 변경 완료`);
    } catch (error) {
      console.error('[SourceTextView] 파일 순서 변경 실패:', error);
      alert('파일 순서 변경에 실패했습니다.');
    } finally {
      setMovingFileId(null);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph, setValidationResults]);

  // 파일 검증 핸들러
  const handleValidateFile = useCallback(async (fileId: string) => {
    if (!knowledgeGraph || isValidating) return;

    // API 키는 localStorage에서 가져오거나, 서버에서 환경변수 사용
    const apiKey = localStorage.getItem('OPENROUTER_API_KEY') || undefined;

    setIsValidating(true);
    setValidatingFileId(fileId);

    try {
      const result = await validateFile(knowledgeGraph, fileId, {
        apiKey,  // undefined면 서버에서 환경변수 사용
        model: knowledgeGraph.metadata.model,
        onProgress: (fId, status) => {
          console.log(`[validation] ${fId}: ${status}`);
        },
      });

      updateValidationResult(fileId, result);

      // 검증 실패 시 이후 파일들 invalidate
      if (result.status === 'failed') {
        const sourceFiles = knowledgeGraph.metadata.sourceFiles || [];
        const newResults = invalidateFilesAfter(validationResults, sourceFiles, fileId);
        setValidationResults(newResults);
      }

      console.log(`[validation] 검증 완료: ${fileId} - ${result.status}`);
    } catch (error) {
      console.error('[validation] 검증 실패:', error);
      updateValidationResult(fileId, {
        fileId,
        status: 'failed',
        validatedAt: new Date().toISOString(),
        issues: [{
          id: `${fileId}_error`,
          type: 'other',
          severity: 'error',
          description: '검증 중 오류가 발생했습니다.',
        }],
        comparedWith: [],
      });
    } finally {
      setIsValidating(false);
      setValidatingFileId(null);
    }
  }, [knowledgeGraph, isValidating, validationResults, setIsValidating, setValidatingFileId, updateValidationResult, setValidationResults]);

  // 검증 상태 아이콘 렌더링
  const renderValidationIcon = (fileId: string, fileIndex: number) => {
    // 첫 번째 파일은 검증 불필요
    if (fileIndex === 0) {
      return (
        <div className="p-1.5" title="기준 파일 (검증 불필요)">
          <Shield className="w-4 h-4 text-gray-300" />
        </div>
      );
    }

    const result = validationResults.get(fileId);
    const isCurrentlyValidating = validatingFileId === fileId;

    if (isCurrentlyValidating) {
      return (
        <div className="p-1.5" title="검증 중...">
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
        </div>
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
          className="p-1.5 hover:bg-gray-200 rounded transition-colors disabled:opacity-50"
          title="일관성 검증하기"
        >
          <ShieldQuestion className="w-4 h-4 text-gray-400 hover:text-blue-500" />
        </button>
      );
    }

    if (result.status === 'passed') {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleValidateFile(fileId);
          }}
          disabled={isValidating}
          className="p-1.5 hover:bg-green-100 rounded transition-colors"
          title="검증 통과 (다시 검증하려면 클릭)"
        >
          <ShieldCheck className="w-4 h-4 text-green-500" />
        </button>
      );
    }

    if (result.status === 'failed') {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            // 이슈 목록 토글
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
          className="p-1.5 hover:bg-red-100 rounded transition-colors"
          title={`검증 실패 (${result.issues.length}개 이슈) - 클릭하여 상세 보기`}
        >
          <ShieldAlert className="w-4 h-4 text-red-500" />
        </button>
      );
    }

    if (result.status === 'invalidated') {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleValidateFile(fileId);
          }}
          disabled={isValidating}
          className="p-1.5 hover:bg-yellow-100 rounded transition-colors"
          title="이전 파일 실패로 재검증 필요 (클릭하여 검증)"
        >
          <AlertTriangle className="w-4 h-4 text-yellow-500" />
        </button>
      );
    }

    return null;
  };

  // 이슈 목록 렌더링
  const renderIssues = (fileId: string) => {
    const result = validationResults.get(fileId);
    if (!result || result.issues.length === 0 || !expandedIssues.has(fileId)) {
      return null;
    }

    return (
      <div className="bg-red-50 border-t border-red-200 p-3">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="w-4 h-4 text-red-600" />
          <span className="text-sm font-medium text-red-800">
            검증 이슈 ({result.issues.length}개)
          </span>
          <button
            onClick={() => handleValidateFile(fileId)}
            disabled={isValidating}
            className="ml-auto text-xs text-red-600 hover:text-red-800 underline disabled:opacity-50"
          >
            다시 검증
          </button>
        </div>
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
      </div>
    );
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
      </div>

      {/* 파일 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredFiles.map((file, index) => {
          const isExpanded = expandedFiles.has(file.id);
          const isCopied = copiedId === file.id;
          const validationResult = validationResults.get(file.id);
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

                {/* 검증 상태 아이콘 */}
                <div onClick={(e) => e.stopPropagation()}>
                  {renderValidationIcon(file.id, index)}
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

              {/* 검증 이슈 목록 */}
              {renderIssues(file.id)}

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
