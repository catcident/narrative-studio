/**
 * 드래그 앤 드롭 업로드 영역 UI 컴포넌트
 */

import { Upload, FileText, Loader2, Files } from 'lucide-react';

interface UploadAreaProps {
  localLoading: boolean;
  dragActive: boolean;
  setDragActive: (v: boolean) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  progressCurrent: number;
  progressTotal: number;
  progress: string;
  elapsedSeconds: number;
  estimatedTotalSeconds: number | null;
}

export function UploadArea({
  localLoading,
  dragActive,
  setDragActive,
  handleDrop,
  handleChange,
  progressCurrent,
  progressTotal,
  progress,
  elapsedSeconds,
  estimatedTotalSeconds,
}: UploadAreaProps) {
  return (
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
            const totalMin = estimatedTotalSeconds !== null ? Math.floor(estimatedTotalSeconds / 60) : null;
            const totalSec = estimatedTotalSeconds !== null ? estimatedTotalSeconds % 60 : null;
            return (
              <>
                <Loader2 aria-hidden="true" className="w-12 h-12 text-blue-500 animate-spin" />
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
              <Upload aria-hidden="true" className="w-8 h-8 text-gray-500" />
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
              <Files aria-hidden="true" className="w-4 h-4" />
              <span>여러 파일 선택 가능 (1편, 2편...)</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <FileText aria-hidden="true" className="w-4 h-4" />
              <span>드래그 앤 드롭 또는 클릭</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
