/**
 * 파일 업로드 컴포넌트
 */

import { useCallback, useState, useEffect } from 'react';
import { Upload, FileText, Loader2, AlertCircle, RotateCcw, Play, Trash2, Files } from 'lucide-react';
import { useStore } from '../store';
import { extractOntology, hasProgress, clearProgress, type ExtractionProgress } from '../services/extraction';

export function FileUpload() {
  const { setOntology, setLoading, setError, error } = useStore();
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [savedProgress, setSavedProgress] = useState<ExtractionProgress | null>(null);

  // 저장된 진행상황 확인
  useEffect(() => {
    const saved = hasProgress();
    setSavedProgress(saved);
  }, []);

  // 이어하기
  const handleResume = useCallback(async () => {
    if (!savedProgress) return;

    setLocalLoading(true);
    setLoading(true);
    setError(null);
    setProgress(`이어하기: ${savedProgress.processedChunks}/${savedProgress.totalChunks}부터...`);

    try {
      const ontology = await extractOntology('', savedProgress.title, (msg) => {
        setProgress(msg);
      }, savedProgress);

      setOntology(ontology);
      setProgress('');
      setSavedProgress(null);
    } catch (err: any) {
      console.error('Resume error:', err);
      setError(err.message || '이어하기 중 오류가 발생했습니다.');
      setProgress('');
      // 진행상황 다시 확인
      setSavedProgress(hasProgress());
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [savedProgress, setOntology, setLoading, setError]);

  // 저장된 진행상황 삭제
  const handleClearProgress = useCallback(() => {
    clearProgress();
    setSavedProgress(null);
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
          text = await file.text();
        }

        textParts.push(text);
        titles.push(file.name.replace(/\.[^/.]+$/, ''));
      }

      const combinedText = textParts.join('\n\n--- 파일 구분 ---\n\n');
      const combinedTitle = sortedFiles.length === 1
        ? titles[0]
        : `${titles[0]} 외 ${sortedFiles.length - 1}개`;

      if (!combinedText.trim()) {
        throw new Error('파일 내용이 비어있습니다.');
      }

      const ontology = await extractOntology(combinedText, combinedTitle, (msg) => {
        setProgress(msg);
      });

      setOntology(ontology);
      setProgress('');
      setSavedProgress(null);
    } catch (err: any) {
      console.error('Extraction error:', err);
      setError(err.message || '파일 처리 중 오류가 발생했습니다.');
      setProgress('');
      setSavedProgress(hasProgress());
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [setOntology, setLoading, setError]);

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
        text = await file.text();
      }

      if (!text.trim()) {
        throw new Error('파일 내용이 비어있습니다.');
      }

      console.log('Extracting ontology from text:', text.slice(0, 200) + '...');

      const title = file.name.replace(/\.[^/.]+$/, '');
      const ontology = await extractOntology(text, title, (msg) => {
        setProgress(msg);
      });

      console.log('Extracted ontology:', ontology);
      console.log('Entities:', Object.keys(ontology.entities).length);
      console.log('Edges:', Object.keys(ontology.hyperedges).length);
      console.log('Scenes:', Object.keys(ontology.snapshots || {}).length);

      if (Object.keys(ontology.entities).length === 0) {
        throw new Error('추출된 엔티티가 없습니다. 소설 내용을 확인해주세요.');
      }

      setOntology(ontology);
      setProgress('');
      setSavedProgress(null);
    } catch (err: any) {
      console.error('Extraction error:', err);
      setError(err.message || '파일 처리 중 오류가 발생했습니다.');
      setProgress('');
      // 진행상황 다시 확인
      setSavedProgress(hasProgress());
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [setOntology, setLoading, setError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files.length > 1) {
      handleFiles(files);
    } else if (files.length === 1) {
      handleFile(files[0]);
    }
  }, [handleFile, handleFiles]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    if (files.length > 1) {
      handleFiles(files);
    } else if (files.length === 1) {
      handleFile(files[0]);
    }
  }, [handleFile, handleFiles]);

  return (
    <div className="space-y-4">
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
          accept=".txt,.pdf"
          onChange={handleChange}
          className="hidden"
          disabled={localLoading}
          multiple
        />

        <div className="flex flex-col items-center gap-4 text-center">
          {localLoading ? (
            <>
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
              <div>
                <p className="text-lg font-medium text-gray-700">분석 중...</p>
                <p className="text-sm text-blue-600 mt-1">{progress}</p>
              </div>
              <div className="w-full max-w-xs bg-gray-200 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-blue-500 animate-pulse" style={{ width: '60%' }} />
              </div>
            </>
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
                  .txt 또는 .pdf 파일 지원
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

      {/* 에러 메시지 */}
      {error && (
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
