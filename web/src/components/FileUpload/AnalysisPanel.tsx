/**
 * 분석 설정 UI 컴포넌트
 * API 키 입력, 모델 선택, 제목/작가 입력, 파일 목록, 텍스트 입력, 등록 버튼
 */

import React, { useState } from 'react';
import { Key, Cpu, BookOpen, User, FileCheck, FileText, Loader2, AlertCircle, ChevronUp, ChevronDown, X } from 'lucide-react';
import { UsageEstimate } from '../UsageEstimate';
import type { ModelInfo, NovelKnowledgeGraph } from '../../types';

interface AnalysisPanelProps {
  // API key
  hasEnvKey: boolean;
  hasLocalKey: boolean;
  showApiKeyInput: boolean;
  setShowApiKeyInput: (v: boolean) => void;
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  handleSaveApiKey: () => void;
  byokEnabled: boolean;
  onRemoveApiKey: () => void;
  onClearKeyValidationError: () => void;
  keyValidationLoading: boolean;
  keyValidationError: string | null;
  // Model
  currentModel: string;
  lockedModel: string | undefined;
  localLoading: boolean;
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  availableModels: ModelInfo[];
  allModels: ModelInfo[];  // 잠금 모델 이름 조회용 (만료 포함)
  // Title/Author
  knowledgeGraph: NovelKnowledgeGraph | null;
  bookTitle: string;
  setBookTitle: (v: string) => void;
  bookAuthor: string;
  setBookAuthor: (v: string) => void;
  // Files
  selectedFiles: File[];
  handleRemoveFile: (index: number) => void;
  handleMoveFileUp: (index: number) => void;
  handleMoveFileDown: (index: number) => void;
  handleClearSelection: () => void;
  // Text input
  showTextInput: boolean;
  setShowTextInput: (v: boolean) => void;
  directText: string;
  setDirectText: (v: string) => void;
  // Title validation
  isDuplicateTitle: boolean;
  fullTitle: string;
  canRegister: boolean;
  // Register
  handleRegister: () => void;
  // Batch analysis (Pro+ multi-file)
  canBatchAnalysis: boolean;
  onBatchAnalysis?: () => void;
  // Slot for upload area (rendered between title/author and file list)
  uploadAreaSlot?: React.ReactNode;
}

export function AnalysisPanel({
  hasEnvKey,
  hasLocalKey,
  showApiKeyInput,
  setShowApiKeyInput,
  apiKeyInput,
  setApiKeyInput,
  handleSaveApiKey,
  byokEnabled,
  onRemoveApiKey,
  onClearKeyValidationError,
  keyValidationLoading,
  keyValidationError,
  currentModel,
  lockedModel,
  localLoading,
  selectedModel,
  setSelectedModel,
  availableModels,
  allModels,
  knowledgeGraph,
  bookTitle,
  setBookTitle,
  bookAuthor,
  setBookAuthor,
  selectedFiles,
  handleRemoveFile,
  handleMoveFileUp,
  handleMoveFileDown,
  handleClearSelection,
  showTextInput,
  setShowTextInput,
  directText,
  setDirectText,
  isDuplicateTitle,
  fullTitle,
  canRegister,
  handleRegister,
  canBatchAnalysis,
  onBatchAnalysis,
  uploadAreaSlot,
}: AnalysisPanelProps) {
  const [showAllModels, setShowAllModels] = useState(false);

  return (
    <>
      {/* API 키 입력 - 환경변수 없을 때만 경고, 또는 사용자가 직접 입력 원할 때 */}
      {!hasEnvKey && !hasLocalKey && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Key aria-hidden="true" className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
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

      {/* 자신의 API 키 사용 옵션 — byokEnabled일 때만 표시 (서버키 없는 경우 제외) */}
      {(hasEnvKey || hasLocalKey) && !showApiKeyInput && byokEnabled && (
        <div className="text-center space-y-1">
          <button
            onClick={() => setShowApiKeyInput(true)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            <Key aria-hidden="true" className="w-3 h-3 inline mr-1" />
            {hasLocalKey ? '내 API 키 변경' : '내 API 키 사용하기'}
          </button>
          {hasLocalKey && (
            <button
              onClick={onRemoveApiKey}
              className="block mx-auto text-xs text-red-400 hover:text-red-600"
            >
              개인 키 삭제 (서버 키로 복귀)
            </button>
          )}
        </div>
      )}

      {/* byok 미지원 플랜: 로컬키 있으면 삭제 버튼 표시 */}
      {(hasEnvKey || hasLocalKey) && !showApiKeyInput && !byokEnabled && hasLocalKey && (
        <div className="text-center">
          <button
            onClick={onRemoveApiKey}
            className="text-xs text-red-400 hover:text-red-600"
          >
            개인 키 삭제 (서버 키로 복귀)
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
              disabled={keyValidationLoading}
            />
            <button
              onClick={handleSaveApiKey}
              disabled={keyValidationLoading || !apiKeyInput.trim()}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {keyValidationLoading && <Loader2 aria-hidden="true" className="w-3 h-3 animate-spin" />}
              {keyValidationLoading ? '검증 중' : '저장'}
            </button>
            <button
              onClick={() => { setShowApiKeyInput(false); onClearKeyValidationError(); }}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300"
            >
              취소
            </button>
          </div>
          {keyValidationError && (
            <p className="text-xs text-red-600 mt-1.5">{keyValidationError}</p>
          )}
        </div>
      )}

      {/* 모델 선택 */}
      <div className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl">
        <div className="flex items-start gap-3">
          <Cpu aria-hidden="true" className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
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
              {/* 핵심 모델 */}
              <optgroup label="핵심 모델">
                {availableModels.filter(m => m.coreModel !== false).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} - {model.description} (~{model.creditsPerChunk} 크레딧/청크)
                  </option>
                ))}
              </optgroup>
              {/* 추가 모델 (showAllModels일 때만) */}
              {showAllModels && availableModels.some(m => m.coreModel === false) && (
                <optgroup label="추가 모델">
                  {availableModels.filter(m => m.coreModel === false).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} - {model.description} (~{model.creditsPerChunk} 크레딧/청크)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {/* 더 보기 / 접기 토글 */}
            {!lockedModel && availableModels.some(m => m.coreModel === false) && (
              <button
                onClick={() => setShowAllModels(!showAllModels)}
                className="text-xs text-purple-500 hover:text-purple-700 mt-1"
              >
                {showAllModels ? '핵심 모델만 보기' : `더 많은 모델 보기 (${availableModels.filter(m => m.coreModel === false).length}종)`}
              </button>
            )}
            {lockedModel && (
              <p className="text-xs text-purple-600 mt-1">
                이 문서는 {allModels.find(m => m.id === lockedModel)?.name || lockedModel}로 분석되었습니다. 추가 분석도 같은 모델을 사용합니다.
              </p>
            )}
            {!lockedModel && (
              <p className="text-xs text-gray-500 mt-1">
                비용은 크레딧/청크 단위입니다. 고품질 모델은 더 정확하지만 비용이 높습니다.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 제목/작가 입력 (새 분석 시에만 표시) - 필수 */}
      {!knowledgeGraph && (
        <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl">
          <div className="flex items-start gap-3">
            <BookOpen aria-hidden="true" className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-emerald-800 mb-3">작품 정보 <span className="text-red-500">*</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-emerald-700 mb-1 block">제목 <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <BookOpen aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
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
                    <User aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
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

      {uploadAreaSlot}

      {/* 선택된 파일 표시 및 텍스트 입력 (새 분석 시에만) */}
      {!knowledgeGraph && !localLoading && (
        <>
          {/* 선택된 파일 목록 */}
          {selectedFiles.length > 0 && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-blue-800 flex items-center gap-2">
                  <FileCheck aria-hidden="true" className="w-4 h-4" />
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
                        aria-label="위로 이동"
                        title="위로 이동"
                      >
                        <ChevronUp aria-hidden="true" className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveFileDown(index)}
                        disabled={index === selectedFiles.length - 1}
                        className={`p-1 rounded ${index === selectedFiles.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-100'}`}
                        aria-label="아래로 이동"
                        title="아래로 이동"
                      >
                        <ChevronDown aria-hidden="true" className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemoveFile(index)}
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                        aria-label="삭제"
                        title="삭제"
                      >
                        <X aria-hidden="true" className="w-4 h-4" />
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
                <FileText aria-hidden="true" className="w-4 h-4" />
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
              <AlertCircle aria-hidden="true" className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800">중복된 작품명</p>
                <p className="text-sm text-amber-600 mt-1">
                  "{fullTitle}" 이름의 작품이 이미 존재합니다. 다른 제목이나 작가명을 입력해주세요.
                </p>
              </div>
            </div>
          )}

          {/* 예상 사용량 — 파일은 bytes→chars 근사 변환 (UTF-8 한글 ~3bytes/char) */}
          {(selectedFiles.length > 0 || directText.trim()) && (
            <UsageEstimate
              charCount={directText.trim() ? directText.length : Math.ceil(selectedFiles.reduce((sum, f) => sum + f.size, 0) / 3)}
              model={currentModel}
            />
          )}

          {/* 등록 버튼 */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-2 w-full max-w-md">
              <button
                onClick={handleRegister}
                disabled={!canRegister || localLoading}
                className={`flex-1 py-3 px-6 rounded-xl font-medium text-lg transition-all ${
                  canRegister
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-lg hover:shadow-xl'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {localLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" />
                    분석 중...
                  </span>
                ) : (
                  canBatchAnalysis && selectedFiles.length > 1 ? '통합 분석' : '등록하기'
                )}
              </button>
              {canBatchAnalysis && selectedFiles.length > 1 && onBatchAnalysis && (
                <button
                  onClick={onBatchAnalysis}
                  disabled={!canRegister || localLoading}
                  className={`py-3 px-4 rounded-xl font-medium text-sm transition-all ${
                    canRegister
                      ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 shadow-lg hover:shadow-xl'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  개별 분석
                </button>
              )}
            </div>
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
    </>
  );
}
