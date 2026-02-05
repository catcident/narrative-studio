/**
 * 원본 텍스트 보기 컴포넌트
 * 업로드된 소스 파일들의 원문을 볼 수 있음
 * 각 파일에서 추출된 장면 목록도 표시
 */

import { useState, useMemo, useCallback } from 'react';
import { FileText, ChevronDown, ChevronRight, Search, Copy, Check, Film, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { updateKnowledgeGraph } from '../services/storage';
import type { SceneSnapshot, NovelKnowledgeGraph } from '../types';

export function SourceTextView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const currentDataId = useStore((s) => s.currentDataId);
  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const sourceFiles = useMemo(() => {
    return knowledgeGraph?.metadata.sourceFiles || [];
  }, [knowledgeGraph]);

  // 파일별 장면 매핑
  const scenesByFile = useMemo(() => {
    const map: Record<string, SceneSnapshot[]> = {};
    if (!knowledgeGraph?.snapshots) return map;

    // 파일이 1개뿐이면 모든 장면이 그 파일에서 온 것
    const singleFileMode = sourceFiles.length === 1;
    const singleFileName = singleFileMode ? sourceFiles[0].fileName : null;

    Object.values(knowledgeGraph.snapshots).forEach(scene => {
      // sourceFile이 있으면 그걸 사용
      let key = scene.sourceFile || scene.sourceFileId;

      // sourceFile이 없는 경우 (기존 데이터)
      if (!key) {
        if (singleFileName) {
          // 파일 1개면 모든 장면이 그 파일
          key = singleFileName;
        } else if (scene.chapterNumber && sourceFiles.length > 0) {
          // 여러 파일인 경우: chapterNumber로 파일 매핑 시도
          // 파일명에서 숫자 추출해서 매칭 (01화.md → 1, 02화.md → 2)
          const targetChapter = scene.chapterNumber;
          const matchedFile = sourceFiles.find(f => {
            const match = f.fileName.match(/(\d+)/);
            return match && parseInt(match[1]) === targetChapter;
          });
          if (matchedFile) {
            key = matchedFile.fileName;
          }
        }
      }

      if (!key) key = '_unknown';

      if (!map[key]) map[key] = [];
      map[key].push(scene);
    });

    // 각 파일의 장면들을 order 순으로 정렬
    Object.keys(map).forEach(key => {
      map[key].sort((a, b) => a.order - b.order);
    });

    return map;
  }, [knowledgeGraph?.snapshots, sourceFiles]);

  // 검색 결과 하이라이트
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;

    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 px-0.5 rounded">{part}</mark>
        : part
    );
  };

  // 파일 토글
  const toggleFile = (fileId: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  // 모두 펼치기/접기
  const toggleAll = () => {
    if (expandedFiles.size === sourceFiles.length) {
      setExpandedFiles(new Set());
    } else {
      setExpandedFiles(new Set(sourceFiles.map(f => f.id)));
    }
  };

  // 텍스트 복사
  const copyText = async (fileId: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(fileId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 검색어가 포함된 파일 필터링
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return sourceFiles;
    const query = searchQuery.toLowerCase();
    return sourceFiles.filter(f =>
      f.fileName.toLowerCase().includes(query) ||
      f.text.toLowerCase().includes(query)
    );
  }, [sourceFiles, searchQuery]);

  // 파일 삭제 핸들러
  const handleDeleteFile = useCallback(async (fileId: string, fileName: string) => {
    if (!knowledgeGraph || !currentDataId) return;

    setDeletingFileId(fileId);
    try {
      // 1. 삭제할 파일과 관련된 장면 ID 찾기
      const scenesToDelete = new Set<string>();
      Object.entries(knowledgeGraph.snapshots).forEach(([sceneId, scene]) => {
        const matchByName = scene.sourceFile === fileName;
        const matchById = scene.sourceFileId === fileId;
        if (matchByName || matchById) {
          scenesToDelete.add(sceneId);
          console.log(`[SourceTextView] 삭제 대상 장면: ${sceneId}, sourceFile=${scene.sourceFile}, sourceFileId=${scene.sourceFileId}`);
        }
      });

      console.log(`[SourceTextView] 삭제할 장면들: ${[...scenesToDelete].join(', ')} (총 ${scenesToDelete.size}개)`);
      console.log(`[SourceTextView] 전체 장면: ${Object.keys(knowledgeGraph.snapshots).join(', ')}`);

      // 2. 새 snapshots 객체 생성 (삭제된 장면 제외)
      const newSnapshots: Record<string, SceneSnapshot> = {};
      Object.entries(knowledgeGraph.snapshots).forEach(([sceneId, scene]) => {
        if (!scenesToDelete.has(sceneId)) {
          newSnapshots[sceneId] = scene;
        }
      });

      // 3. 남은 장면들의 order 재정렬 (기존 order 순으로 1부터 다시 번호 매기기)
      const remainingSourceFiles = knowledgeGraph.metadata.sourceFiles?.filter(f => f.id !== fileId) || [];
      const sortedScenes = Object.values(newSnapshots).sort((a, b) => a.order - b.order);
      let newOrder = 1;
      sortedScenes.forEach(scene => {
        newSnapshots[scene.sceneId] = { ...scene, order: newOrder++ };
      });

      // 4. entities의 scenes 배열에서 삭제된 장면 제거
      const newEntities = { ...knowledgeGraph.entities };
      Object.keys(newEntities).forEach(entityId => {
        const entity = newEntities[entityId];
        if (entity.scenes) {
          newEntities[entityId] = {
            ...entity,
            scenes: entity.scenes.filter(sceneId => !scenesToDelete.has(sceneId)),
          };
        }
      });

      // 5. hyperedges의 scenes 배열에서 삭제된 장면 제거 + 빈 관계 삭제
      const newHyperedges: typeof knowledgeGraph.hyperedges = {};
      Object.entries(knowledgeGraph.hyperedges).forEach(([edgeId, edge]) => {
        const filteredScenes = edge.scenes?.filter(sceneId => !scenesToDelete.has(sceneId)) || [];
        // 장면이 남아있는 관계만 유지
        if (filteredScenes.length > 0) {
          newHyperedges[edgeId] = {
            ...edge,
            scenes: filteredScenes,
          };
        }
      });

      // 6. 관계가 있는 엔티티 ID 수집 (양쪽 노드)
      const entitiesWithRelations = new Set<string>();
      Object.values(newHyperedges).forEach(edge => {
        edge.entities.forEach(entityId => entitiesWithRelations.add(entityId));
      });

      // 7. entities에서 관계가 없는 엔티티 삭제
      const finalEntities: typeof knowledgeGraph.entities = {};
      Object.entries(newEntities).forEach(([entityId, entity]) => {
        // 관계가 있거나 장면이 남아있는 엔티티만 유지
        const hasRelations = entitiesWithRelations.has(entityId);
        const hasScenes = entity.scenes && entity.scenes.length > 0;
        if (hasRelations || hasScenes) {
          finalEntities[entityId] = entity;
        }
      });

      // 8. sourceFiles에서 해당 파일 제거
      const newSourceFiles = remainingSourceFiles;

      // 9. 새 지식 그래프 생성
      const updatedGraph: NovelKnowledgeGraph = {
        ...knowledgeGraph,
        metadata: {
          ...knowledgeGraph.metadata,
          sourceFiles: newSourceFiles,
          updatedAt: new Date().toISOString(),
        },
        entities: finalEntities,
        hyperedges: newHyperedges,
        snapshots: newSnapshots,
        stats: {
          ...knowledgeGraph.stats,
          totalEntities: Object.keys(finalEntities).length,
          totalEdges: Object.keys(newHyperedges).length,
        },
      };

      // 8. 서버에 업데이트
      await updateKnowledgeGraph(currentDataId, updatedGraph);

      // 9. 스토어 업데이트
      setKnowledgeGraph(updatedGraph, undefined, currentDataId);

      const deletedEntities = Object.keys(knowledgeGraph.entities).length - Object.keys(finalEntities).length;
      const deletedEdges = Object.keys(knowledgeGraph.hyperedges).length - Object.keys(newHyperedges).length;
      console.log(`[SourceTextView] 파일 삭제 완료: ${fileName}, 삭제된 장면: ${scenesToDelete.size}개, 삭제된 엔티티: ${deletedEntities}개, 삭제된 관계: ${deletedEdges}개`);
    } catch (error) {
      console.error('[SourceTextView] 파일 삭제 실패:', error);
      alert('파일 삭제에 실패했습니다.');
    } finally {
      setDeletingFileId(null);
      setConfirmDeleteId(null);
    }
  }, [knowledgeGraph, currentDataId, setKnowledgeGraph]);

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
      </div>

      {/* 파일 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredFiles.map((file, index) => {
          const isExpanded = expandedFiles.has(file.id);
          const isCopied = copiedId === file.id;

          return (
            <div
              key={file.id}
              className="border rounded-lg overflow-hidden bg-white shadow-sm"
            >
              {/* 파일 헤더 */}
              <button
                onClick={() => toggleFile(file.id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left"
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

              {/* 파일 내용 */}
              {isExpanded && (
                <div className="border-t">
                  {/* 이 파일에서 추출된 장면들 */}
                  {(() => {
                    const scenes = scenesByFile[file.fileName] || scenesByFile[file.id] || [];
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

                  <div className="bg-gray-50">
                    <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-[500px] overflow-y-auto">
                      {searchQuery ? highlightText(file.text, searchQuery) : file.text}
                    </pre>
                  </div>
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
