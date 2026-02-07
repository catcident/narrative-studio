/**
 * 원본 텍스트 보기 컴포넌트
 * 업로드된 소스 파일들의 원문을 볼 수 있음
 * 각 파일에서 추출된 장면 목록도 표시
 */

import { FileText, ChevronDown, ChevronRight, Search, Copy, Check, Film, Trash2, ArrowUp, ArrowDown, Loader2, PlayCircle, Pencil, X, Save } from 'lucide-react';
import { useSourceTextView } from '../../hooks/useSourceTextView';
import { ValidationButton, ValidationPanel } from './ValidationPanel';

export function SourceTextView() {
  const {
    knowledgeGraph,
    isValidating,
    validatingFileId,

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

    sourceFiles,
    scenesByFile,
    filteredFiles,

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
  } = useSourceTextView();

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
        {filteredFiles.map((file, filteredIndex) => {
          // sourceFiles에서의 실제 인덱스 (검색 필터 시 filteredIndex와 다를 수 있음)
          const index = sourceFiles.findIndex(f => f.id === file.id);
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
                  <ValidationButton
                    fileId={file.id}
                    fileIndex={index}
                    validatingFileId={validatingFileId}
                    isValidating={isValidating}
                    expandedIssues={expandedIssues}
                    getValidationStatus={getValidationStatus}
                    handleValidateFile={handleValidateFile}
                    setExpandedIssues={setExpandedIssues}
                  />
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

                {/* 편집 버튼 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit(file.id, file.text);
                    if (!isExpanded) toggleFile(file.id);
                  }}
                  className="p-1.5 hover:bg-blue-100 rounded transition-colors"
                  title="텍스트 수정"
                  aria-label="텍스트 수정"
                >
                  <Pencil className="w-4 h-4 text-gray-400 hover:text-blue-500" aria-hidden="true" />
                </button>

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
              <ValidationPanel
                fileId={file.id}
                fileIndex={index}
                isValidating={isValidating}
                expandedIssues={expandedIssues}
                getValidationStatus={getValidationStatus}
                handleValidateFile={handleValidateFile}
                saveValidationResult={saveValidationResult}
                setExpandedIssues={setExpandedIssues}
              />

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

                  {editingFileId === file.id ? (
                    <div className="bg-yellow-50 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Pencil className="w-4 h-4 text-yellow-600" />
                        <span className="text-sm font-medium text-yellow-800">
                          텍스트 수정 중
                        </span>
                        <span className="text-xs text-yellow-600">
                          (수정 시 이 파일과 이후 파일들의 검증 결과가 초기화됩니다)
                        </span>
                      </div>
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className="w-full h-[400px] p-3 text-sm text-gray-700 font-sans leading-relaxed border rounded resize-y focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        placeholder="텍스트를 입력하세요..."
                      />
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => handleSaveEdit(file.id)}
                          disabled={isSavingEdit}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium disabled:opacity-50"
                        >
                          {isSavingEdit ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                          {isSavingEdit ? '저장 중...' : '저장'}
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          disabled={isSavingEdit}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-sm font-medium disabled:opacity-50"
                        >
                          <X className="w-4 h-4" />
                          취소
                        </button>
                        <span className="text-xs text-gray-500 ml-auto">
                          {editingText.length.toLocaleString()}자
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gray-50">
                      <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-[500px] overflow-y-auto">
                        {searchQuery ? highlightText(file.text, searchQuery) : file.text}
                      </pre>
                    </div>
                  )}
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
