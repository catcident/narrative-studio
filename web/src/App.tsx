/**
 * 인물 관계도 데모 앱 (개선된 버전)
 * 장면/시점별 관계도 + 상세 정보 + 데이터 관리
 */

import { useState, useEffect } from 'react';
import { Network, Clock, User, RotateCcw, Database, Save, Globe, Plus, Loader2, FileText } from 'lucide-react';
import { useStore } from './store';
import { FileUpload } from './components/FileUpload';
import { RelationshipGraph, GraphLegend } from './components/RelationshipGraph';
import { TimelineView } from './components/TimelineView';
import { CharacterChronicle } from './components/CharacterChronicle';
import { WorldView } from './components/WorldView';
import { SourceTextView } from './components/SourceTextView';
import { DetailPanel } from './components/DetailPanel';
import { DataManager } from './components/DataManager';
import { SceneTimeline } from './components/SceneTimeline';
import { SavedDataGrid } from './components/SavedDataGrid';
import { UserMenu } from './components/UserMenu';
import { CreditBadge } from './components/CreditBadge';
import { UsageSummary } from './components/UsageSummary';
import { SubscriptionPage } from './components/SubscriptionPage';
import { saveKnowledgeGraph, saveNovelText } from './services/storage';
import { extractKnowledgeGraph } from './services/extraction';
import { readFileAsText } from './services/fileReader';
import { createBillingCallback, checkSufficientBalance } from './services/billing';
import type { NovelKnowledgeGraph, ViewMode } from './types';

const VIEW_TABS: { mode: ViewMode; label: string; icon: typeof Network }[] = [
  { mode: 'graph', label: '관계도', icon: Network },
  { mode: 'timeline', label: '타임라인', icon: Clock },
  { mode: 'chronicle', label: '연대기', icon: User },
  { mode: 'world', label: '세계관', icon: Globe },
  { mode: 'source', label: '원본', icon: FileText },
];

function App() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const originalText = useStore((s) => s.originalText);
  const currentDataId = useStore((s) => s.currentDataId);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const reset = useStore((s) => s.reset);
  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const selectedSceneId = useStore((s) => s.selectedSceneId);
  const selectScene = useStore((s) => s.selectScene);
  const sceneRangeStart = useStore((s) => s.sceneRangeStart);
  const sceneRangeEnd = useStore((s) => s.sceneRangeEnd);
  const selectSceneRange = useStore((s) => s.selectSceneRange);
  const loadSubscription = useStore((s) => s.loadSubscription);
  const subscription = useStore((s) => s.subscription);
  const addChunkUsage = useStore((s) => s.addChunkUsage);
  const resetCurrentUsage = useStore((s) => s.resetCurrentUsage);
  const updateCreditBalance = useStore((s) => s.updateCreditBalance);
  const setShowUsageSummary = useStore((s) => s.setShowUsageSummary);
  const [showDataManager, setShowDataManager] = useState(false);
  const [showSubscriptionPage, setShowSubscriptionPage] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isAddingFile, setIsAddingFile] = useState(false);
  const [addProgress, setAddProgress] = useState('');

  // 로그인 시 구독 정보 로드
  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  // 지식 그래프가 변경되면 자동 저장
  // FileUpload에서 저장한 경우 currentDataId가 이미 있으므로 중복 저장 방지
  useEffect(() => {
    let cancelled = false;

    if (knowledgeGraph && !currentDataId) {
      setSaveStatus('saving');

      const saveData = async () => {
        try {
          let novelId: string | undefined;
          if (originalText) {
            const novelSaved = await saveNovelText(knowledgeGraph.metadata.title, originalText);
            if (cancelled) return;
            novelId = novelSaved.id;
            console.log('[storage] 소설 텍스트 저장 완료:', novelSaved.title, `(${originalText.length}자)`);
          }

          const saved = await saveKnowledgeGraph(knowledgeGraph, novelId);
          if (cancelled) return;
          console.log('[storage] 지식그래프 저장 완료:', saved.title, 'v' + saved.version);
          setSaveStatus('saved');
        } catch (err: unknown) {
          console.error('[storage] 자동 저장 실패:', err);
          if (!cancelled) setSaveStatus('idle');
        }
      };

      saveData();

      const timer = setTimeout(() => { if (!cancelled) setSaveStatus('idle'); }, 2000);
      return () => { cancelled = true; clearTimeout(timer); };
    } else if (currentDataId) {
      setSaveStatus('saved');
      const timer = setTimeout(() => { if (!cancelled) setSaveStatus('idle'); }, 2000);
      return () => { cancelled = true; clearTimeout(timer); };
    }

    return () => { cancelled = true; };
  }, [knowledgeGraph, originalText, currentDataId]);

  // 데이터 관리자에서 불러오기 (ID 포함)
  const handleLoadKnowledgeGraph = (loaded: NovelKnowledgeGraph, dataId?: string) => {
    setKnowledgeGraph(loaded, undefined, dataId);
    setShowDataManager(false);
  };

  // 파일 추가 (기존 결과에 병합)
  const handleAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !knowledgeGraph) return;

    setIsAddingFile(true);
    setAddProgress('파일 읽는 중...');
    resetCurrentUsage();

    try {
      const text = await readFileAsText(file, setAddProgress);

      if (!text.trim()) throw new Error('파일 내용이 비어있습니다.');

      // 기존 데이터에 사용된 모델로 분석 (일관성 유지)
      const existingModel = knowledgeGraph.metadata.model;

      // 잔액 사전 확인
      if (subscription) {
        const balanceCheck = await checkSufficientBalance();
        if (!balanceCheck.sufficient) throw new Error(balanceCheck.error);
      }

      // 기존 지식그래프를 전달하여 이어서 분석
      const updatedKnowledgeGraph = await extractKnowledgeGraph({
        text,
        title: knowledgeGraph.metadata.title,
        onProgress: (msg) => setAddProgress(msg),
        model: existingModel,
        fileName: file.name,
        existingGraph: knowledgeGraph,
        onChunkBilling: createBillingCallback(addChunkUsage, updateCreditBalance),
      });

      // DB에 저장 (기존 ID 사용하여 업데이트)
      setAddProgress('저장 중...');
      const saved = await saveKnowledgeGraph(updatedKnowledgeGraph, undefined, undefined, currentDataId || undefined);

      setKnowledgeGraph(updatedKnowledgeGraph, undefined, saved.id);
      setAddProgress('');
      setShowUsageSummary(true);
    } catch (err: unknown) {
      console.error('[extraction] 파일 추가 오류:', err);
      setError(err instanceof Error ? err.message : '파일 추가 중 오류가 발생했습니다.');
    } finally {
      setIsAddingFile(false);
      e.target.value = '';  // input 초기화
    }
  };

  // 업로드 화면
  if (!knowledgeGraph) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col items-center justify-center p-6 relative">
        {/* 우상단: 크레딧 + 유저메뉴 */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <CreditBadge onClick={() => setShowSubscriptionPage(true)} />
          <UserMenu />
        </div>

        {/* 상단: 업로드 영역 */}
        <div className="w-full max-w-xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-2xl mb-4">
              <Network aria-hidden="true" className="w-8 h-8 text-blue-600" />
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
            지원 형식: .txt, .pdf, .md
          </div>
        </div>

        {/* 하단: 저장된 데이터 그리드 (4열 - 가운데 2개가 위 박스와 같은 너비) */}
        <div className="w-full" style={{ maxWidth: 'calc(36rem * 2)' }}>
          <SavedDataGrid onLoad={handleLoadKnowledgeGraph} />
        </div>

        {/* 모달 (업로드 화면에서도 접근 가능) */}
        {showSubscriptionPage && (
          <SubscriptionPage onClose={() => setShowSubscriptionPage(false)} />
        )}
        <UsageSummary />
      </div>
    );
  }

  const entities = Object.values(knowledgeGraph.entities);
  const allEdges = Object.values(knowledgeGraph.hyperedges);
  /**
   * ⚠️ 장면 정렬: chapterNumber 먼저, 같은 장 내에서 order 사용
   *
   * 문제 상황 (order만 사용):
   *   - 2화 먼저 업로드: order = 1, 2
   *   - 1화 나중 업로드: order = 3, 4, 5
   *   - 결과: 2화 → 1화 순서로 표시됨
   *
   * 해결 (chapterNumber 우선):
   *   - 1화 (chapterNumber=1): 장면 3, 4, 5 → 먼저 표시
   *   - 2화 (chapterNumber=2): 장면 1, 2 → 나중에 표시
   */
  const scenes = Object.entries(knowledgeGraph.snapshots || {}).sort(([, a], [, b]) => {
    // 1. chapterNumber로 먼저 정렬 (1화 → 2화 → 3화...)
    const chapterA = a.chapterNumber || 0;
    const chapterB = b.chapterNumber || 0;
    if (chapterA !== chapterB) {
      return chapterA - chapterB;
    }
    // 2. 같은 장 내에서는 order로 정렬
    return (a.order || 0) - (b.order || 0);
  });

  // 선택된 장면에 따른 필터링
  const currentScene = selectedSceneId ? knowledgeGraph.snapshots[selectedSceneId] : null;
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
          const snapshot = knowledgeGraph.snapshots?.[sceneId];
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
            const snapshot = knowledgeGraph.snapshots?.[sceneId];
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
          const snapshot = knowledgeGraph.snapshots?.[sceneId];
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
            const snapshot = knowledgeGraph.snapshots?.[sceneId];
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
              <Network aria-hidden="true" className="w-6 h-6 text-blue-600" />
              <h1 className="font-bold text-gray-800">인물 관계도</h1>
            </div>
            <span className="text-sm text-gray-500">
              {knowledgeGraph.metadata.title}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* 통계 */}
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>엔티티 {knowledgeGraph.stats.totalEntities}</span>
              <span>관계 {knowledgeGraph.stats.totalEdges}</span>
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
                  <Icon aria-hidden="true" className="w-4 h-4" />
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
                <Save aria-hidden="true" className="w-3 h-3" />
                저장됨
              </span>
            )}

            {/* 크레딧 배지 */}
            <CreditBadge onClick={() => setShowSubscriptionPage(true)} />

            {/* 데이터 관리 */}
            <button
              onClick={() => setShowDataManager(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Database aria-hidden="true" className="w-4 h-4" />
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
                  <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                  {addProgress || '추가 중...'}
                </>
              ) : (
                <>
                  <Plus aria-hidden="true" className="w-4 h-4" />
                  파일 추가
                </>
              )}
              <input
                type="file"
                accept=".txt,.pdf,.md,text/plain,text/markdown,application/pdf"
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
              <RotateCcw aria-hidden="true" className="w-4 h-4" />
              새 파일
            </button>

            {/* 로그아웃 */}
            <UserMenu className="pl-4 border-l border-gray-200" />
          </div>
        </div>
      </header>

      {/* 장면 타임라인 (장면이 있을 때만) */}
      {viewMode === 'graph' && scenes.length > 0 && (
        <SceneTimeline
          scenes={scenes}
          chapters={knowledgeGraph.chapters}
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
              <div className="p-3 flex-shrink-0">
                <GraphLegend />
              </div>
              <div className="flex-1 p-3 pt-0 min-h-0">
                <RelationshipGraph
                  entities={entitiesWithOpacity}
                  edges={edgesWithOpacity}
                  selectedScene={currentScene ? { ...currentScene, sceneId: selectedSceneId! } : null}
                  sceneIndex={selectedSceneIndex + 1}
                />
              </div>
            </>
          )}

          {viewMode === 'timeline' && <TimelineView />}

          {viewMode === 'chronicle' && <CharacterChronicle />}

          {viewMode === 'world' && <WorldView />}

          {viewMode === 'source' && <SourceTextView />}
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
          onLoad={handleLoadKnowledgeGraph}
        />
      )}

      {/* 구독 관리 모달 */}
      {showSubscriptionPage && (
        <SubscriptionPage onClose={() => setShowSubscriptionPage(false)} />
      )}

      {/* 사용량 요약 모달 */}
      <UsageSummary />
    </div>
  );
}

export default App;
