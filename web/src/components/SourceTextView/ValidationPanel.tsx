/**
 * 검증 버튼 및 검증 결과 패널 컴포넌트
 */

import { Loader2, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import type { FileValidationResult } from '../../types';

interface ValidationButtonProps {
  fileId: string;
  fileIndex: number;
  validatingFileId: string | null;
  isValidating: boolean;
  expandedIssues: Set<string>;
  getValidationStatus: (fileId: string) => FileValidationResult | undefined;
  handleValidateFile: (fileId: string) => void;
  setExpandedIssues: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function ValidationButton({
  fileId,
  fileIndex,
  validatingFileId,
  isValidating,
  expandedIssues,
  getValidationStatus,
  handleValidateFile,
  setExpandedIssues,
}: ValidationButtonProps) {
  // 첫 번째 파일은 기준 파일
  if (fileIndex === 0) {
    return (
      <span className="text-xs px-2 py-1 bg-gray-100 text-gray-400 rounded">
        기준
      </span>
    );
  }

  const result = getValidationStatus(fileId);
  const isCurrentlyValidating = validatingFileId === fileId;

  if (isCurrentlyValidating) {
    return (
      <span className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        검증중
      </span>
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
        className="text-xs px-2 py-1 bg-gray-100 hover:bg-blue-100 text-gray-600 hover:text-blue-600 rounded transition-colors disabled:opacity-50"
      >
        검증하기
      </button>
    );
  }

  const toggleExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIssues(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  if (result.status === 'passed') {
    return (
      <button
        onClick={toggleExpanded}
        className="text-xs px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded transition-colors font-medium"
      >
        통과 {expandedIssues.has(fileId) ? '▲' : '▼'}
      </button>
    );
  }

  if (result.status === 'failed') {
    return (
      <button
        onClick={toggleExpanded}
        className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors font-medium"
      >
        이슈 {result.issues.length}개 {expandedIssues.has(fileId) ? '▲' : '▼'}
      </button>
    );
  }

  if (result.status === 'invalidated') {
    return (
      <button
        onClick={toggleExpanded}
        className="text-xs px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 rounded transition-colors font-medium"
      >
        재검증 필요 {expandedIssues.has(fileId) ? '▲' : '▼'}
      </button>
    );
  }

  return null;
}

interface ValidationPanelProps {
  fileId: string;
  fileIndex: number;
  isValidating: boolean;
  expandedIssues: Set<string>;
  getValidationStatus: (fileId: string) => FileValidationResult | undefined;
  handleValidateFile: (fileId: string) => void;
  saveValidationResult: (fileId: string, result: FileValidationResult) => Promise<void>;
  setExpandedIssues: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function ValidationPanel({
  fileId,
  fileIndex,
  isValidating,
  expandedIssues,
  getValidationStatus,
  handleValidateFile,
  saveValidationResult,
  setExpandedIssues,
}: ValidationPanelProps) {
  // 첫 번째 파일은 검증 패널 없음
  if (fileIndex === 0) return null;

  const result = getValidationStatus(fileId);
  if (!result || !expandedIssues.has(fileId)) return null;

  // passed 상태
  if (result.status === 'passed') {
    return (
      <div className="bg-green-50 border-t border-green-200 p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-green-600" />
          <span className="text-sm font-medium text-green-800">
            검증 통과
          </span>
          <span className="text-xs text-green-600">
            - 이전 {result.comparedWith.length}개 파일과 비교
          </span>
          <button
            onClick={() => handleValidateFile(fileId)}
            disabled={isValidating}
            className="ml-auto text-xs text-green-600 hover:text-green-800 underline disabled:opacity-50"
          >
            다시 검증
          </button>
        </div>
        {result.summary && (
          <p className="text-sm text-green-700 mt-2 bg-green-100 p-2 rounded">
            📋 {result.summary}
          </p>
        )}
        {result.validatedAt && (
          <p className="text-xs text-green-500 mt-1">
            검증 시간: {new Date(result.validatedAt).toLocaleString('ko-KR')}
          </p>
        )}
      </div>
    );
  }

  // failed 상태 (이슈가 있음)
  if (result.status === 'failed' && result.issues.length > 0) {
    return (
      <div className="bg-red-50 border-t border-red-200 p-3">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="w-4 h-4 text-red-600" />
          <span className="text-sm font-medium text-red-800">
            검증 이슈 ({result.issues.length}개)
          </span>
          <span className="text-xs text-red-500">
            - 이전 {result.comparedWith.length}개 파일과 비교
          </span>
          <button
            onClick={() => handleValidateFile(fileId)}
            disabled={isValidating}
            className="ml-auto text-xs text-red-600 hover:text-red-800 underline disabled:opacity-50"
          >
            다시 검증
          </button>
        </div>
        {result.summary && (
          <p className="text-sm text-red-700 mb-2 bg-red-100 p-2 rounded">
            📋 {result.summary}
          </p>
        )}
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
        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-red-200">
          <button
            onClick={async () => {
              // 이슈를 유지하면서 passed로 변경
              const passedResult: FileValidationResult = {
                ...result,
                status: 'passed',
              };
              await saveValidationResult(fileId, passedResult);
              setExpandedIssues(prev => {
                const newSet = new Set(prev);
                newSet.delete(fileId);
                return newSet;
              });
            }}
            className="text-xs px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded font-medium"
          >
            ✓ 확인 후 통과 처리
          </button>
          <span className="text-xs text-gray-500">
            이슈를 확인했고 문제없다고 판단하면 클릭
          </span>
        </div>
      </div>
    );
  }

  // invalidated 상태 - 이전 파일 검증 안 됨
  if (result.status === 'invalidated') {
    return (
      <div className="bg-yellow-50 border-t border-yellow-200 p-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
          <span className="text-sm font-medium text-yellow-800">
            재검증 필요
          </span>
          <span className="text-xs text-yellow-600">
            - 이전 파일이 아직 검증되지 않았습니다
          </span>
        </div>
        <p className="text-xs text-yellow-600 mt-2">
          앞 파일들을 먼저 검증한 후 이 파일을 검증해주세요.
        </p>
        <button
          onClick={() => handleValidateFile(fileId)}
          disabled={isValidating}
          className="mt-2 text-xs px-3 py-1 bg-yellow-200 hover:bg-yellow-300 text-yellow-800 rounded disabled:opacity-50"
        >
          그래도 검증하기
        </button>
      </div>
    );
  }

  return null;
}
