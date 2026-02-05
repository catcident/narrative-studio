/**
 * 파일 업로드 컴포넌트
 */

import { useCallback, useState, useEffect } from 'react';
import { useStore, useBillingSubscription } from '../../store';
import { extractKnowledgeGraph, loadProgress, clearProgress, hasApiKey, setApiKey, getApiKey, FILE_SEPARATOR, type ExtractionProgress } from '../../services/extraction';
import { saveKnowledgeGraph, getSavedKnowledgeGraphList } from '../../services/storage';
import { createBillingCallback, ensureSufficientBalance } from '../../services/billing';
import { createEntityEmbeddings, createChunkEmbeddings, type ChunkData } from '../../services/embedding';
import { readFileAsText } from '../../services/fileReader';
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '../../types';
import type { NovelKnowledgeGraph } from '../../types';
import { UploadArea } from './UploadArea';
import { AnalysisPanel } from './AnalysisPanel';
import { ResumePanel } from './ResumePanel';

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
  return fileInfos.map(f => f.text).join('\n\n--- 파일 구분 ---\n\n');
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
  const currentDataId = useStore((s) => s.currentDataId);
  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const setLoading = useStore((s) => s.setLoading);
  const setError = useStore((s) => s.setError);
  const error = useStore((s) => s.error);
  const addChunkUsage = useStore((s) => s.addChunkUsage);
  const resetCurrentUsage = useStore((s) => s.resetCurrentUsage);
  const setShowUsageSummary = useStore((s) => s.setShowUsageSummary);
  const updateCreditBalance = useStore((s) => s.updateCreditBalance);
  const loadSubscription = useStore((s) => s.loadSubscription);
  const subscription = useBillingSubscription();
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState('');
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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

  // 기존 지식그래프가 있으면 해당 모델로 고정
  const lockedModel = knowledgeGraph?.metadata?.model;
  const currentModel = lockedModel || selectedModel;

  // 플랜에 따른 모델 필터링
  const availableModels = subscription?.features?.models && subscription.features.models !== 'all'
    ? AVAILABLE_MODELS.filter(m => (subscription.features.models as string[]).includes(m.id))
    : AVAILABLE_MODELS;

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
      (msg: string, current?: number, total?: number) => {
        setProgress(prefix ? `${prefix}: ${msg}` : msg);
        if (current !== undefined) setProgressCurrent(current);
        if (total !== undefined) setProgressTotal(total);
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
        resetProgressState(true);
      } finally {
        setLocalLoading(false);
        setLoading(false);
        loadSubscription();
      }
    },
    [setLoading, setError, resetCurrentUsage, setShowUsageSummary, resetProgressState, loadSubscription],
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
      setEstimatedTotalSeconds(null);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(s => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [localLoading]);

  // 청크가 바뀔 때만 전체 예상 시간 계산
  useEffect(() => {
    if (progressCurrent > 0 && progressTotal > 0 && elapsedSeconds > 0) {
      const estimated = Math.round((elapsedSeconds / progressCurrent) * progressTotal);
      setEstimatedTotalSeconds(estimated);
    }
  }, [progressCurrent, progressTotal, elapsedSeconds]);

  // ==================== 단순 핸들러 ====================

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      setApiKey(apiKeyInput.trim());
      setHasLocalKey(true);
      setApiKeyInput('');
      setShowApiKeyInput(false);
    }
  };

  const handleClearProgress = useCallback(() => {
    clearProgress();
    setSavedProgress(null);
  }, []);

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

      await ensureSufficientBalance(subscription);

      const newKnowledgeGraph = await extractKnowledgeGraph({
        text: combinedText,
        title: combinedTitle,
        onProgress: makeProgressCallback(),
        model: currentModel,
        fileNames: sortedFiles.map(f => f.name),
        onChunkBilling: createBillingCallback(addChunkUsage, updateCreditBalance),
      });

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
      resetProgressState();
      return true;
    });
  }, [runExtraction, makeProgressCallback, currentModel, addChunkUsage, updateCreditBalance, subscription, bookTitle, bookAuthor, setKnowledgeGraph, resetProgressState]);

  /**
   * handleDrop과 handleChange에서 공유하는 파일 처리 로직.
   * - knowledgeGraph가 있으면 handleFiles로 추가 분석
   * - 없으면 selectedFiles 상태에 저장만 함 (바로 분석하지 않음)
   */
  const processFileInput = useCallback((files: FileList) => {
    if (files.length === 0) return;

    if (knowledgeGraph) {
      handleFiles(files);
      return;
    }

    setSelectedFiles(Array.from(files).sort((a, b) => a.name.localeCompare(b.name)));
    setDirectText('');
    setShowTextInput(false);
  }, [knowledgeGraph, handleFiles]);

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
      await ensureSufficientBalance(subscription);

      const newKnowledgeGraph = await extractKnowledgeGraph({
        text: '',
        title: savedProgress.title,
        onProgress: makeProgressCallback(),
        resumeFrom: savedProgress,
        onChunkBilling: createBillingCallback(addChunkUsage, updateCreditBalance),
      });

      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      setKnowledgeGraph(newKnowledgeGraph, undefined, saved.id);
      resetProgressState();
      return true;
    });
  }, [savedProgress, runExtraction, makeProgressCallback, addChunkUsage, updateCreditBalance, subscription, setKnowledgeGraph, resetProgressState]);

  // 추가 분석 실행 (파일명 확정 후)
  const executeAddFile = useCallback(async (file: File, text: string, finalFileName: string) => {
    if (!knowledgeGraph) return;

    await runExtraction(async () => {
      await ensureSufficientBalance(subscription);

      setProgress('추가 분석 중...');
      const updatedKnowledgeGraph = await extractKnowledgeGraph({
        text,
        title: knowledgeGraph.metadata.title,
        onProgress: makeProgressCallback('추가'),
        model: currentModel,
        fileNames: [finalFileName],
        existingGraph: knowledgeGraph,
        onChunkBilling: createBillingCallback(addChunkUsage, updateCreditBalance),
      });

      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(
        updatedKnowledgeGraph,
        undefined,
        undefined,
        currentDataId || undefined,
      );

      setKnowledgeGraph(updatedKnowledgeGraph, undefined, saved.id);
      resetProgressState();
      return true;
    });
  }, [knowledgeGraph, currentDataId, runExtraction, makeProgressCallback, currentModel, addChunkUsage, updateCreditBalance, subscription, setKnowledgeGraph, resetProgressState]);

  // 추가 분석 (기존 결과에 새 파일 병합)
  const handleAddFile = useCallback(async (file: File) => {
    if (!knowledgeGraph) return;

    setError(null);
    setProgress('파일 읽는 중...');

    try {
      const text = await readFileAsText(file, setProgress);

      if (!text.trim()) {
        throw new Error('파일 내용이 비어있습니다.');
      }

      // 중복 파일명 체크
      const existingFileNames = (knowledgeGraph.metadata.sourceFiles || []).map(f => f.fileName);
      if (existingFileNames.includes(file.name)) {
        setDuplicateFileName(file.name);
        setNewFileName(file.name);
        setPendingFile(file);
        setPendingFileText(text);
        resetProgressState();
        return;
      }

      await executeAddFile(file, text, file.name);
    } catch (err: unknown) {
      console.error('[extraction] 추가 분석 오류:', err);
      setError(err instanceof Error ? err.message : '추가 분석 중 오류가 발생했습니다.');
      resetProgressState(true);
    }
  }, [knowledgeGraph, executeAddFile, resetProgressState, setError]);

  // 새 파일명으로 추가 분석 계속
  const handleConfirmNewFileName = useCallback(async () => {
    if (!pendingFile || !pendingFileText || !newFileName.trim()) return;

    const existingFileNames = (knowledgeGraph?.metadata.sourceFiles || []).map(f => f.fileName);
    if (existingFileNames.includes(newFileName.trim())) {
      setError('이 파일명도 이미 존재합니다. 다른 이름을 입력해주세요.');
      return;
    }

    setDuplicateFileName(null);
    await executeAddFile(pendingFile, pendingFileText, newFileName.trim());
    setPendingFile(null);
    setPendingFileText('');
    setNewFileName('');
  }, [pendingFile, pendingFileText, newFileName, knowledgeGraph, executeAddFile, setError]);

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

      await ensureSufficientBalance(subscription);

      setProgress('분석 중...');
      const newKnowledgeGraph = await extractKnowledgeGraph({
        text,
        title,
        onProgress: makeProgressCallback(),
        model: currentModel,
        fileNames: fileInfos.length > 0
          ? fileInfos.map(f => f.fileName)
          : (sourceFileName ? [sourceFileName] : undefined),
        onChunkBilling: createBillingCallback(addChunkUsage, updateCreditBalance),
      });

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
          .catch(err => console.warn('[embedding] 임베딩 오류:', err));
      }

      if (text.length > 0) {
        const fileParts = text.split(FILE_SEPARATOR);
        const chunks: ChunkData[] = [];
        let chunkIndex = 0;

        fileParts.forEach((filePart, fileIdx) => {
          const fileName = fileInfos.length > fileIdx ? fileInfos[fileIdx].fileName : undefined;
          const chunkSize = 5000;
          for (let ci = 0; ci < filePart.length; ci += chunkSize) {
            chunks.push({
              index: chunkIndex++,
              content: filePart.slice(ci, ci + chunkSize),
              sourceFile: fileName,
            });
          }
        });

        if (chunks.length > 0) {
          createChunkEmbeddings(saved.id, chunks, getApiKey() || undefined)
            .then(result => {
              if (result.success) {
                console.log(`[chunk-embedding] ${result.count}개 청크 임베딩 완료`);
              } else {
                console.warn('[chunk-embedding] 청크 임베딩 실패:', result.error);
              }
            })
            .catch(err => console.warn('[chunk-embedding] 청크 임베딩 오류:', err));
        }
      }

      setExistingTitles(prev => [...prev, title]);
      setBookTitle('');
      setBookAuthor('');
      setDirectText('');
      setShowTextInput(false);
      setSelectedFiles([]);

      setKnowledgeGraph(newKnowledgeGraph, text, saved.id);
      resetProgressState();
      return true;
    });
  }, [canRegister, selectedFiles, directText, bookTitle, bookAuthor, currentModel, runExtraction, makeProgressCallback, addChunkUsage, updateCreditBalance, subscription, setKnowledgeGraph, resetProgressState]);

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
        currentModel={currentModel}
        lockedModel={lockedModel}
        localLoading={localLoading}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        availableModels={availableModels}
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
      />
    </div>
  );
}
