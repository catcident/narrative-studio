/**
 * Zustand 스토어
 */

import { create } from 'zustand';
import type { NovelOntology, Entity, HyperEdge } from './types';

interface AppState {
  // 데이터
  ontology: NovelOntology | null;
  isLoading: boolean;
  error: string | null;

  // UI 상태
  selectedEntityId: string | null;
  selectedTimePoint: string | null;
  selectedSceneId: string | null;
  sceneRangeStart: string | null;  // 범위 선택 시작
  sceneRangeEnd: string | null;    // 범위 선택 끝
  viewMode: 'graph' | 'timeline' | 'chronicle' | 'world';

  // 액션
  setOntology: (ontology: NovelOntology) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectEntity: (id: string | null) => void;
  selectTimePoint: (time: string | null) => void;
  selectScene: (sceneId: string | null) => void;
  selectSceneRange: (start: string | null, end: string | null) => void;
  setViewMode: (mode: 'graph' | 'timeline' | 'chronicle' | 'world') => void;
  reset: () => void;
}

export const useStore = create<AppState>((set) => ({
  ontology: null,
  isLoading: false,
  error: null,
  selectedEntityId: null,
  selectedTimePoint: null,
  selectedSceneId: null,
  sceneRangeStart: null,
  sceneRangeEnd: null,
  viewMode: 'graph',

  setOntology: (ontology) => set({ ontology, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  selectEntity: (selectedEntityId) => set({ selectedEntityId }),
  selectTimePoint: (selectedTimePoint) => set({ selectedTimePoint }),
  selectScene: (selectedSceneId) => set({ selectedSceneId, sceneRangeStart: null, sceneRangeEnd: null }),
  selectSceneRange: (sceneRangeStart, sceneRangeEnd) => set({ sceneRangeStart, sceneRangeEnd, selectedSceneId: null }),
  setViewMode: (viewMode) => set({ viewMode }),
  reset: () => set({
    ontology: null,
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
  const { ontology, selectedEntityId } = useStore();
  if (!ontology || !selectedEntityId) return null;
  return ontology.entities[selectedEntityId] || null;
};

export const useEntityEdges = (entityId: string | null): HyperEdge[] => {
  const { ontology } = useStore();
  if (!ontology || !entityId) return [];
  return Object.values(ontology.hyperedges).filter(
    (edge) => edge.entities.includes(entityId)
  );
};

export const useCharacters = (): Entity[] => {
  const { ontology } = useStore();
  if (!ontology) return [];
  return Object.values(ontology.entities).filter(
    (e) => e.category === 'character'
  );
};
