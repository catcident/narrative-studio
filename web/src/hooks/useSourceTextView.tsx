/**
 * SourceTextView 컴포넌트의 상태 및 핸들러를 관리하는 커스텀 훅
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import { useStore, useIsValidating, useValidatingFileId, useBillingSubscription, useModels, useByokEnabled, useAuthEnabled } from '../store';
import { updateKnowledgeGraph } from '../services/storage';
import { validateFile } from '../services/validation';
import { hasApiKey, getApiKey } from '../services/extraction';
import { ensureSufficientBalance, holdCredits, finalizeHold, estimateValidationCost, checkCreditSufficiency, isBillingTestSubscription } from '../services/billing';
import { requestCreditConfirmation } from '../store';
import { useAddFileAnalysis } from './useAddFileAnalysis';
import {
  getScenesByFile,
  deleteFileFromGraph,
  buildMoveFileGraph,
  buildEditFileGraph,
} from '../services/knowledgeGraphUtils';
import type { NovelKnowledgeGraph, FileValidationResult, ChunkUsage } from '../types';

export function useSourceTextView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const currentDataId = useStore((s) => s.currentDataId);
  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const isValidating = useIsValidating();
  const validatingFileId = useValidatingFileId();
  const setIsValidating = useStore((s) => s.setIsValidating);
  const setValidatingFileId = useStore((s) => s.setValidatingFileId);
  const updateCreditBalance = useStore((s) => s.updateCreditBalance);
  const loadSubscription = useStore((s) => s.loadSubscription);
  const subscription = useBillingSubscription();
  const allModels = useModels();
  const byokEnabled = useByokEnabled();
  const authEnabled = useAuthEnabled();

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

  // 파일별 장면 매핑
  const scenesByFile = useMemo(() => {
    if (!knowledgeGraph?.snapshots) return {};
    return getScenesByFile(knowledgeGraph.snapshots, sourceFiles);
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
      if (newSet.has(fileId)) newSet.delete(fileId);
      else newSet.add(fileId);
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
      (f.text ?? '').toLowerCase().includes(query)
    );
  }, [sourceFiles, searchQuery]);

  // 파일 삭제 핸들러
  const handleDeleteFile = useCallback(async (fileId: string, fileName: string) => {
    if (!knowledgeGraph || !currentDataId) return;

    setDeletingFileId(fileId);
    try {
      const updatedGraph = deleteFileFromGraph(knowledgeGraph, fileId, fileName);
      await updateKnowledgeGraph(currentDataId, updatedGraph);
      setKnowledgeGraph(updatedGraph, undefined, currentDataId);
    } catch (err: unknown) {
      console.error('[SourceTextView] 파일 삭제 실패:', err);
      alert('파일 삭제에 실패했습니다.');
    } finally {
      setDeletingFileId(null);
      setConfirmDeleteId(null);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph]);

  // 파일 순서 변경 핸들러
  const handleMoveFile = useCallback(async (fileIndex: number, direction: 'up' | 'down') => {
    if (!knowledgeGraph || !currentDataId) return;

    const currentFiles = knowledgeGraph.metadata.sourceFiles || [];
    setMovingFileId(currentFiles[fileIndex]?.id || null);
    try {
      const updatedGraph = buildMoveFileGraph(knowledgeGraph, fileIndex, direction);
      if (!updatedGraph) return;
      await updateKnowledgeGraph(currentDataId, updatedGraph);
      setKnowledgeGraph(updatedGraph, undefined, currentDataId);
    } catch (err: unknown) {
      console.error('[SourceTextView] 파일 순서 변경 실패:', err);
      alert('파일 순서 변경에 실패했습니다.');
    } finally {
      setMovingFileId(null);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph]);

  // 파일 검증 핸들러 (hold/settle 패턴)
  const handleValidateFile = async (fileId: string) => {
    if (!knowledgeGraph || !currentDataId || isValidating) return;

    setIsValidating(true);
    setValidatingFileId(fileId);

    let holdToken: string | null = null;
    const chunkUsages: ChunkUsage[] = [];

    try {
      const isUsingPersonalKey = !isBillingTestSubscription(subscription) && byokEnabled && hasApiKey();
      const validationModel = knowledgeGraph.metadata.model;

      // 단일 파일 검증: LLM 호출 1회 (첫 파일은 자동 통과 — validateFile 내부 처리)
      if (!isUsingPersonalKey) {
        const estimatedCredits = estimateValidationCost(2, validationModel, allModels); // 최소 1회 호출

        const check = checkCreditSufficiency(subscription, authEnabled, estimatedCredits);
        if (check.level === 'blocked') throw new Error(check.message);
        if (check.level !== 'ok') {
          const confirmed = await requestCreditConfirmation({
            level: check.level,
            estimatedCredits,
            balance: subscription?.creditBalance ?? 0,
            operationName: '파일 검증',
            canResume: false,
          });
          if (!confirmed) return;
        }

        await ensureSufficientBalance(subscription, authEnabled);

        if (subscription && estimatedCredits > 0) {
          const holdAmount = check.level === 'warning'
            ? Math.min(estimatedCredits, subscription.creditBalance)
            : estimatedCredits;
          const holdResult = await holdCredits(holdAmount, validationModel || 'validation', 1);
          if (!holdResult.ok) {
            throw new Error(holdResult.status === 402 ? '크레딧이 부족합니다.' : '과금 시스템 오류가 발생했습니다.');
          }
          holdToken = holdResult.data.hold_token;
          if (holdResult.data.balance_after !== null) {
            updateCreditBalance(holdResult.data.balance_after);
          }
        }
      }

      const result = await validateFile(knowledgeGraph, fileId, {
        apiKey: getApiKey() || undefined,
        model: validationModel,
        onChunkBilling: (chunkIndex, billing) => {
          chunkUsages.push({
            chunkIndex,
            promptTokens: billing.prompt_tokens,
            completionTokens: billing.completion_tokens,
            model: billing.model,
          });
        },
      });

      if (holdToken) {
        await finalizeHold(holdToken, chunkUsages, `파일 검증: ${fileId}`, updateCreditBalance);
      }

      await saveValidationResult(fileId, result);

      if (result.status === 'failed') {
        setExpandedIssues(prev => new Set([...prev, fileId]));
      }

      return result;
    } catch (err: unknown) {
      console.error('[validation] 검증 실패:', err);
      if (holdToken) {
        await finalizeHold(holdToken, chunkUsages, `파일 검증 실패: ${fileId}`, updateCreditBalance);
      }
    } finally {
      setIsValidating(false);
      setValidatingFileId(null);
      loadSubscription();
    }
  };

  // 전체/이어서 검증 핸들러 (hold/settle 패턴)
  const handleValidateAll = async (continueFromLast: boolean = false) => {
    if (!knowledgeGraph || !currentDataId || isValidating || isValidatingAll) return;

    const files = knowledgeGraph.metadata.sourceFiles || [];
    if (files.length <= 1) return;

    setIsValidatingAll(true);
    abortValidationRef.current = false;

    try {
      const isUsingPersonalKey = !isBillingTestSubscription(subscription) && byokEnabled && hasApiKey();
      const validationModel = knowledgeGraph.metadata.model;

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

      const remainingFiles = files.length - startIndex;

      // 전체 검증 세션에 대해 hold
      let holdToken: string | null = null;
      const allChunkUsages: ChunkUsage[] = [];

      if (!isUsingPersonalKey) {
        // fileCount = remainingFiles + 1 (startIndex 이전 파일은 이미 통과)
        const estimatedCredits = estimateValidationCost(remainingFiles + 1, validationModel, allModels);

        const check = checkCreditSufficiency(subscription, authEnabled, estimatedCredits);
        if (check.level === 'blocked') throw new Error(check.message);
        if (check.level !== 'ok') {
          const confirmed = await requestCreditConfirmation({
            level: check.level,
            estimatedCredits,
            balance: subscription?.creditBalance ?? 0,
            operationName: '전체 검증',
            canResume: false,
          });
          if (!confirmed) {
            setIsValidatingAll(false);
            return;
          }
        }

        await ensureSufficientBalance(subscription, authEnabled);

        if (subscription && estimatedCredits > 0) {
          const holdAmount = check.level === 'warning'
            ? Math.min(estimatedCredits, subscription.creditBalance)
            : estimatedCredits;
          const holdResult = await holdCredits(holdAmount, validationModel || 'validation', remainingFiles);
          if (!holdResult.ok) {
            throw new Error(holdResult.status === 402 ? '크레딧이 부족합니다.' : '과금 시스템 오류가 발생했습니다.');
          }
          holdToken = holdResult.data.hold_token;
          if (holdResult.data.balance_after !== null) {
            updateCreditBalance(holdResult.data.balance_after);
          }
        }
      }

      let validationCompleted = false;
      try {
        for (let i = startIndex; i < files.length; i++) {
          if (abortValidationRef.current) break;

          const file = files[i];
          setValidatingFileId(file.id);
          setIsValidating(true);

          const result = await validateFile(knowledgeGraph, file.id, {
            apiKey: getApiKey() || undefined,
            model: validationModel,
            onChunkBilling: (chunkIndex, billing) => {
              allChunkUsages.push({
                chunkIndex: allChunkUsages.length,
                promptTokens: billing.prompt_tokens,
                completionTokens: billing.completion_tokens,
                model: billing.model,
              });
            },
          });

          await saveValidationResult(file.id, result);

          if (result.status === 'failed') {
            setExpandedIssues(prev => new Set([...prev, file.id]));
            break;
          }
        }
        validationCompleted = true;
      } catch (validationErr: unknown) {
        if (holdToken) {
          await finalizeHold(holdToken, allChunkUsages, '전체 검증 중단', updateCreditBalance);
        }
        throw validationErr;
      }

      if (holdToken && validationCompleted) {
        const desc = abortValidationRef.current ? '전체 검증 취소' : '전체 검증 완료';
        await finalizeHold(holdToken, allChunkUsages, desc, updateCreditBalance);
      }
    } catch (err: unknown) {
      console.error('[validation] 전체 검증 중 오류:', err);
    } finally {
      setIsValidating(false);
      setValidatingFileId(null);
      setIsValidatingAll(false);
      loadSubscription();
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
    if ((file.text ?? '') === editingText) {
      handleCancelEdit();
      return;
    }

    setIsSavingEdit(true);
    try {
      // 0. 삭제 전 검증 결과를 파일명 기반으로 보존 (삭제→재추가로 ID가 바뀌므로)
      const savedValidationByFileName: Record<string, NonNullable<typeof knowledgeGraph.validationResults>[string]> = {};
      for (const f of currentFiles) {
        const result = knowledgeGraph.validationResults?.[f.id];
        if (result) savedValidationByFileName[f.fileName] = result;
      }

      // 1. 해당 파일 삭제
      await handleDeleteFile(fileId, file.fileName);

      // 2. 삭제 후 최신 상태 가져오기
      const afterDeleteGraph = useStore.getState().knowledgeGraph;

      // 3. 수정된 텍스트로 재분석 (파일이 맨 뒤에 추가됨)
      handleCancelEdit();
      await executeAddFile(editingText, file.fileName, afterDeleteGraph);

      // 4. 재분석 완료 후 파일을 원래 위치로 이동
      const state = useStore.getState();
      const updatedGraph = state.knowledgeGraph;
      const updatedDataId = state.currentDataId;

      if (updatedGraph && updatedDataId) {
        const finalGraph = buildEditFileGraph(updatedGraph, fileIndex, file.fileName, savedValidationByFileName);
        await updateKnowledgeGraph(updatedDataId, finalGraph);
        setKnowledgeGraph(finalGraph, undefined, updatedDataId);
      }
    } catch (err: unknown) {
      console.error('[SourceTextView] 텍스트 수정 실패:', err);
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
