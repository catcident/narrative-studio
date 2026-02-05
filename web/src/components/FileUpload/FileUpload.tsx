/**
 * 파일 업로드 컴포넌트
 */

import { useCallback, useState, useEffect } from 'react';
import { useStore, useBillingSubscription, useCreditBalance } from '../../store';
import { extractKnowledgeGraph, hasProgress, clearProgress, hasApiKey, setApiKey, type ExtractionProgress } from '../../services/extraction';
import { saveKnowledgeGraph, getSavedKnowledgeGraphList, type SavedKnowledgeGraphMeta } from '../../services/storage';
import { getCreditBalance as fetchCreditBalance, estimateCredits, createBillingCallback, deductAfterSave, deductPartial } from '../../services/billing';
import { readFileAsText } from '../../services/fileReader';
import { AVAILABLE_MODELS, DEFAULT_MODEL, type ModelInfo } from '../../types';
import { UploadArea } from './UploadArea';
import { AnalysisPanel } from './AnalysisPanel';
import { ResumePanel } from './ResumePanel';

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
  const [hasEnvKey, setHasEnvKey] = useState(true); // 기본으로 있다고 가정
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [duplicateFileName, setDuplicateFileName] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFileText, setPendingFileText] = useState<string>('');
  const [bookTitle, setBookTitle] = useState('');
  const [bookAuthor, setBookAuthor] = useState('');
  // 새 분석용 - 선택된 파일 또는 텍스트 저장 (바로 분석하지 않음)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [directText, setDirectText] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  // 중복 타이틀 체크용
  const [existingTitles, setExistingTitles] = useState<string[]>([]);
  const [duplicateTitleWarning, setDuplicateTitleWarning] = useState<string | null>(null);

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
    setSavedProgress(checkSaved ? hasProgress() : null);
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

  // 환경변수 API 키 및 저장된 진행상황 확인
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setHasEnvKey(data.hasEnvKey);
        useStore.getState().setAuthEnabled(data.authEnabled ?? false);
      })
      .catch(() => {
        setHasEnvKey(false);
        useStore.getState().setAuthEnabled(false);
      });

    setHasLocalKey(hasApiKey());
    const saved = hasProgress();
    setSavedProgress(saved);

    // 기존 저장된 타이틀 목록 로드 (중복 체크용)
    getSavedKnowledgeGraphList()
      .then(list => setExistingTitles(list.map(item => item.title)))
      .catch(() => setExistingTitles([]));
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
  }, [progressCurrent, progressTotal]);

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      setApiKey(apiKeyInput.trim());
      setHasLocalKey(true);
      setApiKeyInput('');
      setShowApiKeyInput(false);
    }
  };

  // 이어하기
  const handleResume = useCallback(async () => {
    if (!savedProgress) return;

    setLocalLoading(true);
    setLoading(true);
    setError(null);
    resetCurrentUsage();
    setProgress(`이어하기: ${savedProgress.processedChunks}/${savedProgress.totalChunks}부터...`);

    try {
      const newKnowledgeGraph = await extractKnowledgeGraph({
        text: '',
        title: savedProgress.title,
        onProgress: (msg, current, total) => {
          setProgress(msg);
          if (current !== undefined) setProgressCurrent(current);
          if (total !== undefined) setProgressTotal(total);
        },
        resumeFrom: savedProgress,
        onChunkBilling: createBillingCallback(addChunkUsage),
      });

      // 저장하고 ID 받기
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      if (subscription) {
        setProgress('크레딧 차감 중...');
        const { currentUsage } = useStore.getState();
        await deductAfterSave(saved.id, savedProgress.title, currentModel, currentUsage, updateCreditBalance);
      }

      setKnowledgeGraph(newKnowledgeGraph, undefined, saved.id);
      resetProgressState();
      setShowUsageSummary(true);
    } catch (err: any) {
      console.error('Resume error:', err);
      if (subscription) {
        const { currentUsage } = useStore.getState();
        await deductPartial(savedProgress.title, currentModel, currentUsage, updateCreditBalance);
      }
      setError(err.message || '이어하기 중 오류가 발생했습니다.');
      resetProgressState(true);
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [savedProgress, setKnowledgeGraph, setLoading, setError, resetProgressState, currentModel, subscription, addChunkUsage, resetCurrentUsage, updateCreditBalance, setShowUsageSummary]);

  // 저장된 진행상황 삭제
  const handleClearProgress = useCallback(() => {
    clearProgress();
    setSavedProgress(null);
  }, []);

  // 선택된 파일 제거
  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 파일 순서 위로 이동
  const handleMoveFileUp = useCallback((index: number) => {
    if (index === 0) return;
    setSelectedFiles(prev => {
      const newFiles = [...prev];
      [newFiles[index - 1], newFiles[index]] = [newFiles[index], newFiles[index - 1]];
      return newFiles;
    });
  }, []);

  // 파일 순서 아래로 이동
  const handleMoveFileDown = useCallback((index: number) => {
    setSelectedFiles(prev => {
      if (index >= prev.length - 1) return prev;
      const newFiles = [...prev];
      [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
      return newFiles;
    });
  }, []);

  // 모든 선택 초기화
  const handleClearSelection = useCallback(() => {
    setSelectedFiles([]);
    setDirectText('');
    setShowTextInput(false);
  }, []);

  // 여러 파일 처리
  const handleFiles = useCallback(async (files: FileList) => {
    if (files.length === 0) return;

    // 파일들을 이름순으로 정렬
    const sortedFiles = Array.from(files).sort((a, b) => a.name.localeCompare(b.name));

    setLocalLoading(true);
    setLoading(true);
    setError(null);
    resetCurrentUsage();
    setProgress(`${sortedFiles.length}개 파일 읽는 중...`);

    try {
      const textParts: string[] = [];
      const titles: string[] = [];
      const fileInfos: { fileName: string; text: string }[] = [];

      for (let i = 0; i < sortedFiles.length; i++) {
        const file = sortedFiles[i];
        setProgress(`파일 읽는 중... (${i + 1}/${sortedFiles.length}) ${file.name}`);

        const text = await readFileAsText(file, setProgress);

        textParts.push(text);
        titles.push(file.name.replace(/\.[^/.]+$/, ''));
        fileInfos.push({ fileName: file.name, text });
      }

      const combinedText = textParts.join('\n\n--- 파일 구분 ---\n\n');
      // 사용자가 제목을 입력했으면 그것을 사용, 아니면 파일명 기반
      const combinedTitle = bookTitle.trim()
        ? bookTitle.trim()
        : (sortedFiles.length === 1
          ? titles[0]
          : `${titles[0]} 외 ${sortedFiles.length - 1}개`);

      if (!combinedText.trim()) {
        throw new Error('파일 내용이 비어있습니다.');
      }

      // 첫 번째 파일명으로 extractKnowledgeGraph 호출
      const newKnowledgeGraph = await extractKnowledgeGraph({
        text: combinedText,
        title: combinedTitle,
        onProgress: (msg, current, total) => {
          setProgress(msg);
          if (current !== undefined) setProgressCurrent(current);
          if (total !== undefined) setProgressTotal(total);
        },
        model: currentModel,
        fileName: sortedFiles[0].name,
        onChunkBilling: createBillingCallback(addChunkUsage),
      });

      // 여러 파일인 경우 sourceFiles에 모든 파일 정보 추가
      if (sortedFiles.length > 1) {
        const now = new Date().toISOString();
        newKnowledgeGraph.metadata.sourceFiles = fileInfos.map((f, i) => ({
          id: `F${String(i + 1).padStart(4, '0')}`,
          fileName: f.fileName,
          uploadedAt: now,
          text: f.text,
          charCount: f.text.length,
        }));
      }

      // 작가 정보 추가
      if (bookAuthor.trim()) {
        newKnowledgeGraph.metadata.author = bookAuthor.trim();
      }

      // 저장하고 ID 받기
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      if (subscription) {
        setProgress('크레딧 차감 중...');
        const { currentUsage } = useStore.getState();
        await deductAfterSave(saved.id, combinedTitle, currentModel, currentUsage, updateCreditBalance);
      }

      // 입력 필드 초기화
      setBookTitle('');
      setBookAuthor('');

      // 원본 텍스트와 함께 저장 (ID도 함께)
      setKnowledgeGraph(newKnowledgeGraph, combinedText, saved.id);
      resetProgressState();
      setShowUsageSummary(true);
    } catch (err: any) {
      console.error('Extraction error:', err);
      if (subscription) {
        const combinedTitle = bookTitle.trim() || 'unknown';
        const { currentUsage } = useStore.getState();
        await deductPartial(combinedTitle, currentModel, currentUsage, updateCreditBalance);
      }
      setError(err.message || '파일 처리 중 오류가 발생했습니다.');
      resetProgressState(true);
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [setKnowledgeGraph, setLoading, setError, currentModel, resetProgressState, subscription, addChunkUsage, resetCurrentUsage, updateCreditBalance, setShowUsageSummary]);

  const handleFile = useCallback(async (file: File) => {
    console.log('파일 업로드 시작:', file.name);
    setLocalLoading(true);
    setLoading(true);
    setError(null);
    resetCurrentUsage();
    setProgress('파일 읽는 중...');

    try {
      const text = await readFileAsText(file, setProgress);

      if (!text.trim()) {
        throw new Error('파일 내용이 비어있습니다.');
      }

      console.log('Extracting knowledgeGraph from text:', text.slice(0, 200) + '...');

      // 사용자가 제목을 입력했으면 그것을 사용
      const title = bookTitle.trim() || file.name.replace(/\.[^/.]+$/, '');
      const newKnowledgeGraph = await extractKnowledgeGraph({
        text,
        title,
        onProgress: (msg, current, total) => {
          setProgress(msg);
          if (current !== undefined) setProgressCurrent(current);
          if (total !== undefined) setProgressTotal(total);
        },
        model: currentModel,
        fileName: file.name,
        onChunkBilling: createBillingCallback(addChunkUsage),
      });

      // 작가 정보 추가
      if (bookAuthor.trim()) {
        newKnowledgeGraph.metadata.author = bookAuthor.trim();
      }

      console.log('Extracted knowledgeGraph:', newKnowledgeGraph);
      console.log('Entities:', Object.keys(newKnowledgeGraph.entities).length);
      console.log('Edges:', Object.keys(newKnowledgeGraph.hyperedges).length);
      console.log('Scenes:', Object.keys(newKnowledgeGraph.snapshots || {}).length);

      if (Object.keys(newKnowledgeGraph.entities).length === 0) {
        throw new Error('추출된 엔티티가 없습니다. 소설 내용을 확인해주세요.');
      }

      // 저장하고 ID 받기
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      if (subscription) {
        setProgress('크레딧 차감 중...');
        const { currentUsage } = useStore.getState();
        await deductAfterSave(saved.id, title, currentModel, currentUsage, updateCreditBalance);
      }

      // 입력 필드 초기화
      setBookTitle('');
      setBookAuthor('');

      // 원본 텍스트와 함께 저장 (ID도 함께)
      setKnowledgeGraph(newKnowledgeGraph, text, saved.id);
      resetProgressState();
      setShowUsageSummary(true);
    } catch (err: any) {
      console.error('Extraction error:', err);
      if (subscription) {
        const title = bookTitle.trim() || file.name;
        const { currentUsage } = useStore.getState();
        await deductPartial(title, currentModel, currentUsage, updateCreditBalance);
      }
      setError(err.message || '파일 처리 중 오류가 발생했습니다.');
      resetProgressState(true);
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [setKnowledgeGraph, setLoading, setError, currentModel, resetProgressState, subscription, addChunkUsage, resetCurrentUsage, updateCreditBalance, setShowUsageSummary]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    // 기존 결과가 있으면 기존 방식으로 추가 분석
    if (knowledgeGraph) {
      const files = e.dataTransfer.files;
      if (files.length > 1) {
        handleFiles(files);
      } else if (files.length === 1) {
        handleFile(files[0]);
      }
      return;
    }

    // 새 분석: 파일을 상태에 저장만 함 (바로 분석하지 않음)
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setSelectedFiles(Array.from(files).sort((a, b) => a.name.localeCompare(b.name)));
      setDirectText(''); // 파일 선택 시 직접 입력 텍스트 초기화
      setShowTextInput(false);
    }
  }, [knowledgeGraph, handleFile, handleFiles]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    // 기존 결과가 있으면 기존 방식으로 추가 분석
    if (knowledgeGraph) {
      if (files.length > 1) {
        handleFiles(files);
      } else if (files.length === 1) {
        handleFile(files[0]);
      }
      return;
    }

    // 새 분석: 파일을 상태에 저장만 함 (바로 분석하지 않음)
    if (files.length > 0) {
      setSelectedFiles(Array.from(files).sort((a, b) => a.name.localeCompare(b.name)));
      setDirectText(''); // 파일 선택 시 직접 입력 텍스트 초기화
      setShowTextInput(false);
    }
  }, [knowledgeGraph, handleFile, handleFiles]);

  // 추가 분석 실행 (파일명 확정 후)
  const executeAddFile = useCallback(async (file: File, text: string, finalFileName: string) => {
    if (!knowledgeGraph) return;

    setLocalLoading(true);
    setLoading(true);
    setError(null);
    resetCurrentUsage();

    try {
      setProgress('추가 분석 중...');
      // 추가 분석: 기존 지식그래프를 전달하여 이어서 분석
      const updatedKnowledgeGraph = await extractKnowledgeGraph({
        text,
        title: knowledgeGraph.metadata.title,
        onProgress: (msg) => setProgress(`추가: ${msg}`),
        model: currentModel,
        fileName: finalFileName,
        existingGraph: knowledgeGraph,
        onChunkBilling: createBillingCallback(addChunkUsage),
      });

      console.log('분석 완료:', updatedKnowledgeGraph.metadata.title);
      console.log('총 엔티티:', Object.keys(updatedKnowledgeGraph.entities).length);
      console.log('총 관계:', Object.keys(updatedKnowledgeGraph.hyperedges).length);

      // 기존 ID를 사용하여 저장 (버전 업데이트)
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(updatedKnowledgeGraph, undefined, undefined, currentDataId || undefined);

      if (subscription) {
        setProgress('크레딧 차감 중...');
        const { currentUsage } = useStore.getState();
        await deductAfterSave(saved.id, knowledgeGraph.metadata.title, currentModel, currentUsage, updateCreditBalance);
      }

      setKnowledgeGraph(updatedKnowledgeGraph, undefined, saved.id);
      resetProgressState();
      setShowUsageSummary(true);
    } catch (err: any) {
      console.error('추가 분석 오류:', err);
      if (subscription) {
        const { currentUsage } = useStore.getState();
        await deductPartial(knowledgeGraph.metadata.title, currentModel, currentUsage, updateCreditBalance);
      }
      setError(err.message || '추가 분석 중 오류가 발생했습니다.');
      resetProgressState(true);
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph, setLoading, setError, currentModel, resetProgressState, subscription, addChunkUsage, resetCurrentUsage, updateCreditBalance, setShowUsageSummary]);

  // 추가 분석 (기존 결과에 새 파일 병합)
  const handleAddFile = useCallback(async (file: File) => {
    if (!knowledgeGraph) return;

    console.log('추가 분석 시작:', file.name);
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
        // 중복됨 - 새 파일명 입력 요청
        setDuplicateFileName(file.name);
        setNewFileName(file.name);
        setPendingFile(file);
        setPendingFileText(text);
        resetProgressState();
        return;
      }

      // 중복 없음 - 바로 실행
      await executeAddFile(file, text, file.name);
    } catch (err: any) {
      console.error('추가 분석 오류:', err);
      setError(err.message || '추가 분석 중 오류가 발생했습니다.');
      resetProgressState(true);
    }
  }, [knowledgeGraph, executeAddFile, resetProgressState]);

  // 새 파일명으로 추가 분석 계속
  const handleConfirmNewFileName = useCallback(async () => {
    if (!pendingFile || !pendingFileText || !newFileName.trim()) return;

    // 새 파일명도 중복 체크
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
  }, [pendingFile, pendingFileText, newFileName, knowledgeGraph, executeAddFile]);

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

    // 잔액 확인 (예상 비용과 비교)
    if (subscription) {
      const balanceInfo = await fetchCreditBalance();
      if (balanceInfo) {
        if (balanceInfo.balance <= 0) {
          setError('크레딧이 부족합니다. 크레딧을 충전해주세요.');
          return;
        }
        // 파일 기반일 때 bytes→chars 근사 변환 (UTF-8 한글 ~3bytes/char)
        const approxCharCount = directText.trim()
          ? directText.length
          : Math.ceil(selectedFiles.reduce((sum, f) => sum + f.size, 0) / 3);
        const estimate = await estimateCredits(approxCharCount, currentModel);
        if (estimate && estimate.estimated_credits > balanceInfo.balance) {
          setError(`크레딧이 부족합니다. 필요: 약 ${estimate.estimated_credits.toLocaleString()}, 잔액: ${balanceInfo.balance.toLocaleString()}`);
          return;
        }
      }
    }

    // 타이틀 형식: "제목 - 작가"
    const title = `${bookTitle.trim()} - ${bookAuthor.trim()}`;

    setLocalLoading(true);
    setLoading(true);
    setError(null);
    resetCurrentUsage();

    try {
      let text = '';
      let sourceFileName = `${bookTitle.trim()}.txt`;
      const fileInfos: { fileName: string; text: string }[] = [];

      // 파일이 있으면 파일에서 텍스트 추출
      if (selectedFiles.length > 0) {
        setProgress(`${selectedFiles.length}개 파일 읽는 중...`);

        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          setProgress(`파일 읽는 중... (${i + 1}/${selectedFiles.length}) ${file.name}`);

          const fileText = await readFileAsText(file, setProgress);

          fileInfos.push({ fileName: file.name, text: fileText });
        }

        text = fileInfos.map(f => f.text).join('\n\n--- 파일 구분 ---\n\n');
        sourceFileName = selectedFiles[0].name;
      } else if (directText.trim()) {
        // 텍스트 직접 입력
        text = directText.trim();
      }

      if (!text.trim()) {
        throw new Error('내용이 비어있습니다.');
      }

      setProgress('분석 중...');
      const newKnowledgeGraph = await extractKnowledgeGraph({
        text,
        title,
        onProgress: (msg, current, total) => {
          setProgress(msg);
          if (current !== undefined) setProgressCurrent(current);
          if (total !== undefined) setProgressTotal(total);
        },
        model: currentModel,
        fileName: sourceFileName,
        onChunkBilling: createBillingCallback(addChunkUsage),
      });

      // 작가 정보 추가
      newKnowledgeGraph.metadata.author = bookAuthor.trim();

      // 여러 파일인 경우 sourceFiles에 모든 파일 정보 추가
      if (fileInfos.length > 1) {
        const now = new Date().toISOString();
        newKnowledgeGraph.metadata.sourceFiles = fileInfos.map((f, i) => ({
          id: `F${String(i + 1).padStart(4, '0')}`,
          fileName: f.fileName,
          uploadedAt: now,
          text: f.text,
          charCount: f.text.length,
        }));
      }

      // 저장하고 ID 받기
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      // 실제 토큰 기반 크레딧 차감 (구독이 있는 경우)
      if (subscription) {
        setProgress('크레딧 차감 중...');
        const { currentUsage } = useStore.getState();
        await deductAfterSave(saved.id, title, currentModel, currentUsage, updateCreditBalance);
      }

      // 타이틀 목록 업데이트
      setExistingTitles(prev => [...prev, title]);

      // 입력 필드 초기화
      setBookTitle('');
      setBookAuthor('');
      setDirectText('');
      setShowTextInput(false);
      setSelectedFiles([]);

      setKnowledgeGraph(newKnowledgeGraph, text, saved.id);
      resetProgressState();

      // 사용량 요약 표시
      setShowUsageSummary(true);
    } catch (err: any) {
      console.error('Extraction error:', err);
      // 부분 차감: 이미 사용한 API 비용 처리
      if (subscription) {
        const { currentUsage } = useStore.getState();
        await deductPartial(title, currentModel, currentUsage, updateCreditBalance);
      }
      setError(err.message || '처리 중 오류가 발생했습니다.');
      resetProgressState(true);
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [canRegister, selectedFiles, directText, bookTitle, bookAuthor, currentModel, setKnowledgeGraph, setLoading, setError, subscription, addChunkUsage, resetCurrentUsage, setShowUsageSummary, updateCreditBalance, resetProgressState]);

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
