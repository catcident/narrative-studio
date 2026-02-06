/**
 * 저장된 지식 그래프 데이터 관리 컴포넌트
 */

import { useState, useEffect } from 'react';
import {
  Database,
  Trash2,
  Download,
  Upload,
  Clock,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Plus,
  Check,
  X,
} from 'lucide-react';
import {
  getSavedKnowledgeGraphList,
  loadKnowledgeGraph,
  deleteKnowledgeGraph,
  exportKnowledgeGraph,
  importKnowledgeGraph,
  getVersionHistory,
  restoreVersion,
  type SavedKnowledgeGraphMeta,
} from '../services/storage';
import { useStore } from '../store';
import type { NovelKnowledgeGraph } from '../types';
import { ModalOverlay } from './ModalOverlay';

interface Props {
  onClose: () => void;
  onLoad: (data: NovelKnowledgeGraph, dataId?: string) => void;
}

export function DataManager({ onClose, onLoad }: Props) {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const [savedList, setSavedList] = useState<SavedKnowledgeGraphMeta[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ version: number; savedAt: string; note?: string; addedFiles?: string | null }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // 목록 새로고침
  const refreshList = async () => {
    const list = await getSavedKnowledgeGraphList();
    setSavedList(list);
  };

  useEffect(() => {
    let cancelled = false;
    getSavedKnowledgeGraphList().then(list => {
      if (!cancelled) setSavedList(list);
    });
    return () => { cancelled = true; };
  }, []);

  // 버전 히스토리 토글
  const toggleVersions = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setVersions([]);
    } else {
      setExpandedId(id);
      const history = await getVersionHistory(id);
      setVersions(history);
    }
  };

  // 데이터 불러오기
  const handleLoad = async (id: string) => {
    const loaded = await loadKnowledgeGraph(id);
    if (loaded) {
      onLoad(loaded, id);
      onClose();
    }
  };

  // 데이터 삭제
  const handleDelete = async (id: string) => {
    const deleted = await deleteKnowledgeGraph(id);
    if (deleted) {
      await refreshList();
      setConfirmDelete(null);
    }
  };

  // 데이터 내보내기
  const handleExport = async (id: string) => {
    const loaded = await loadKnowledgeGraph(id);
    if (loaded) {
      exportKnowledgeGraph(loaded);
    }
  };

  // 버전 복원
  const handleRestoreVersion = async (dataId: string, version: number) => {
    const restored = await restoreVersion(dataId, version);
    if (restored) {
      onLoad(restored, dataId);
      onClose();
    }
  };

  // JSON 파일 가져오기
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImportError(null);
      const imported = await importKnowledgeGraph(file);
      onLoad(imported);
      onClose();
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : '파일 가져오기 실패');
    }

    // 입력 초기화
    e.target.value = '';
  };

  // 현재 데이터 내보내기
  const handleExportCurrent = () => {
    if (knowledgeGraph) {
      exportKnowledgeGraph(knowledgeGraph);
    }
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <ModalOverlay onClose={onClose} maxWidth="2xl">
      <div className="max-h-[80vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold">저장된 데이터 관리</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="닫기"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* 상단 액션 */}
        <div className="flex items-center gap-2 p-4 border-b bg-gray-50">
          <label className="flex items-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-lg cursor-pointer hover:bg-blue-600 transition-colors">
            <Upload className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm">JSON 가져오기</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </label>

          {knowledgeGraph && (
            <button
              onClick={handleExportCurrent}
              className="flex items-center gap-2 px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span className="text-sm">현재 데이터 내보내기</span>
            </button>
          )}
        </div>

        {importError && (
          <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {importError}
          </div>
        )}

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto p-4">
          {savedList.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
              <p>저장된 데이터가 없습니다</p>
              <p className="text-sm mt-1">소설을 분석하면 자동으로 저장됩니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedList.map((item) => (
                <div
                  key={item.id}
                  className="border rounded-xl overflow-hidden"
                >
                  {/* 메인 정보 */}
                  <div className="p-4 bg-white">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 truncate">
                          {item.title}
                        </h3>
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                          <span>엔티티 {item.entityCount}</span>
                          <span>관계 {item.edgeCount}</span>
                          <span>장면 {item.sceneCount}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          <span>{formatDate(item.updatedAt)}</span>
                          <span className="ml-2">v{item.version}</span>
                        </div>
                      </div>

                      {/* 액션 버튼 */}
                      <div className="flex items-center gap-1 ml-4">
                        <button
                          onClick={() => handleLoad(item.id)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="불러오기"
                          aria-label="불러오기"
                        >
                          <Plus className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => handleExport(item.id)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="내보내기"
                          aria-label="내보내기"
                        >
                          <Download className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => toggleVersions(item.id)}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                          title="버전 히스토리"
                          aria-label="버전 히스토리"
                        >
                          {expandedId === item.id ? (
                            <ChevronUp className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="w-4 h-4" aria-hidden="true" />
                          )}
                        </button>

                        {confirmDelete === item.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="삭제 확인"
                              aria-label="삭제 확인"
                            >
                              <Check className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                              title="취소"
                              aria-label="취소"
                            >
                              <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(item.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="삭제"
                            aria-label="삭제"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 버전 히스토리 */}
                  {expandedId === item.id && (
                    <div className="bg-gray-50 border-t px-4 py-3">
                      <div className="text-xs font-medium text-gray-500 mb-2">
                        버전 히스토리
                      </div>
                      {versions.length === 0 ? (
                        <p className="text-xs text-gray-400">이전 버전이 없습니다</p>
                      ) : (
                        <div className="space-y-2">
                          {versions.map((v) => (
                            <div
                              key={v.version}
                              className="flex items-center justify-between py-2 px-3 bg-white rounded-lg text-sm"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">v{v.version}</span>
                                  <span className="text-gray-400 text-xs">
                                    {formatDate(v.savedAt)}
                                  </span>
                                </div>
                                {v.addedFiles && (
                                  <div className="text-xs text-green-600 mt-0.5 truncate">
                                    + {v.addedFiles}
                                  </div>
                                )}
                                {v.note && !v.addedFiles && (
                                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                                    {v.note}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => handleRestoreVersion(item.id, v.version)}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors flex-shrink-0"
                              >
                                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                                복원
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="p-4 border-t bg-gray-50 text-xs text-gray-500 rounded-b-xl">
          데이터는 서버에 저장됩니다.
        </div>
      </div>
    </ModalOverlay>
  );
}
