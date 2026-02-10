/**
 * 파일 업로드 컴포넌트
 */

import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useStore, useBillingSubscription, useModels, useByokEnabled, useCanBatchAnalysis, useAuthEnabled } from '../../store';
import { extractKnowledgeGraph, loadProgress, clearProgress, syncPartialAnalysis, hasApiKey, setApiKey, getApiKey, removeApiKey, validateApiKey, FILE_SEPARATOR, type ExtractionProgress } from '../../services/extraction';
import { saveKnowledgeGraph, getSavedKnowledgeGraphList } from '../../services/storage';
import { createBillingCallback, ensureSufficientBalance, holdCredits, finalizeHold, estimateUsageLocally, estimateUsageFromText, checkCreditSufficiency } from '../../services/billing';
import { requestCreditConfirmation } from '../../store';
import { createEntityEmbeddings, createChunkEmbeddings, type ChunkData } from '../../services/embedding';
import { readFileAsText } from '../../services/fileReader';
import { DEFAULT_MODEL, getAvailableModelIds } from '../../types';
import type { NovelKnowledgeGraph } from '../../types';
import { CHUNK_SIZE, CHUNK_OVERLAP } from '../../lib/modelCosts';
import { useAddFileAnalysis } from '../../hooks/useAddFileAnalysis';
import { UploadArea } from './UploadArea';
import { AnalysisPanel } from './AnalysisPanel';
import { ResumePanel } from './ResumePanel';
import { BatchAnalysisPanel } from '../BatchAnalysisPanel';

interface FileInfo {
  fileName: string;
  text: string;
}

/**
 * 여러 파일을 순차적으로 읽어 FileInfo 배열로 반환
 */
async function readFilesToInfos(
  files: File[],
  onProgress: (msg: string) => void,
): Promise<FileInfo[]> {
  const fileInfos: FileInfo[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress(`파일 읽는 중... (${i + 1}/${files.length}) ${file.name}`);
    const text = await readFileAsText(file, onProgress);
    fileInfos.push({ fileName: file.name, text });
  }
  return fileInfos;
}

/**
 * 여러 파일의 텍스트를 구분자로 병합
 */
function combineFileTexts(fileInfos: FileInfo[]): string {
  return fileInfos.map(f => f.text).join(FILE_SEPARATOR);
}

/**
 * 여러 파일일 때 sourceFiles 메타데이터 생성
 */
function buildSourceFiles(fileInfos: FileInfo[]): NovelKnowledgeGraph['metadata']['sourceFiles'] {
  if (fileInfos.length <= 1) return undefined;
  const now = new Date().toISOString();
  return fileInfos.map((f, i) => ({
    id: `F${String(i + 1).padStart(4, '0')}`,
    fileName: f.fileName,
    uploadedAt: now,
    text: f.text,
    charCount: f.text.length,
  }));
}

export function FileUpload() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const setLoading = useStore((s) => s.setLoading);
  const setError = useStore((s) => s.setError);
  const error = useStore((s) => s.error);
  const addChunkUsage = useStore((s) => s.addChunkUsage);
  const resetCurrentUsage = useStore((s) => s.resetCurrentUsage);
  const setShowUsageSummary = useStore((s) => s.setShowUsageSummary);
  const updateCreditBalance = useStore((s) => s.updateCreditBalance);
  const loadSubscription = useStore((s) => s.loadSubscription);
  const loadModels = useStore((s) => s.loadModels);
  const setPartialAnalysis = useStore((s) => s.setPartialAnalysis);
  const subscription = useBillingSubscription();
  const allModels = useModels();
  const byokEnabled = useByokEnabled();
  const canBatchAnalysis = useCanBatchAnalysis();
  const authEnabled = useAuthEnabled();
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState('');
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedSecondsRef = useRef(0);
  const [estimatedTotalSeconds, setEstimatedTotalSeconds] = useState<number | null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [savedProgress, setSavedProgress] = useState<ExtractionProgress | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasLocalKey, setHasLocalKey] = useState(false);
  const [hasEnvKey, setHasEnvKey] = useState(true);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [duplicateFileName, setDuplicateFileName] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFileText, setPendingFileText] = useState<string>('');
  const [bookTitle, setBookTitle] = useState('');
  const [bookAuthor, setBookAuthor] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [directText, setDirectText] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [existingTitles, setExistingTitles] = useState<string[]>([]);
  const [enableLorebook, setEnableLorebook] = useState(true);
  const [keyValidationLoading, setKeyValidationLoading] = useState(false);
  const [keyValidationError, setKeyValidationError] = useState<string | null>(null);
  const { addFile: addFileFromHook, execute: executeAddFromHook } = useAddFileAnalysis();
  const addToQueue = useStore((s) => s.addToQueue);

  // Pro+ 사용자만 개별 분석 가능 (PDF 내보내기 권한을 Pro+ 프록시로 사용)
  // 향후 백엔드에 별도 allow_batch_analysis 플래그 추가 시 교체 필요
  // canBatchAnalysis는 store.ts의 useCanBatchAnalysis 셀렉터에서 가져옴

  // 기존 지식그래프가 있으면 해당 모델로 고정
  const lockedModel = knowledgeGraph?.metadata?.model;
  const currentModel = lockedModel || selectedModel;

  // 이어하기 시 만료 모델 감지
  const savedModelId = savedProgress?.model;
  const invalidSavedModel = savedModelId
    ? !allModels.some((m) => m.id === savedModelId && m.available !== false)
    : false;

  // 플랜에 따른 모델 필터링 (available !== false인 모델만)
  const availableModels = useMemo(() => {
    const active = allModels.filter((m) => m.available !== false);
    if (subscription?.features?.models && subscription.features.models !== 'all') {
      return active.filter((m) => (subscription.features.models as string[]).includes(m.id));
    }
    return active;
  }, [allModels, subscription?.features?.models]);

  // 프로그레스 상태 일괄 초기화 헬퍼
  const resetProgressState = useCallback((checkSaved: boolean = false) => {
    setProgress('');
    setProgressCurrent(0);
    setProgressTotal(0);
    setSavedProgress(checkSaved ? loadProgress() : null);
  }, []);

  // 등록 가능 여부: 제목 + 작가 + (파일 또는 텍스트) 모두 필요 + 중복 아님
  const fullTitle = bookTitle.trim() && bookAuthor.trim()
    ? `${bookTitle.trim()} - ${bookAuthor.trim()}`
    : '';
  const isDuplicateTitle = fullTitle !== '' && existingTitles.includes(fullTitle);
  const canRegister = bookTitle.trim() !== '' &&
    bookAuthor.trim() !== '' &&
    (selectedFiles.length > 0 || directText.trim() !== '') &&
    !isDuplicateTitle;

  // 프로그레스 콜백 생성 헬퍼
  const makeProgressCallback = useCallback(
    (prefix?: string) =>
      (msg: string, current?: number, total?: number, estimatedRemainingSeconds?: number | null) => {
        setProgress(prefix ? `${prefix}: ${msg}` : msg);
        if (current !== undefined) setProgressCurrent(current);
        if (total !== undefined) setProgressTotal(total);
        if (estimatedRemainingSeconds !== undefined) {
          setEstimatedTotalSeconds(
            estimatedRemainingSeconds !== null
              ? Math.round(elapsedSecondsRef.current + estimatedRemainingSeconds)
              : null
          );
        }
      },
    [],
  );

  // ==================== 공통 분석 라이프사이클 ====================

  /**
   * 분석 공통 래퍼: loading/billing/error 라이프사이클을 한 곳에서 관리
   *
   * @param work  - 실제 분석 로직. 성공 시 true 반환
   */
  const runExtraction = useCallback(
    async (work: () => Promise<boolean>) => {
      setLocalLoading(true);
      setLoading(true);
      setError(null);
      resetCurrentUsage();

      try {
        const completed = await work();
        if (completed) {
          setShowUsageSummary(true);
        }
      } catch (err: unknown) {
        console.error('[extraction] error:', err);
        setError(err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.');
        syncPartialAnalysis(setPartialAnalysis);
        resetProgressState(true);
      } finally {
        setLocalLoading(false);
        setLoading(false);
        loadSubscription();
      }
    },
    [setLoading, setError, resetCurrentUsage, setShowUsageSummary, resetProgressState, loadSubscription, setPartialAnalysis],
  );

  // ==================== 초기화 ====================

  useEffect(() => {
    let cancelled = false;

    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        setHasEnvKey(data.hasEnvKey);
        useStore.getState().setAuthEnabled(data.authEnabled ?? false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[config] Failed to load app configuration:', err instanceof Error ? err.message : err);
        setHasEnvKey(false);
        useStore.getState().setAuthEnabled(false);
      });

    loadModels();

    setHasLocalKey(hasApiKey());
    setSavedProgress(loadProgress());

    getSavedKnowledgeGraphList()
      .then(list => { if (!cancelled) setExistingTitles(list.map(item => item.title)); })
      .catch(() => { if (!cancelled) setExistingTitles([]); });

    return () => { cancelled = true; };
  }, []);

  // 경과 시간 타이머
  useEffect(() => {
    if (!localLoading) {
      setElapsedSeconds(0);
      elapsedSecondsRef.current = 0;
      setEstimatedTotalSeconds(null);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(s => {
        const next = s + 1;
        elapsedSecondsRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [localLoading]);

  // ==================== 단순 핸들러 ====================

  const handleSaveApiKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) return;
    setKeyValidationLoading(true);
    setKeyValidationError(null);
    try {
      const result = await validateApiKey(key);
      if (result.valid) {
        setApiKey(key);
        setHasLocalKey(true);
        setApiKeyInput('');
        setShowApiKeyInput(false);
        setKeyValidationError(null);
      } else {
        setKeyValidationError(result.error || '유효하지 않은 API 키입니다.');
      }
    } finally {
      setKeyValidationLoading(false);
    }
  };

  const handleRemoveApiKey = () => {
    removeApiKey();
    setHasLocalKey(false);
    setApiKeyInput('');
  };

  const handleClearProgress = useCallback(() => {
    clearProgress();
    setSavedProgress(null);
    setPartialAnalysis(null);
  }, [setPartialAnalysis]);

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleMoveFileUp = useCallback((index: number) => {
    if (index === 0) return;
    setSelectedFiles(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveFileDown = useCallback((index: number) => {
    setSelectedFiles(prev => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedFiles([]);
    setDirectText('');
    setShowTextInput(false);
  }, []);

  // ==================== 분석 핸들러 ====================

  // 기존 그래프에 파일 드롭/선택 시 즉시 분석 (레거시 경로)
  const handleFiles = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    const sortedFiles = Array.from(files).sort((a, b) => a.name.localeCompare(b.name));

    await runExtraction(async () => {
      setProgress(`${sortedFiles.length}개 파일 읽는 중...`);
      const fileInfos = await readFilesToInfos(sortedFiles, setProgress);
      const combinedText = combineFileTexts(fileInfos);

      const combinedTitle = bookTitle.trim()
        ? bookTitle.trim()
        : (sortedFiles.length === 1
          ? sortedFiles[0].name.replace(/\.[^/.]+$/, '')
          : `${sortedFiles[0].name.replace(/\.[^/.]+$/, '')} 외 ${sortedFiles.length - 1}개`);

      if (!combinedText.trim()) {
        throw new Error('파일 내용이 비어있습니다.');
      }

      // 세션 hold: BYOK가 아닌 경우 잔액 확인 + billing 활성 시 hold
      const isUsingPersonalKey = byokEnabled && hasApiKey();
      let holdToken: string | null = null;

      if (!isUsingPersonalKey) {
        const estimate = subscription ? estimateUsageFromText(combinedText, currentModel, allModels, enableLorebook) : null;

        const check = checkCreditSufficiency(subscription, authEnabled, estimate?.estimated_credits);
        if (check.level === 'blocked') throw new Error(check.message);
        if (check.level !== 'ok') {
          const confirmed = await requestCreditConfirmation({
            level: check.level,
            estimatedCredits: estimate?.estimated_credits ?? 0,
            balance: subscription?.creditBalance ?? 0,
            operationName: '파일 분석',
            canResume: true,
          });
          if (!confirmed) return false;
        }

        await ensureSufficientBalance(subscription, authEnabled);

        if (subscription && estimate) {
          const holdAmount = check.level === 'warning'
            ? Math.min(estimate.estimated_credits, subscription.creditBalance)
            : estimate.estimated_credits;
          const holdResult = await holdCredits(holdAmount, currentModel, estimate.chunks);
          if (!holdResult.ok) {
            throw new Error(holdResult.status === 402 ? '크레딧이 부족합니다.' : '과금 시스템 오류가 발생했습니다.');
          }
          holdToken = holdResult.data.hold_token;
          if (holdResult.data.balance_after !== null) {
            updateCreditBalance(holdResult.data.balance_after);
          }
        }
      }

      let newKnowledgeGraph: NovelKnowledgeGraph;
      try {
        newKnowledgeGraph = await extractKnowledgeGraph({
          text: combinedText,
          title: combinedTitle,
          onProgress: makeProgressCallback(),
          model: currentModel,
          fileNames: sortedFiles.map(f => f.name),
          onChunkBilling: createBillingCallback(addChunkUsage),
          availableModelIds: getAvailableModelIds(allModels),
          enableLorebook,
        });
      } catch (extractionErr: unknown) {
        if (holdToken) {
          const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `분석 중단: ${combinedTitle}`, updateCreditBalance);
          if (settleResult.actualCredits !== null) {
            useStore.getState().setSettledCredits(settleResult.actualCredits);
          }
        }
        throw extractionErr;
      }

      if (holdToken) {
        const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `분석 완료: ${combinedTitle}`, updateCreditBalance);
        if (settleResult.actualCredits !== null) {
          useStore.getState().setSettledCredits(settleResult.actualCredits);
        }
      }

      const sourceFiles = buildSourceFiles(fileInfos);
      if (sourceFiles) {
        newKnowledgeGraph.metadata.sourceFiles = sourceFiles;
      }
      if (bookAuthor.trim()) {
        newKnowledgeGraph.metadata.author = bookAuthor.trim();
      }

      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      setBookTitle('');
      setBookAuthor('');
      setKnowledgeGraph(newKnowledgeGraph, combinedText, saved.id);
      syncPartialAnalysis(setPartialAnalysis, newKnowledgeGraph.metadata.title);
      resetProgressState();
      return true;
    });
  }, [runExtraction, makeProgressCallback, currentModel, addChunkUsage, updateCreditBalance, subscription, bookTitle, bookAuthor, setKnowledgeGraph, resetProgressState, allModels, setPartialAnalysis, byokEnabled, authEnabled, enableLorebook]);

  /**
   * handleDrop과 handleChange에서 공유하는 파일 처리 로직.
   * - knowledgeGraph가 있으면 handleFiles로 추가 분석
   * - 없으면 selectedFiles 상태에 저장만 함 (바로 분석하지 않음)
   */
  const processFileInput = useCallback((files: FileList) => {
    if (files.length === 0) return;

    // 파일 크기 제한 (플랜 features 기반)
    const maxFileSizeMb = subscription?.features?.max_file_size_mb ?? Infinity;
    if (maxFileSizeMb < Infinity) {
      const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
      const oversizedFiles = Array.from(files).filter(f => f.size > maxFileSizeBytes);
      if (oversizedFiles.length > 0) {
        setError(`파일 크기가 ${maxFileSizeMb}MB를 초과합니다. 상위 플랜에서 더 큰 파일을 분석할 수 있습니다.`);
        return;
      }
    }

    if (knowledgeGraph) {
      handleFiles(files);
      return;
    }

    setSelectedFiles(Array.from(files).sort((a, b) => a.name.localeCompare(b.name)));
    setDirectText('');
    setShowTextInput(false);
  }, [knowledgeGraph, handleFiles, subscription?.features?.max_file_size_mb, setError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    processFileInput(e.dataTransfer.files);
  }, [processFileInput]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFileInput(e.target.files);
    }
  }, [processFileInput]);

  // 이어하기
  const handleResume = useCallback(async () => {
    if (!savedProgress) return;

    setProgress(`이어하기: ${savedProgress.processedChunks}/${savedProgress.totalChunks}부터...`);

    await runExtraction(async () => {
      const isUsingPersonalKey = byokEnabled && hasApiKey();

      // 만료 모델이면 현재 선택된 모델로 override
      const resumeModel = invalidSavedModel ? currentModel : (savedProgress.model || currentModel);

      // 남은 청크에 대해서만 잔액 확인 + hold (billing 활성 시)
      let holdToken: string | null = null;
      if (!isUsingPersonalKey) {
        const remainingChunks = savedProgress.totalChunks - savedProgress.processedChunks;
        const resumeEnableLorebook = savedProgress.enableLorebook ?? true;
        const estimate = subscription && remainingChunks > 0
          ? estimateUsageLocally(remainingChunks * (CHUNK_SIZE - CHUNK_OVERLAP), resumeModel, allModels, resumeEnableLorebook)
          : null;

        const check = checkCreditSufficiency(subscription, authEnabled, estimate?.estimated_credits);
        if (check.level === 'blocked') throw new Error(check.message);
        if (check.level !== 'ok') {
          const confirmed = await requestCreditConfirmation({
            level: check.level,
            estimatedCredits: estimate?.estimated_credits ?? 0,
            balance: subscription?.creditBalance ?? 0,
            operationName: '이어하기',
            canResume: true,
          });
          if (!confirmed) return false;
        }

        await ensureSufficientBalance(subscription, authEnabled);

        if (subscription && estimate) {
          const holdAmount = check.level === 'warning'
            ? Math.min(estimate.estimated_credits, subscription.creditBalance)
            : estimate.estimated_credits;
          const holdResult = await holdCredits(holdAmount, resumeModel, remainingChunks);
          if (!holdResult.ok) {
            throw new Error(holdResult.status === 402 ? '크레딧이 부족합니다.' : '과금 시스템 오류가 발생했습니다.');
          }
          holdToken = holdResult.data.hold_token;
          if (holdResult.data.balance_after !== null) {
            updateCreditBalance(holdResult.data.balance_after);
          }
        }
      }

      const resumeData = invalidSavedModel
        ? { ...savedProgress, model: currentModel }
        : savedProgress;

      let newKnowledgeGraph: NovelKnowledgeGraph;
      try {
        newKnowledgeGraph = await extractKnowledgeGraph({
          text: '',
          title: savedProgress.title,
          onProgress: makeProgressCallback(),
          resumeFrom: resumeData,
          onChunkBilling: createBillingCallback(addChunkUsage),
          availableModelIds: getAvailableModelIds(allModels),
        });
      } catch (extractionErr: unknown) {
        if (holdToken) {
          const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `이어하기 중단: ${savedProgress.title}`, updateCreditBalance);
          if (settleResult.actualCredits !== null) {
            useStore.getState().setSettledCredits(settleResult.actualCredits);
          }
        }
        throw extractionErr;
      }

      if (holdToken) {
        const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `이어하기 완료: ${savedProgress.title}`, updateCreditBalance);
        if (settleResult.actualCredits !== null) {
          useStore.getState().setSettledCredits(settleResult.actualCredits);
        }
      }

      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      setKnowledgeGraph(newKnowledgeGraph, undefined, saved.id);
      syncPartialAnalysis(setPartialAnalysis, newKnowledgeGraph.metadata.title);
      resetProgressState();
      return true;
    });
  }, [savedProgress, runExtraction, makeProgressCallback, addChunkUsage, updateCreditBalance, subscription, setKnowledgeGraph, resetProgressState, invalidSavedModel, currentModel, allModels, setPartialAnalysis, byokEnabled, authEnabled]);

  // 추가 분석 (기존 결과에 새 파일 병합) — useAddFileAnalysis 훅 위임
  const handleAddFile = useCallback(async (file: File) => {
    if (!knowledgeGraph) return;

    setError(null);
    await addFileFromHook(file, (fileName, text) => {
      setDuplicateFileName(fileName);
      setNewFileName(fileName);
      setPendingFile(file);
      setPendingFileText(text);
    });
  }, [knowledgeGraph, addFileFromHook, setError]);

  // 새 파일명으로 추가 분석 계속
  const handleConfirmNewFileName = useCallback(async () => {
    if (!pendingFile || !pendingFileText || !newFileName.trim()) return;

    const existingFileNames = (knowledgeGraph?.metadata.sourceFiles || []).map(f => f.fileName);
    if (existingFileNames.includes(newFileName.trim())) {
      setError('이 파일명도 이미 존재합니다. 다른 이름을 입력해주세요.');
      return;
    }

    setDuplicateFileName(null);
    await executeAddFromHook(pendingFileText, newFileName.trim());
    setPendingFile(null);
    setPendingFileText('');
    setNewFileName('');
  }, [pendingFile, pendingFileText, newFileName, knowledgeGraph, executeAddFromHook, setError]);

  // 중복 파일명 대화상자 취소
  const handleCancelDuplicate = useCallback(() => {
    setDuplicateFileName(null);
    setPendingFile(null);
    setPendingFileText('');
    setNewFileName('');
  }, []);

  const handleAddChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    handleAddFile(files[0]);
  }, [handleAddFile]);

  // 개별 분석: 각 파일을 큐에 등록
  const handleBatchAnalysis = useCallback(async () => {
    if (!canRegister || selectedFiles.length < 2) return;

    const items: import('../../types').QueueItem[] = [];
    for (const file of selectedFiles) {
      const text = await readFileAsText(file, () => {});
      items.push({
        id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        text,
        charCount: text.length,
        model: currentModel,
        status: 'pending',
      });
    }

    addToQueue(items);
    setSelectedFiles([]);
    setDirectText('');
    setShowTextInput(false);
  }, [canRegister, selectedFiles, currentModel, addToQueue]);

  // 등록 버튼 클릭 - 실제 분석 시작
  const handleRegister = useCallback(async () => {
    if (!canRegister) return;

    const title = `${bookTitle.trim()} - ${bookAuthor.trim()}`;

    await runExtraction(async () => {
      let text = '';
      let sourceFileName = `${bookTitle.trim()}.txt`;
      const fileInfos: FileInfo[] = [];

      if (selectedFiles.length > 0) {
        setProgress(`${selectedFiles.length}개 파일 읽는 중...`);
        const infos = await readFilesToInfos(selectedFiles, setProgress);
        fileInfos.push(...infos);
        text = combineFileTexts(fileInfos);
        sourceFileName = selectedFiles[0].name;
      } else if (directText.trim()) {
        text = directText.trim();
      }

      if (!text.trim()) {
        throw new Error('내용이 비어있습니다.');
      }

      // 세션 hold: BYOK가 아닌 경우 잔액 확인 + billing 활성 시 hold
      const isUsingPersonalKey = byokEnabled && hasApiKey();
      let holdToken: string | null = null;

      if (!isUsingPersonalKey) {
        const estimate = subscription ? estimateUsageFromText(text, currentModel, allModels, enableLorebook) : null;

        const check = checkCreditSufficiency(subscription, authEnabled, estimate?.estimated_credits);
        if (check.level === 'blocked') throw new Error(check.message);
        if (check.level !== 'ok') {
          const confirmed = await requestCreditConfirmation({
            level: check.level,
            estimatedCredits: estimate?.estimated_credits ?? 0,
            balance: subscription?.creditBalance ?? 0,
            operationName: '파일 분석',
            canResume: true,
          });
          if (!confirmed) return false;
        }

        await ensureSufficientBalance(subscription, authEnabled);

        if (subscription && estimate) {
          const holdAmount = check.level === 'warning'
            ? Math.min(estimate.estimated_credits, subscription.creditBalance)
            : estimate.estimated_credits;
          const holdResult = await holdCredits(holdAmount, currentModel, estimate.chunks);
          if (!holdResult.ok) {
            throw new Error(holdResult.status === 402 ? '크레딧이 부족합니다.' : '과금 시스템 오류가 발생했습니다.');
          }
          holdToken = holdResult.data.hold_token;
          if (holdResult.data.balance_after !== null) {
            updateCreditBalance(holdResult.data.balance_after);
          }
        }
      }

      setProgress('분석 중...');
      let newKnowledgeGraph: NovelKnowledgeGraph;
      try {
        newKnowledgeGraph = await extractKnowledgeGraph({
          text,
          title,
          onProgress: makeProgressCallback(),
          model: currentModel,
          fileNames: fileInfos.length > 0
            ? fileInfos.map(f => f.fileName)
            : (sourceFileName ? [sourceFileName] : undefined),
          onChunkBilling: createBillingCallback(addChunkUsage),
          availableModelIds: getAvailableModelIds(allModels),
          enableLorebook,
        });
      } catch (extractionErr: unknown) {
        if (holdToken) {
          const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `분석 중단: ${title}`, updateCreditBalance);
          if (settleResult.actualCredits !== null) {
            useStore.getState().setSettledCredits(settleResult.actualCredits);
          }
        }
        throw extractionErr;
      }

      if (holdToken) {
        const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `분석 완료: ${title}`, updateCreditBalance);
        if (settleResult.actualCredits !== null) {
          useStore.getState().setSettledCredits(settleResult.actualCredits);
        }
      }

      newKnowledgeGraph.metadata.author = bookAuthor.trim();

      const sourceFiles = buildSourceFiles(fileInfos);
      if (sourceFiles) {
        newKnowledgeGraph.metadata.sourceFiles = sourceFiles;
      }

      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      // 엔티티 임베딩 + 청크 임베딩 생성 (백그라운드)
      setProgress('임베딩 생성 중...');
      const embeddingEntities = Object.values(newKnowledgeGraph.entities);

      if (embeddingEntities.length > 0) {
        createEntityEmbeddings(saved.id, embeddingEntities, getApiKey() || undefined)
          .then(result => {
            if (result.success) {
              console.log(`[embedding] ${result.count}개 엔티티 임베딩 완료`);
            } else {
              console.warn('[embedding] 임베딩 생성 실패:', result.error);
            }
          })
          .catch((err: unknown) => console.warn('[embedding] 임베딩 오류:', err));
      }

      if (text.length > 0) {
        const fileParts = text.split(FILE_SEPARATOR);
        const embeddingChunks: ChunkData[] = [];
        let chunkIndex = 0;

        fileParts.forEach((filePart, fileIdx) => {
          const fileName = fileInfos.length > fileIdx ? fileInfos[fileIdx].fileName : undefined;
          const chunkSize = 5000;
          for (let ci = 0; ci < filePart.length; ci += chunkSize) {
            embeddingChunks.push({
              index: chunkIndex++,
              content: filePart.slice(ci, ci + chunkSize),
              sourceFile: fileName,
            });
          }
        });

        if (embeddingChunks.length > 0) {
          createChunkEmbeddings(saved.id, embeddingChunks, getApiKey() || undefined)
            .then(result => {
              if (result.success) {
                console.log(`[chunk-embedding] ${result.count}개 청크 임베딩 완료`);
              } else {
                console.warn('[chunk-embedding] 청크 임베딩 실패:', result.error);
              }
            })
            .catch((err: unknown) => console.warn('[chunk-embedding] 청크 임베딩 오류:', err));
        }
      }

      setExistingTitles(prev => [...prev, title]);
      setBookTitle('');
      setBookAuthor('');
      setDirectText('');
      setShowTextInput(false);
      setSelectedFiles([]);

      setKnowledgeGraph(newKnowledgeGraph, text, saved.id);
      syncPartialAnalysis(setPartialAnalysis, newKnowledgeGraph.metadata.title);
      resetProgressState();
      return true;
    });
  }, [canRegister, selectedFiles, directText, bookTitle, bookAuthor, currentModel, runExtraction, makeProgressCallback, addChunkUsage, updateCreditBalance, subscription, setKnowledgeGraph, resetProgressState, allModels, setPartialAnalysis, byokEnabled, authEnabled, enableLorebook]);

  // ==================== 렌더링 ====================

  const uploadArea = (
    <UploadArea
      localLoading={localLoading}
      dragActive={dragActive}
      setDragActive={setDragActive}
      handleDrop={handleDrop}
      handleChange={handleChange}
      progressCurrent={progressCurrent}
      progressTotal={progressTotal}
      progress={progress}
      elapsedSeconds={elapsedSeconds}
      estimatedTotalSeconds={estimatedTotalSeconds}
    />
  );

  return (
    <div className="space-y-4">
      <AnalysisPanel
        hasEnvKey={hasEnvKey}
        hasLocalKey={hasLocalKey}
        showApiKeyInput={showApiKeyInput}
        setShowApiKeyInput={setShowApiKeyInput}
        apiKeyInput={apiKeyInput}
        setApiKeyInput={setApiKeyInput}
        handleSaveApiKey={handleSaveApiKey}
        byokEnabled={byokEnabled}
        onRemoveApiKey={handleRemoveApiKey}
        onClearKeyValidationError={() => setKeyValidationError(null)}
        keyValidationLoading={keyValidationLoading}
        keyValidationError={keyValidationError}
        currentModel={currentModel}
        lockedModel={lockedModel}
        localLoading={localLoading}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        availableModels={availableModels}
        allModels={allModels}
        knowledgeGraph={knowledgeGraph}
        bookTitle={bookTitle}
        setBookTitle={setBookTitle}
        bookAuthor={bookAuthor}
        setBookAuthor={setBookAuthor}
        selectedFiles={selectedFiles}
        handleRemoveFile={handleRemoveFile}
        handleMoveFileUp={handleMoveFileUp}
        handleMoveFileDown={handleMoveFileDown}
        handleClearSelection={handleClearSelection}
        showTextInput={showTextInput}
        setShowTextInput={setShowTextInput}
        directText={directText}
        setDirectText={setDirectText}
        isDuplicateTitle={isDuplicateTitle}
        fullTitle={fullTitle}
        canRegister={canRegister}
        handleRegister={handleRegister}
        enableLorebook={enableLorebook}
        setEnableLorebook={setEnableLorebook}
        canBatchAnalysis={canBatchAnalysis}
        onBatchAnalysis={handleBatchAnalysis}
        uploadAreaSlot={uploadArea}
      />

      <ResumePanel
        knowledgeGraph={knowledgeGraph}
        localLoading={localLoading}
        savedProgress={savedProgress}
        handleResume={handleResume}
        handleClearProgress={handleClearProgress}
        handleAddChange={handleAddChange}
        duplicateFileName={duplicateFileName}
        newFileName={newFileName}
        setNewFileName={setNewFileName}
        handleConfirmNewFileName={handleConfirmNewFileName}
        handleCancelDuplicate={handleCancelDuplicate}
        error={error}
        invalidSavedModel={invalidSavedModel}
        savedModelName={savedModelId ? (allModels.find((m) => m.id === savedModelId)?.name ?? savedModelId) : undefined}
        currentModelName={allModels.find((m) => m.id === currentModel)?.name ?? currentModel}
      />

      <BatchAnalysisPanel />
    </div>
  );
}
