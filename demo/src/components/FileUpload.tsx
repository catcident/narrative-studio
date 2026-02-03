/**
 * 파일 업로드 컴포넌트
 */

import { useCallback, useState, useEffect } from 'react';
import { Upload, FileText, Loader2, AlertCircle, RotateCcw, Play, Trash2, Files, Plus, Key, Cpu } from 'lucide-react';
import { useStore } from '../store';
import { extractKnowledgeGraph, mergeKnowledgeGraphs, hasProgress, clearProgress, hasApiKey, setApiKey, type ExtractionProgress } from '../services/extraction';
import { saveKnowledgeGraph } from '../services/storage';
import { AVAILABLE_MODELS, DEFAULT_MODEL, type ModelInfo } from '../types';

export function FileUpload() {
  const { knowledgeGraph, currentDataId, setKnowledgeGraph, setLoading, setError, error } = useStore();
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [savedProgress, setSavedProgress] = useState<ExtractionProgress | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasLocalKey, setHasLocalKey] = useState(false);
  const [hasEnvKey, setHasEnvKey] = useState(true); // 기본으로 있다고 가정
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);

  // 기존 지식그래프가 있으면 해당 모델로 고정
  const lockedModel = knowledgeGraph?.metadata?.model;
  const currentModel = lockedModel || selectedModel;

  // 환경변수 API 키 및 저장된 진행상황 확인
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setHasEnvKey(data.hasEnvKey))
      .catch(() => setHasEnvKey(false));

    setHasLocalKey(hasApiKey());
    const saved = hasProgress();
    setSavedProgress(saved);
  }, []);

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
      const newKnowledgeGraph = await extractKnowledgeGraph('', savedProgress.title, (msg) => {
        setProgress(msg);
      }, savedProgress);

      // 저장하고 ID 받기
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      setKnowledgeGraph(newKnowledgeGraph, undefined, saved.id);
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
  }, [savedProgress, setKnowledgeGraph, setLoading, setError]);

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

      const newKnowledgeGraph = await extractKnowledgeGraph(combinedText, combinedTitle, (msg) => {
        setProgress(msg);
      }, undefined, currentModel);

      // 저장하고 ID 받기
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      // 원본 텍스트와 함께 저장 (ID도 함께)
      setKnowledgeGraph(newKnowledgeGraph, combinedText, saved.id);
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
        text = await file.text();
      }

      if (!text.trim()) {
        throw new Error('파일 내용이 비어있습니다.');
      }

      console.log('Extracting knowledgeGraph from text:', text.slice(0, 200) + '...');

      const title = file.name.replace(/\.[^/.]+$/, '');
      const newKnowledgeGraph = await extractKnowledgeGraph(text, title, (msg) => {
        setProgress(msg);
      }, undefined, currentModel);

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

      // 원본 텍스트와 함께 저장 (ID도 함께)
      setKnowledgeGraph(newKnowledgeGraph, text, saved.id);
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
  }, [setKnowledgeGraph, setLoading, setError, currentModel]);

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

  // 추가 분석 (기존 결과에 새 파일 병합)
  const handleAddFile = useCallback(async (file: File) => {
    if (!knowledgeGraph) return;

    console.log('추가 분석 시작:', file.name);
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
          const pageText = content.items.map((item: any) => item.str).join(' ');
          textParts.push(pageText);
        }
        text = textParts.join('\n\n');
      } else {
        text = await file.text();
      }

      if (!text.trim()) {
        throw new Error('파일 내용이 비어있습니다.');
      }

      const title = file.name.replace(/\.[^/.]+$/, '');
      setProgress('추가 분석 중...');
      // 추가 분석은 기존 문서의 모델을 사용 (lockedModel)
      const newKnowledgeGraph = await extractKnowledgeGraph(text, title, (msg) => {
        setProgress(`추가: ${msg}`);
      }, undefined, currentModel);

      // 기존 결과와 병합
      setProgress('기존 결과와 병합 중...');
      const merged = mergeKnowledgeGraphs(knowledgeGraph, newKnowledgeGraph);

      console.log('병합 완료:', merged.metadata.title);
      console.log('총 엔티티:', Object.keys(merged.entities).length);
      console.log('총 관계:', Object.keys(merged.hyperedges).length);

      // 기존 ID를 사용하여 저장 (버전 업데이트)
      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(merged, undefined, undefined, currentDataId || undefined);

      setKnowledgeGraph(merged, undefined, saved.id);
      setProgress('');
      setSavedProgress(null);
    } catch (err: any) {
      console.error('추가 분석 오류:', err);
      setError(err.message || '추가 분석 중 오류가 발생했습니다.');
      setProgress('');
      setSavedProgress(hasProgress());
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph, setLoading, setError, currentModel]);

  const handleAddChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    handleAddFile(files[0]);
  }, [handleAddFile]);

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
