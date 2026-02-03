/**
 * Zustand 스토어
 */

import { create } from 'zustand';
import type { NovelKnowledgeGraph, Entity, HyperEdge } from './types';

interface AppState {
  // 데이터
  knowledgeGraph: NovelKnowledgeGraph | null;
  originalText: string | null;  // 원본 소설 텍스트
  currentDataId: string | null;  // 현재 로드된 데이터의 저장소 ID (버전 관리용)
  isLoading: boolean;
  error: string | null;

  // UI 상태
  selectedEntityId: string | null;
  selectedTimePoint: string | null;
  selectedSceneId: string | null;
  sceneRangeStart: string | null;  // 범위 선택 시작
  sceneRangeEnd: string | null;    // 범위 선택 끝
  viewMode: 'graph' | 'timeline' | 'chronicle' | 'world' | 'source';

  // 액션
  setKnowledgeGraph: (knowledgeGraph: NovelKnowledgeGraph, originalText?: string, dataId?: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectEntity: (id: string | null) => void;
  selectTimePoint: (time: string | null) => void;
  selectScene: (sceneId: string | null) => void;
  selectSceneRange: (start: string | null, end: string | null) => void;
  setViewMode: (mode: 'graph' | 'timeline' | 'chronicle' | 'world' | 'source') => void;
  reset: () => void;
}

export const useStore = create<AppState>((set) => ({
  knowledgeGraph: null,
  originalText: null,
  currentDataId: null,
  isLoading: false,
  error: null,
  selectedEntityId: null,
  selectedTimePoint: null,
  selectedSceneId: null,
  sceneRangeStart: null,
  sceneRangeEnd: null,
  viewMode: 'graph',

  setKnowledgeGraph: (knowledgeGraph, originalText, dataId) => set({
    knowledgeGraph,
    originalText: originalText || null,
    currentDataId: dataId || null,
    error: null,
  }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  selectEntity: (selectedEntityId) => set({ selectedEntityId }),
  selectTimePoint: (selectedTimePoint) => set({ selectedTimePoint }),
  selectScene: (selectedSceneId) => set({ selectedSceneId, sceneRangeStart: null, sceneRangeEnd: null }),
  selectSceneRange: (sceneRangeStart, sceneRangeEnd) => set({ sceneRangeStart, sceneRangeEnd, selectedSceneId: null }),
  setViewMode: (viewMode) => set({ viewMode }),
  reset: () => set({
    knowledgeGraph: null,
    originalText: null,
    currentDataId: null,
    selectedEntityId: null,
    selectedTimePoint: null,
    selectedSceneId: null,
    sceneRangeStart: null,
    sceneRangeEnd: null,
    error: null,
  }),
}));

// 셀렉터 헬퍼
export const useSelectedEntity = (): Entity | null => {
  const { knowledgeGraph, selectedEntityId } = useStore();
  if (!knowledgeGraph || !selectedEntityId) return null;
  return knowledgeGraph.entities[selectedEntityId] || null;
};

export const useEntityEdges = (entityId: string | null): HyperEdge[] => {
  const { knowledgeGraph } = useStore();
  if (!knowledgeGraph || !entityId) return [];
  return Object.values(knowledgeGraph.hyperedges).filter(
    (edge) => edge.entities.includes(entityId)
  );
};

export const useCharacters = (): Entity[] => {
  const { knowledgeGraph } = useStore();
  if (!knowledgeGraph) return [];
  return Object.values(knowledgeGraph.entities).filter(
    (e) => e.category === 'character'
  );
};
