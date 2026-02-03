/**
 * 인물 관계도 데모 앱 (개선된 버전)
 * 장면/시점별 관계도 + 상세 정보 + 데이터 관리
 */

import { useState, useEffect } from 'react';
import { Network, Clock, User, RotateCcw, Database, Save, Globe, Plus, Loader2 } from 'lucide-react';
import { useStore } from './store';
import { FileUpload } from './components/FileUpload';
import { RelationshipGraph, GraphLegend } from './components/RelationshipGraph';
import { TimelineView } from './components/TimelineView';
import { CharacterChronicle } from './components/CharacterChronicle';
import { WorldView } from './components/WorldView';
import { DetailPanel } from './components/DetailPanel';
import { DataManager } from './components/DataManager';
import { SceneTimeline } from './components/SceneTimeline';
import { SavedDataGrid } from './components/SavedDataGrid';
import { saveOntology } from './services/storage';
import { extractOntology, mergeOntologies } from './services/extraction';
import type { NovelOntology } from './types';

type ViewMode = 'graph' | 'timeline' | 'chronicle' | 'world';

const VIEW_TABS: { mode: ViewMode; label: string; icon: typeof Network }[] = [
  { mode: 'graph', label: '관계도', icon: Network },
  { mode: 'timeline', label: '타임라인', icon: Clock },
  { mode: 'chronicle', label: '연대기', icon: User },
  { mode: 'world', label: '세계관', icon: Globe },
];

function App() {
  const {
    ontology, viewMode, setViewMode, reset, setOntology, error,
    selectedSceneId, selectScene,
    sceneRangeStart, sceneRangeEnd, selectSceneRange
  } = useStore();
  const [showDataManager, setShowDataManager] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isAddingFile, setIsAddingFile] = useState(false);
  const [addProgress, setAddProgress] = useState('');

  // 온톨로지가 변경되면 자동 저장
  useEffect(() => {
    if (ontology) {
      setSaveStatus('saving');
      const saved = saveOntology(ontology);
      console.log('자동 저장 완료:', saved.title, 'v' + saved.version);
      setSaveStatus('saved');

      // 2초 후 상태 초기화
      const timer = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => clearTimeout(timer);
    }
  }, [ontology]);

  // 데이터 관리자에서 불러오기
  const handleLoadOntology = (loaded: NovelOntology) => {
    setOntology(loaded);
    setShowDataManager(false);
  };

  // 파일 추가 (기존 결과에 병합)
  const handleAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !ontology) return;

    setIsAddingFile(true);
    setAddProgress('파일 읽는 중...');

    try {
      let text = '';
      if (file.type === 'application/pdf') {
        setAddProgress('PDF 파싱 중...');
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const textParts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          setAddProgress(`PDF ${i}/${pdf.numPages}...`);
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          textParts.push(content.items.map((item: any) => item.str).join(' '));
        }
        text = textParts.join('\n\n');
      } else {
        text = await file.text();
      }

      if (!text.trim()) throw new Error('파일 내용이 비어있습니다.');

      const title = file.name.replace(/\.[^/.]+$/, '');
      const newOntology = await extractOntology(text, title, (msg) => {
        setAddProgress(msg);
      });

      setAddProgress('병합 중...');
      const merged = mergeOntologies(ontology, newOntology);
      setOntology(merged);
      setAddProgress('');
    } catch (err: any) {
      console.error('파일 추가 오류:', err);
      alert(err.message || '파일 추가 중 오류가 발생했습니다.');
    } finally {
      setIsAddingFile(false);
      e.target.value = '';  // input 초기화
    }
  };

  // 업로드 화면
  if (!ontology) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col items-center justify-center p-6">
        {/* 상단: 업로드 영역 */}
        <div className="w-full max-w-xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-2xl mb-4">
              <Network className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-800">인물 관계도</h1>
            <p className="text-gray-500 mt-2">
              소설을 업로드하면 AI가 자동으로 인물 관계를 분석합니다
            </p>
          </div>

          <FileUpload />

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="mt-6 text-center text-xs text-gray-400">
            지원 형식: .txt, .pdf
          </div>
        </div>

        {/* 하단: 저장된 데이터 그리드 (더 넓게) */}
        <div className="w-full max-w-4xl">
          <SavedDataGrid onLoad={handleLoadOntology} />
        </div>
      </div>
    );
  }

  const entities = Object.values(ontology.entities);
  const allEdges = Object.values(ontology.hyperedges);
  const scenes = Object.entries(ontology.snapshots || {}).sort(([a], [b]) => a.localeCompare(b));

  // 선택된 장면에 따른 필터링
  const currentScene = selectedSceneId ? ontology.snapshots[selectedSceneId] : null;
  const selectedSceneIndex = selectedSceneId ? scenes.findIndex(([id]) => id === selectedSceneId) : -1;

  // 범위 내 장면 ID 목록 계산
  const getScenesInRange = (): string[] => {
    if (!sceneRangeStart || !sceneRangeEnd) return [];
    const startIdx = scenes.findIndex(([id]) => id === sceneRangeStart);
    const endIdx = scenes.findIndex(([id]) => id === sceneRangeEnd);
    if (startIdx === -1 || endIdx === -1) return [];
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);
    return scenes.slice(minIdx, maxIdx + 1).map(([id]) => id);
  };

  // 선택된 장면까지의 모든 장면 ID (누적)
  const getScenesUpTo = (): string[] => {
    if (selectedSceneIndex === -1) return [];
    return scenes.slice(0, selectedSceneIndex + 1).map(([id]) => id);
  };

  const scenesInRange = getScenesInRange();
  const scenesUpTo = getScenesUpTo();
  const hasRangeSelection = scenesInRange.length > 0;

  // 현재 장면의 엔티티/엣지인지 확인 (투명도 구분용)
  const isCurrentSceneEntity = (e: typeof entities[0]): boolean => {
    if (!selectedSceneId) return true;
    if (e.scenes && e.scenes.includes(selectedSceneId)) return true;
    if (currentScene?.charactersPresent?.includes(e.id)) return true;
    return false;
  };

  const isCurrentSceneEdge = (e: typeof allEdges[0]): boolean => {
    if (!selectedSceneId) return true;
    if (e.scenes && e.scenes.includes(selectedSceneId)) return true;
    if (currentScene?.activeEdges?.includes(e.id)) return true;
    return false;
  };

  // 장면 선택 시: 해당 장면까지의 모든 엔티티와 관계 표시 (누적)
  // 범위 선택 시: 범위 내 모든 장면의 엔티티와 관계 표시
  const filteredEntities = hasRangeSelection
    ? entities.filter(e => {
        // 범위 내 어떤 장면에라도 등장하면 포함
        if (e.scenes && e.scenes.some(s => scenesInRange.includes(s))) return true;
        // snapshots의 charactersPresent 확인
        for (const sceneId of scenesInRange) {
          const snapshot = ontology.snapshots?.[sceneId];
          if (snapshot?.charactersPresent?.includes(e.id)) return true;
        }
        return false;
      })
    : selectedSceneId
      ? entities.filter(e => {
          // 선택한 장면까지의 모든 장면에서 등장한 엔티티 포함 (누적)
          if (e.scenes && e.scenes.some(s => scenesUpTo.includes(s))) return true;
          // snapshots의 charactersPresent 확인
          for (const sceneId of scenesUpTo) {
            const snapshot = ontology.snapshots?.[sceneId];
            if (snapshot?.charactersPresent?.includes(e.id)) return true;
          }
          return false;
        })
      : entities;

  const filteredEdges = hasRangeSelection
    ? allEdges.filter(e => {
        // 범위 내 어떤 장면에라도 등장하면 포함
        if (e.scenes && e.scenes.some(s => scenesInRange.includes(s))) return true;
        // snapshots의 activeEdges 확인
        for (const sceneId of scenesInRange) {
          const snapshot = ontology.snapshots?.[sceneId];
          if (snapshot?.activeEdges?.includes(e.id)) return true;
        }
        return false;
      })
    : selectedSceneId
      ? allEdges.filter(e => {
          // 선택한 장면까지의 모든 장면에서 등장한 엣지 포함 (누적)
          if (e.scenes && e.scenes.some(s => scenesUpTo.includes(s))) return true;
          // snapshots의 activeEdges 확인
          for (const sceneId of scenesUpTo) {
            const snapshot = ontology.snapshots?.[sceneId];
            if (snapshot?.activeEdges?.includes(e.id)) return true;
          }
          return false;
        })
      : allEdges;

  // 투명도 정보 추가 (현재 장면이 아닌 것은 투명하게)
  const entitiesWithOpacity = filteredEntities.map(e => ({
    ...e,
    isPastScene: selectedSceneId ? !isCurrentSceneEntity(e) : false,
  }));

  const edgesWithOpacity = filteredEdges.map(e => ({
    ...e,
    isPastScene: selectedSceneId ? !isCurrentSceneEdge(e) : false,
  }));

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Network className="w-6 h-6 text-blue-600" />
              <h1 className="font-bold text-gray-800">인물 관계도</h1>
            </div>
            <span className="text-sm text-gray-500">
              {ontology.metadata.title}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* 통계 */}
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>엔티티 {ontology.stats.totalEntities}</span>
              <span>관계 {ontology.stats.totalEdges}</span>
              {scenes.length > 0 && <span>장면 {scenes.length}</span>}
            </div>

            {/* 뷰 전환 탭 */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              {VIEW_TABS.map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                    ${viewMode === mode
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* 저장 상태 */}
            {saveStatus === 'saving' && (
              <span className="text-xs text-gray-400 animate-pulse">저장 중...</span>
            )}
            {saveStatus === 'saved' && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <Save className="w-3 h-3" />
                저장됨
              </span>
            )}

            {/* 데이터 관리 */}
            <button
              onClick={() => setShowDataManager(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Database className="w-4 h-4" />
              데이터 관리
            </button>

            {/* 파일 추가 */}
            <label className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer ${
              isAddingFile
                ? 'bg-blue-100 text-blue-600'
                : 'text-blue-600 hover:text-blue-800 hover:bg-blue-50'
            }`}>
              {isAddingFile ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {addProgress || '추가 중...'}
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  파일 추가
                </>
              )}
              <input
                type="file"
                accept=".txt,.pdf"
                onChange={handleAddFile}
                className="hidden"
                disabled={isAddingFile}
              />
            </label>

            {/* 리셋 */}
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              새 파일
            </button>
          </div>
        </div>
      </header>

      {/* 장면 타임라인 (장면이 있을 때만) */}
      {viewMode === 'graph' && scenes.length > 0 && (
        <SceneTimeline
          scenes={scenes}
          chapters={ontology.chapters}
          selectedSceneId={selectedSceneId}
          sceneRangeStart={sceneRangeStart}
          sceneRangeEnd={sceneRangeEnd}
          onSelectScene={selectScene}
          onSelectRange={selectSceneRange}
        />
      )}

      {/* 메인 컨텐츠 */}
      <main className="flex-1 flex overflow-hidden">
        {/* 왼쪽: 메인 뷰 */}
        <div className="flex-1 flex flex-col min-w-0">
          {viewMode === 'graph' && (
            <>
              <div className="p-3">
                <GraphLegend />
              </div>
              <div className="flex-1 p-3 pt-0">
                <RelationshipGraph
                  entities={entitiesWithOpacity}
                  edges={edgesWithOpacity}
                />
              </div>
            </>
          )}

          {viewMode === 'timeline' && <TimelineView />}

          {viewMode === 'chronicle' && <CharacterChronicle />}

          {viewMode === 'world' && <WorldView />}
        </div>

        {/* 오른쪽: 상세 패널 */}
        <div className="w-96 border-l border-gray-200 flex-shrink-0 overflow-hidden">
          <DetailPanel />
        </div>
      </main>

      {/* 데이터 관리 모달 */}
      {showDataManager && (
        <DataManager
          onClose={() => setShowDataManager(false)}
          onLoad={handleLoadOntology}
        />
      )}
    </div>
  );
}

export default App;
