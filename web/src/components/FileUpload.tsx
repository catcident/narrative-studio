/**
 * 파일 업로드 컴포넌트
 */

import { useCallback, useState, useEffect } from 'react';
import { Upload, FileText, Loader2, AlertCircle, RotateCcw, Play, Trash2, Files, Plus, Key, Cpu, BookOpen, User, X, FileCheck, ChevronUp, ChevronDown } from 'lucide-react';
import { useStore } from '../store';
import { extractKnowledgeGraph, hasProgress, clearProgress, hasApiKey, setApiKey, type ExtractionProgress } from '../services/extraction';
import { saveKnowledgeGraph, getSavedKnowledgeGraphList, type SavedKnowledgeGraphMeta } from '../services/storage';
import { AVAILABLE_MODELS, DEFAULT_MODEL, type ModelInfo } from '../types';

// 텍스트 파일 인코딩 감지 및 디코딩
async function readTextFileWithEncoding(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(buffer);

  // UTF-8 BOM 체크
  if (uint8Array[0] === 0xEF && uint8Array[1] === 0xBB && uint8Array[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(buffer);
  }

  // UTF-16 LE BOM 체크
  if (uint8Array[0] === 0xFF && uint8Array[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(buffer);
  }

  // UTF-16 BE BOM 체크
  if (uint8Array[0] === 0xFE && uint8Array[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(buffer);
  }

  // UTF-8로 먼저 시도
  try {
    const utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    // 유효한 UTF-8인 경우
    return utf8Text;
  } catch {
    // UTF-8이 아님
  }

  // EUC-KR (CP949) 시도 - 한글 텍스트에서 흔함
  try {
    const eucKrText = new TextDecoder('euc-kr').decode(buffer);
    // 깨진 문자가 적은지 확인 (간단한 휴리스틱)
    const koreanPattern = /[가-힣]/g;
    const matches = eucKrText.match(koreanPattern);
    if (matches && matches.length > 10) {
      return eucKrText;
    }
  } catch {
    // EUC-KR 디코딩 실패
  }

  // 기본 UTF-8로 폴백 (일부 깨질 수 있음)
  return new TextDecoder('utf-8').decode(buffer);
}

export function FileUpload() {
  const { knowledgeGraph, currentDataId, setKnowledgeGraph, setLoading, setError, error } = useStore();
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState('');
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
      .then(data => setHasEnvKey(data.hasEnvKey))
      .catch(() => setHasEnvKey(false));

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
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(s => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [localLoading]);

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
    setProgress(`이어하기: ${savedProgress.processedChunks}/${savedProgress.totalChunks}부터...`);

    try {
      const newKnowledgeGraph = await extractKnowledgeGraph('', savedProgress.title, (msg, current, total, estMin) => {
        setProgress(msg);
        if (current !== undefined) setProgressCurrent(current);
        if (total !== undefined) setProgressTotal(total);
        if (estMin !== undefined) setEstimatedMinutes(estMin);
      }, savedProgress);

      // 저장하고 ID 받기
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      setKnowledgeGraph(newKnowledgeGraph, undefined, saved.id);
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      setSavedProgress(null);
    } catch (err: any) {
      console.error('Resume error:', err);
      setError(err.message || '이어하기 중 오류가 발생했습니다.');
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      // 진행상황 다시 확인
      setSavedProgress(hasProgress());
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [savedProgress, setKnowledgeGraph, setLoading, setError]);

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
    setProgress(`${sortedFiles.length}개 파일 읽는 중...`);

    try {
      const textParts: string[] = [];
      const titles: string[] = [];
      const fileInfos: { fileName: string; text: string }[] = [];

      for (let i = 0; i < sortedFiles.length; i++) {
        const file = sortedFiles[i];
        setProgress(`파일 읽는 중... (${i + 1}/${sortedFiles.length}) ${file.name}`);

        let text = '';
        if (file.type === 'application/pdf') {
          const pdfjsLib = await import('pdfjs-dist');
          pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

          const pdfTextParts: string[] = [];
          for (let j = 1; j <= pdf.numPages; j++) {
            const page = await pdf.getPage(j);
            const content = await page.getTextContent();
            const pageText = content.items.map((item: any) => item.str).join(' ');
            pdfTextParts.push(pageText);
          }
          text = pdfTextParts.join('\n\n');
        } else {
          // 인코딩 감지하여 텍스트 읽기
          text = await readTextFileWithEncoding(file);
        }

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
      const newKnowledgeGraph = await extractKnowledgeGraph(combinedText, combinedTitle, (msg, current, total, estMin) => {
        setProgress(msg);
        if (current !== undefined) setProgressCurrent(current);
        if (total !== undefined) setProgressTotal(total);
        if (estMin !== undefined) setEstimatedMinutes(estMin);
      }, undefined, currentModel, sortedFiles[0].name);

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

      // 입력 필드 초기화
      setBookTitle('');
      setBookAuthor('');

      // 원본 텍스트와 함께 저장 (ID도 함께)
      setKnowledgeGraph(newKnowledgeGraph, combinedText, saved.id);
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      setSavedProgress(null);
    } catch (err: any) {
      console.error('Extraction error:', err);
      setError(err.message || '파일 처리 중 오류가 발생했습니다.');
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      setSavedProgress(hasProgress());
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [setKnowledgeGraph, setLoading, setError, currentModel]);

  const handleFile = useCallback(async (file: File) => {
    console.log('파일 업로드 시작:', file.name);
    setLocalLoading(true);
    setLoading(true);
    setError(null);
    setProgress('파일 읽는 중...');

    try {
      let text = '';

      if (file.type === 'application/pdf') {
        setProgress('PDF 파싱 중...');
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        const textParts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          setProgress(`PDF 페이지 ${i}/${pdf.numPages} 처리 중...`);
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item: any) => item.str)
            .join(' ');
          textParts.push(pageText);
        }
        text = textParts.join('\n\n');
      } else {
        // 인코딩 감지하여 텍스트 읽기
        text = await readTextFileWithEncoding(file);
      }

      if (!text.trim()) {
        throw new Error('파일 내용이 비어있습니다.');
      }

      console.log('Extracting knowledgeGraph from text:', text.slice(0, 200) + '...');

      // 사용자가 제목을 입력했으면 그것을 사용
      const title = bookTitle.trim() || file.name.replace(/\.[^/.]+$/, '');
      const newKnowledgeGraph = await extractKnowledgeGraph(text, title, (msg, current, total, estMin) => {
        setProgress(msg);
        if (current !== undefined) setProgressCurrent(current);
        if (total !== undefined) setProgressTotal(total);
        if (estMin !== undefined) setEstimatedMinutes(estMin);
      }, undefined, currentModel, file.name);  // 원본 파일명 전달

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

      // 입력 필드 초기화
      setBookTitle('');
      setBookAuthor('');

      // 원본 텍스트와 함께 저장 (ID도 함께)
      setKnowledgeGraph(newKnowledgeGraph, text, saved.id);
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      setSavedProgress(null);
    } catch (err: any) {
      console.error('Extraction error:', err);
      setError(err.message || '파일 처리 중 오류가 발생했습니다.');
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      // 진행상황 다시 확인
      setSavedProgress(hasProgress());
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [setKnowledgeGraph, setLoading, setError, currentModel]);

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

    try {
      setProgress('추가 분석 중...');
      // 추가 분석: 기존 지식그래프를 전달하여 이어서 분석
      const updatedKnowledgeGraph = await extractKnowledgeGraph(
        text,
        knowledgeGraph.metadata.title,  // 기존 제목 유지
        (msg) => setProgress(`추가: ${msg}`),
        undefined,
        currentModel,
        finalFileName,
        knowledgeGraph  // 기존 지식그래프 전달
      );

      console.log('분석 완료:', updatedKnowledgeGraph.metadata.title);
      console.log('총 엔티티:', Object.keys(updatedKnowledgeGraph.entities).length);
      console.log('총 관계:', Object.keys(updatedKnowledgeGraph.hyperedges).length);

      // 기존 ID를 사용하여 저장 (버전 업데이트)
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(updatedKnowledgeGraph, undefined, undefined, currentDataId || undefined);

      setKnowledgeGraph(updatedKnowledgeGraph, undefined, saved.id);
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      setSavedProgress(null);
    } catch (err: any) {
      console.error('추가 분석 오류:', err);
      setError(err.message || '추가 분석 중 오류가 발생했습니다.');
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      setSavedProgress(hasProgress());
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph, setLoading, setError, currentModel]);

  // 추가 분석 (기존 결과에 새 파일 병합)
  const handleAddFile = useCallback(async (file: File) => {
    if (!knowledgeGraph) return;

    console.log('추가 분석 시작:', file.name);
    setError(null);
    setProgress('파일 읽는 중...');

    try {
      let text = '';

      if (file.type === 'application/pdf') {
        setProgress('PDF 파싱 중...');
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        const textParts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          setProgress(`PDF 페이지 ${i}/${pdf.numPages} 처리 중...`);
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map((item: any) => item.str).join(' ');
          textParts.push(pageText);
        }
        text = textParts.join('\n\n');
      } else {
        // 인코딩 감지하여 텍스트 읽기
        text = await readTextFileWithEncoding(file);
      }

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
        setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
        return;
      }

      // 중복 없음 - 바로 실행
      await executeAddFile(file, text, file.name);
    } catch (err: any) {
      console.error('추가 분석 오류:', err);
      setError(err.message || '추가 분석 중 오류가 발생했습니다.');
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      setSavedProgress(hasProgress());
    }
  }, [knowledgeGraph, executeAddFile]);

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

    // 타이틀 형식: "제목 - 작가"
    const title = `${bookTitle.trim()} - ${bookAuthor.trim()}`;

    setLocalLoading(true);
    setLoading(true);
    setError(null);

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

          let fileText = '';
          if (file.type === 'application/pdf') {
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            const pdfTextParts: string[] = [];
            for (let j = 1; j <= pdf.numPages; j++) {
              const page = await pdf.getPage(j);
              const content = await page.getTextContent();
              const pageText = content.items.map((item: any) => item.str).join(' ');
              pdfTextParts.push(pageText);
            }
            fileText = pdfTextParts.join('\n\n');
          } else {
            // 인코딩 감지하여 텍스트 읽기
            fileText = await readTextFileWithEncoding(file);
          }

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
      const newKnowledgeGraph = await extractKnowledgeGraph(text, title, (msg, current, total, estMin) => {
        setProgress(msg);
        if (current !== undefined) setProgressCurrent(current);
        if (total !== undefined) setProgressTotal(total);
        if (estMin !== undefined) setEstimatedMinutes(estMin);
      }, undefined, currentModel, sourceFileName);

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

      // 타이틀 목록 업데이트
      setExistingTitles(prev => [...prev, title]);

      // 입력 필드 초기화
      setBookTitle('');
      setBookAuthor('');
      setDirectText('');
      setShowTextInput(false);
      setSelectedFiles([]);

      setKnowledgeGraph(newKnowledgeGraph, text, saved.id);
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      setSavedProgress(null);
    } catch (err: any) {
      console.error('Extraction error:', err);
      setError(err.message || '처리 중 오류가 발생했습니다.');
      setProgress(''); setProgressCurrent(0); setProgressTotal(0); setEstimatedMinutes(null);
      setSavedProgress(hasProgress());
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [canRegister, selectedFiles, directText, bookTitle, bookAuthor, currentModel, setKnowledgeGraph, setLoading, setError]);

  return (
    <div className="space-y-4">
      {/* API 키 입력 - 환경변수 없을 때만 경고, 또는 사용자가 직접 입력 원할 때 */}
      {!hasEnvKey && !hasLocalKey && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Key className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-yellow-800">OpenRouter API 키 필요</p>
              <p className="text-sm text-yellow-700 mt-1">
                소설 분석을 위해 API 키가 필요합니다.
                <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" className="underline ml-1">
                  여기서 발급받기
                </a>
              </p>
              <div className="flex gap-2 mt-3">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-or-..."
                  className="flex-1 px-3 py-1.5 border border-yellow-300 rounded-lg text-sm"
                />
                <button
                  onClick={handleSaveApiKey}
                  className="px-3 py-1.5 bg-yellow-600 text-white text-sm rounded-lg hover:bg-yellow-700"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 자신의 API 키 사용 옵션 */}
      {(hasEnvKey || hasLocalKey) && !showApiKeyInput && (
        <div className="text-center">
          <button
            onClick={() => setShowApiKeyInput(true)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            <Key className="w-3 h-3 inline mr-1" />
            {hasLocalKey ? '내 API 키 변경' : '내 API 키 사용하기'}
          </button>
        </div>
      )}

      {showApiKeyInput && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={hasLocalKey ? '••••••••' : 'sk-or-...'}
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
            />
            <button
              onClick={handleSaveApiKey}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              저장
            </button>
            <button
              onClick={() => setShowApiKeyInput(false)}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 모델 선택 */}
      <div className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl">
        <div className="flex items-start gap-3">
          <Cpu className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="font-medium text-purple-800">AI 모델 선택</p>
              {lockedModel && (
                <span className="text-xs px-2 py-0.5 bg-purple-200 text-purple-700 rounded-full">
                  🔒 고정됨
                </span>
              )}
            </div>
            <select
              value={currentModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={!!lockedModel || localLoading}
              className={`mt-2 w-full px-3 py-2 border rounded-lg text-sm ${
                lockedModel
                  ? 'bg-gray-100 border-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-white border-purple-300 text-gray-800'
              }`}
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} - {model.description} (${model.inputCost}/${model.outputCost} per 1M)
                </option>
              ))}
            </select>
            {lockedModel && (
              <p className="text-xs text-purple-600 mt-1">
                이 문서는 {AVAILABLE_MODELS.find(m => m.id === lockedModel)?.name || lockedModel}로 분석되었습니다. 추가 분석도 같은 모델을 사용합니다.
              </p>
            )}
            {!lockedModel && (
              <p className="text-xs text-gray-500 mt-1">
                비용: Input/Output (1M 토큰당 USD). 고품질 모델은 더 정확하지만 비용이 높습니다.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 제목/작가 입력 (새 분석 시에만 표시) - 필수 */}
      {!knowledgeGraph && (
        <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl">
          <div className="flex items-start gap-3">
            <BookOpen className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-emerald-800 mb-3">작품 정보 <span className="text-red-500">*</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-emerald-700 mb-1 block">제목 <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={bookTitle}
                      onChange={(e) => setBookTitle(e.target.value)}
                      placeholder="작품 제목"
                      className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm bg-white ${
                        bookTitle.trim() ? 'border-emerald-300' : 'border-red-300'
                      }`}
                      disabled={localLoading}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-emerald-700 mb-1 block">작가 <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={bookAuthor}
                      onChange={(e) => setBookAuthor(e.target.value)}
                      placeholder="작가 이름"
                      className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm bg-white ${
                        bookAuthor.trim() ? 'border-emerald-300' : 'border-red-300'
                      }`}
                      disabled={localLoading}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={`
          relative border-2 border-dashed rounded-xl p-12
          transition-all duration-200
          ${localLoading ? 'pointer-events-none' : 'cursor-pointer'}
          ${dragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 bg-white'
          }
        `}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => !localLoading && document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".txt,.pdf,.md,text/plain,text/markdown,application/pdf"
          onChange={handleChange}
          className="hidden"
          disabled={localLoading}
          multiple
        />

        <div className="flex flex-col items-center gap-4 text-center">
          {localLoading ? (
            (() => {
              const elapsedMin = Math.floor(elapsedSeconds / 60);
              const elapsedSec = elapsedSeconds % 60;
              const totalEstimatedSeconds = estimatedMinutes !== null ? elapsedSeconds + estimatedMinutes * 60 : null;
              const totalMin = totalEstimatedSeconds !== null ? Math.floor(totalEstimatedSeconds / 60) : null;
              const totalSec = totalEstimatedSeconds !== null ? totalEstimatedSeconds % 60 : null;
              return (
                <>
                  <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                  <div>
                    <p className="text-lg font-medium text-gray-700">분석 중...</p>
                    {progressTotal > 0 && (
                      <p className="text-sm text-gray-600 mt-1">
                        청크 {progressCurrent} / {progressTotal}
                      </p>
                    )}
                    <p className="text-sm text-blue-600 mt-1">
                      {elapsedMin}:{elapsedSec.toString().padStart(2, '0')}
                      {totalMin !== null && (
                        <span className="text-gray-500"> / {totalMin}:{totalSec!.toString().padStart(2, '0')}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{progress}</p>
                  </div>
                  <div className="w-full max-w-xs bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: progressTotal > 0 ? `${(progressCurrent / progressTotal) * 100}%` : '10%' }}
                    />
                  </div>
                </>
              );
            })()
          ) : (
            <>
              <div className="p-4 bg-gray-100 rounded-full">
                <Upload className="w-8 h-8 text-gray-500" />
              </div>
              <div>
                <p className="text-lg font-medium text-gray-700">
                  소설 파일을 업로드하세요
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  .txt, .pdf, .md 파일 지원
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Files className="w-4 h-4" />
                <span>여러 파일 선택 가능 (1편, 2편...)</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <FileText className="w-4 h-4" />
                <span>드래그 앤 드롭 또는 클릭</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 선택된 파일 표시 및 텍스트 입력 (새 분석 시에만) */}
      {!knowledgeGraph && !localLoading && (
        <>
          {/* 선택된 파일 목록 */}
          {selectedFiles.length > 0 && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-blue-800 flex items-center gap-2">
                  <FileCheck className="w-4 h-4" />
                  선택된 파일 ({selectedFiles.length}개)
                </p>
                <button
                  onClick={handleClearSelection}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  전체 취소
                </button>
              </div>
              <p className="text-xs text-blue-600 mb-2">순서대로 분석됩니다. 버튼으로 순서를 변경하세요.</p>
              <div className="space-y-1">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="flex items-center text-sm bg-white px-3 py-1.5 rounded-lg gap-2">
                    {/* 순서 번호 */}
                    <span className="w-6 h-6 flex items-center justify-center bg-blue-600 text-white text-xs font-bold rounded-full flex-shrink-0">
                      {index + 1}
                    </span>
                    {/* 파일명 */}
                    <span className="text-gray-700 truncate flex-1">{file.name}</span>
                    {/* 순서 변경 버튼 */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleMoveFileUp(index)}
                        disabled={index === 0}
                        className={`p-1 rounded ${index === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-100'}`}
                        title="위로 이동"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveFileDown(index)}
                        disabled={index === selectedFiles.length - 1}
                        className={`p-1 rounded ${index === selectedFiles.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-100'}`}
                        title="아래로 이동"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemoveFile(index)}
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                        title="삭제"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 텍스트 직접 입력 토글 */}
          {selectedFiles.length === 0 && (
            <div className="text-center">
              <button
                onClick={() => setShowTextInput(!showTextInput)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                {showTextInput ? '텍스트 입력 숨기기' : '또는 텍스트 직접 입력'}
              </button>
            </div>
          )}

          {/* 텍스트 직접 입력 영역 */}
          {showTextInput && selectedFiles.length === 0 && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
              <p className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                텍스트 직접 입력
              </p>
              <textarea
                value={directText}
                onChange={(e) => setDirectText(e.target.value)}
                placeholder="소설 텍스트를 직접 붙여넣기..."
                className={`w-full h-40 px-3 py-2 border rounded-lg text-sm resize-none ${
                  directText.trim() ? 'border-green-300' : 'border-gray-300'
                }`}
                disabled={localLoading}
              />
              <p className="text-xs text-gray-500 mt-1">
                {directText.length.toLocaleString()}자 입력됨
              </p>
            </div>
          )}

          {/* 중복 타이틀 경고 */}
          {isDuplicateTitle && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800">중복된 작품명</p>
                <p className="text-sm text-amber-600 mt-1">
                  "{fullTitle}" 이름의 작품이 이미 존재합니다. 다른 제목이나 작가명을 입력해주세요.
                </p>
              </div>
            </div>
          )}

          {/* 등록 버튼 */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleRegister}
              disabled={!canRegister || localLoading}
              className={`w-full max-w-md py-3 px-6 rounded-xl font-medium text-lg transition-all ${
                canRegister
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-lg hover:shadow-xl'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {localLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  분석 중...
                </span>
              ) : (
                '등록하기'
              )}
            </button>
            {!canRegister && !isDuplicateTitle && (
              <p className="text-xs text-gray-500">
                {!bookTitle.trim() && '제목'}
                {!bookTitle.trim() && !bookAuthor.trim() && ', '}
                {!bookAuthor.trim() && '작가'}
                {(!bookTitle.trim() || !bookAuthor.trim()) && (selectedFiles.length === 0 && !directText.trim()) && ', '}
                {selectedFiles.length === 0 && !directText.trim() && '파일 또는 텍스트'}
                를 입력해주세요
              </p>
            )}
          </div>
        </>
      )}

      {/* 추가 분석 버튼 (기존 결과가 있을 때만) */}
      {knowledgeGraph && !localLoading && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Plus className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-blue-800">추가 분석</p>
              <p className="text-sm text-blue-700 mt-1">
                현재 "{knowledgeGraph.metadata.title}"에 새 파일을 추가할 수 있습니다
              </p>
              <div className="flex gap-2 mt-3">
                <label className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors cursor-pointer">
                  <Plus className="w-4 h-4" />
                  파일 추가
                  <input
                    type="file"
                    accept=".txt,.pdf,.md,text/plain,text/markdown,application/pdf"
                    onChange={handleAddChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 이어하기 UI */}
      {savedProgress && !localLoading && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3">
            <RotateCcw className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-800">이전 분석 발견</p>
              <p className="text-sm text-amber-700 mt-1">
                "{savedProgress.title}" - {savedProgress.processedChunks}/{savedProgress.totalChunks} 청크 완료
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleResume}
                  className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  이어하기
                </button>
                <button
                  onClick={handleClearProgress}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  삭제
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 중복 파일명 경고 모달 */}
      {duplicateFileName && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-amber-500 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-gray-900">중복 파일명</h3>
                <p className="text-sm text-gray-600 mt-1">
                  "{duplicateFileName}" 파일이 이미 존재합니다.
                </p>
                <p className="text-sm text-gray-600">
                  새로운 파일명을 입력해주세요.
                </p>
              </div>
            </div>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="새 파일명 입력"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmNewFileName();
                if (e.key === 'Escape') handleCancelDuplicate();
              }}
            />
            {error && (
              <p className="text-sm text-red-600 mb-3">{error}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelDuplicate}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                취소
              </button>
              <button
                onClick={handleConfirmNewFileName}
                disabled={!newFileName.trim()}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 에러 메시지 */}
      {error && !duplicateFileName && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">오류 발생</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
