/**
 * 저장된 온톨로지 데이터 그리드 컴포넌트
 * 카드 형태로 저장된 데이터를 보여줌
 */

import { useState, useEffect } from 'react';
import {
  Clock,
  Users,
  GitBranch,
  Trash2,
  Download,
  History,
  RotateCcw,
  Check,
  X,
  Upload,
} from 'lucide-react';
import {
  getSavedOntologyList,
  loadOntology,
  deleteOntology,
  exportOntology,
  importOntology,
  getVersionHistory,
  restoreVersion,
  type SavedOntologyMeta,
} from '../services/storage';
import type { NovelOntology } from '../types';

interface Props {
  onLoad: (ontology: NovelOntology) => void;
}

export function SavedDataGrid({ onLoad }: Props) {
  const [savedList, setSavedList] = useState<SavedOntologyMeta[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ version: number; savedAt: string; note?: string }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // 목록 새로고침
  const refreshList = () => {
    setSavedList(getSavedOntologyList());
  };

  useEffect(() => {
    refreshList();
  }, []);

  // 버전 히스토리 토글
  const toggleVersions = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (expandedId === id) {
      setExpandedId(null);
      setVersions([]);
    } else {
      setExpandedId(id);
      setVersions(getVersionHistory(id));
    }
  };

  // 온톨로지 불러오기
  const handleLoad = (id: string) => {
    const loaded = loadOntology(id);
    if (loaded) {
      onLoad(loaded);
    }
  };

  // 온톨로지 삭제
  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteOntology(id)) {
      refreshList();
      setConfirmDelete(null);
    }
  };

  // 온톨로지 내보내기
  const handleExport = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const loaded = loadOntology(id);
    if (loaded) {
      exportOntology(loaded);
    }
  };

  // 버전 복원
  const handleRestoreVersion = (ontologyId: string, version: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const restored = restoreVersion(ontologyId, version);
    if (restored) {
      onLoad(restored);
    }
  };

  // JSON 파일 가져오기
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const imported = await importOntology(file);
      onLoad(imported);
    } catch (err: any) {
      alert(err.message || '파일 가져오기 실패');
    }

    e.target.value = '';
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;

    return date.toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
    });
  };

  if (savedList.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 pt-6 border-t border-gray-200">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">저장된 데이터</h3>
        <label className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer transition-colors">
          <Upload className="w-3.5 h-3.5" />
          <span>JSON 가져오기</span>
          <input
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </label>
      </div>

      {/* 카드 그리드 - 4열, 최대 높이 제한 + 스크롤 */}
      <div className="grid grid-cols-4 gap-4 max-h-96 overflow-y-auto pr-1">
        {savedList.map((item) => (
          <div
            key={item.id}
            className="group relative"
          >
            {/* 카드 */}
            <button
              onClick={() => handleLoad(item.id)}
              className="w-full text-left p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all"
            >
              {/* 제목 */}
              <h4 className="font-medium text-gray-800 truncate pr-8" title={item.title}>
                {item.title}
              </h4>

              {/* 통계 */}
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {item.entityCount}
                </span>
                <span className="flex items-center gap-1">
                  <GitBranch className="w-3 h-3" />
                  {item.edgeCount}
                </span>
                <span className="text-gray-400">
                  장면 {item.sceneCount}
                </span>
              </div>

              {/* 시간 & 버전 */}
              <div className="flex items-center justify-between mt-2">
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Clock className="w-3 h-3" />
                  {formatDate(item.updatedAt)}
                </span>
                <span className="text-xs text-blue-500 font-medium">
                  v{item.version}
                </span>
              </div>
            </button>

            {/* 액션 버튼들 (호버 시 표시) */}
            <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {/* 버전 히스토리 */}
              <button
                onClick={(e) => toggleVersions(item.id, e)}
                className="p-1.5 bg-white/90 hover:bg-gray-100 rounded-lg shadow-sm transition-colors"
                title="버전 히스토리"
              >
                <History className="w-3.5 h-3.5 text-gray-500" />
              </button>

              {/* 내보내기 */}
              <button
                onClick={(e) => handleExport(item.id, e)}
                className="p-1.5 bg-white/90 hover:bg-green-50 rounded-lg shadow-sm transition-colors"
                title="JSON 내보내기"
              >
                <Download className="w-3.5 h-3.5 text-green-600" />
              </button>

              {/* 삭제 */}
              {confirmDelete === item.id ? (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={(e) => handleDelete(item.id, e)}
                    className="p-1.5 bg-red-500 hover:bg-red-600 rounded-lg shadow-sm transition-colors"
                    title="삭제 확인"
                  >
                    <Check className="w-3.5 h-3.5 text-white" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                    className="p-1.5 bg-white/90 hover:bg-gray-100 rounded-lg shadow-sm transition-colors"
                    title="취소"
                  >
                    <X className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(item.id); }}
                  className="p-1.5 bg-white/90 hover:bg-red-50 rounded-lg shadow-sm transition-colors"
                  title="삭제"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </button>
              )}
            </div>

            {/* 버전 히스토리 드롭다운 */}
            {expandedId === item.id && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-3">
                <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                  <History className="w-3 h-3" />
                  버전 히스토리
                </div>
                {versions.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">이전 버전이 없습니다</p>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {versions.map((v) => (
                      <button
                        key={v.version}
                        onClick={(e) => handleRestoreVersion(item.id, v.version, e)}
                        className="w-full flex items-center justify-between py-2 px-2 hover:bg-gray-50 rounded-lg text-left transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-700">v{v.version}</span>
                          <span className="text-xs text-gray-400">
                            {formatDate(v.savedAt)}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-blue-500">
                          <RotateCcw className="w-3 h-3" />
                          복원
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setExpandedId(null); }}
                  className="mt-2 w-full py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  닫기
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 안내 문구 */}
      <p className="mt-4 text-xs text-gray-400 text-center">
        카드를 클릭하면 불러옵니다 · 호버하면 버전/삭제 옵션 표시
      </p>
    </div>
  );
}
