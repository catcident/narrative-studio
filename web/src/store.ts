/**
 * Zustand 스토어
 */

import { create } from 'zustand';
import type { NovelKnowledgeGraph, Entity, HyperEdge, ModelInfo, BillingSubscription, CurrentUsage, ChunkUsage, ViewMode, FileValidationResult, PartialAnalysisInfo } from './types';
import { AVAILABLE_MODELS } from './types';
import { getSubscription } from './services/billing';

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
  viewMode: ViewMode;

  // 채팅 관련
  chatMentionedEntities: string[];  // 채팅에서 언급된 엔티티 ID 목록

  // 파일 검증 관련
  validationResults: Map<string, FileValidationResult>;  // 파일별 검증 결과
  isValidating: boolean;  // 검증 진행 중 여부
  validatingFileId: string | null;  // 현재 검증 중인 파일 ID

  // Partial Analysis
  partialAnalysis: PartialAnalysisInfo | null;

  // Billing
  subscription: BillingSubscription | null;
  currentUsage: CurrentUsage;
  showUsageSummary: boolean;

  // Models (앱 수준 — reset()에서 유지)
  models: ModelInfo[];
  modelsLoaded: boolean;
  loadModels: () => Promise<void>;

  // Config (앱 수준 — reset()에서 유지)
  authEnabled: boolean | null;
  setAuthEnabled: (enabled: boolean) => void;

  // 액션
  setKnowledgeGraph: (knowledgeGraph: NovelKnowledgeGraph, originalText?: string, dataId?: string) => void;
  setCurrentDataId: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectEntity: (id: string | null) => void;
  selectTimePoint: (time: string | null) => void;
  selectScene: (sceneId: string | null) => void;
  selectSceneRange: (start: string | null, end: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setChatMentionedEntities: (entityIds: string[]) => void;
  setPartialAnalysis: (info: PartialAnalysisInfo | null) => void;
  reset: () => void;

  // 검증 액션
  setValidationResults: (results: Map<string, FileValidationResult>) => void;
  updateValidationResult: (fileId: string, result: FileValidationResult) => void;
  setIsValidating: (isValidating: boolean) => void;
  setValidatingFileId: (fileId: string | null) => void;
  clearValidationResults: () => void;

  // Billing 액션
  loadSubscription: () => Promise<void>;
  updateCreditBalance: (n: number) => void;
  addChunkUsage: (chunk: ChunkUsage) => void;
  resetCurrentUsage: () => void;
  setShowUsageSummary: (show: boolean) => void;
}

const initialUsage: CurrentUsage = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  chunks: [],
};

export const useStore = create<AppState>((set, get) => ({
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
  viewMode: (typeof window !== 'undefined' ? sessionStorage.getItem('viewMode') as ViewMode : null) || 'graph',
  chatMentionedEntities: [],
  validationResults: new Map(),
  isValidating: false,
  validatingFileId: null,
  partialAnalysis: null,
  subscription: null,
  currentUsage: initialUsage,
  showUsageSummary: false,
  models: AVAILABLE_MODELS,
  modelsLoaded: false,
  loadModels: async () => {
    try {
      const res = await fetch('/api/models');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (Array.isArray(json.models) && json.models.length > 0) {
        set({ models: json.models, modelsLoaded: true });
      }
    } catch (err: unknown) {
      console.warn('[models] 동적 모델 로딩 실패, 정적 목록 유지:', err instanceof Error ? err.message : err);
      set({ modelsLoaded: true });
    }
  },

  authEnabled: null,

  setAuthEnabled: (authEnabled) => set({ authEnabled }),
  setKnowledgeGraph: (knowledgeGraph, originalText, dataId) => {
    if (dataId) {
      sessionStorage.setItem('currentDataId', dataId);
    }
    set({
      knowledgeGraph,
      originalText: originalText || null,
      currentDataId: dataId || null,
      error: null,
    });
  },
  setCurrentDataId: (id) => {
    if (id) {
      sessionStorage.setItem('currentDataId', id);
    } else {
      sessionStorage.removeItem('currentDataId');
    }
    set({ currentDataId: id });
  },
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  selectEntity: (selectedEntityId) => set({ selectedEntityId }),
  selectTimePoint: (selectedTimePoint) => set({ selectedTimePoint }),
  selectScene: (selectedSceneId) => set({ selectedSceneId, sceneRangeStart: null, sceneRangeEnd: null }),
  selectSceneRange: (sceneRangeStart, sceneRangeEnd) => set({ sceneRangeStart, sceneRangeEnd, selectedSceneId: null }),
  setViewMode: (viewMode) => {
    sessionStorage.setItem('viewMode', viewMode);
    set({ viewMode });
  },
  setChatMentionedEntities: (chatMentionedEntities) => set({ chatMentionedEntities }),


  // 검증 액션
  setValidationResults: (validationResults) => set({ validationResults }),
  updateValidationResult: (fileId, result) => set((state) => {
    const newResults = new Map(state.validationResults);
    newResults.set(fileId, result);
    return { validationResults: newResults };
  }),
  setIsValidating: (isValidating) => set({ isValidating }),
  setValidatingFileId: (validatingFileId) => set({ validatingFileId }),
  clearValidationResults: () => set({ validationResults: new Map(), isValidating: false, validatingFileId: null }),

  setPartialAnalysis: (partialAnalysis) => set({ partialAnalysis }),
  reset: () => {
    sessionStorage.removeItem('currentDataId');
    sessionStorage.removeItem('viewMode');
    set({
      knowledgeGraph: null,
      originalText: null,
      currentDataId: null,
      selectedEntityId: null,
      selectedTimePoint: null,
      selectedSceneId: null,
      sceneRangeStart: null,
      sceneRangeEnd: null,
      viewMode: 'graph',
      chatMentionedEntities: [],
      validationResults: new Map(),
      isValidating: false,
      validatingFileId: null,
      partialAnalysis: null,
      error: null,
      currentUsage: initialUsage,
      showUsageSummary: false,
    });
  },

  // Billing 액션
  loadSubscription: async () => {
    try {
      const result = await getSubscription();
      if (result.ok && result.data.plan) {
        const info = result.data;
        set({
          subscription: {
            plan: info.plan.code,
            planName: info.plan.name,
            creditBalance: info.credit_balance,
            features: info.features,
            creditResetAt: info.credit_reset_at,
            status: info.status,
          },
        });
      }
      // !result.ok → subscription null 유지 (billing 미사용)
    } catch (err: unknown) {
      console.error('[billing] loadSubscription error:', err);
    }
  },
  updateCreditBalance: (n) => set((state) => ({
    subscription: state.subscription ? { ...state.subscription, creditBalance: n } : null,
  })),
  addChunkUsage: (chunk) => set((state) => ({
    currentUsage: {
      totalPromptTokens: state.currentUsage.totalPromptTokens + chunk.promptTokens,
      totalCompletionTokens: state.currentUsage.totalCompletionTokens + chunk.completionTokens,
      chunks: [...state.currentUsage.chunks, chunk],
    },
  })),
  resetCurrentUsage: () => set({ currentUsage: initialUsage }),
  setShowUsageSummary: (show) => set({ showUsageSummary: show }),
}));

// 셀렉터 헬퍼
export const useSelectedEntity = (): Entity | null => {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const selectedEntityId = useStore((s) => s.selectedEntityId);
  if (!knowledgeGraph || !selectedEntityId) return null;
  return knowledgeGraph.entities[selectedEntityId] || null;
};

export const useEntityEdges = (entityId: string | null): HyperEdge[] => {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  if (!knowledgeGraph || !entityId) return [];
  return Object.values(knowledgeGraph.hyperedges).filter(
    (edge) => edge.entities.includes(entityId)
  );
};

export const useBillingSubscription = () => useStore((s) => s.subscription);
export const useCreditBalance = () => useStore((s) => s.subscription?.creditBalance ?? null);
export const useAuthEnabled = () => useStore((s) => s.authEnabled);
export const useModels = () => useStore((s) => s.models);
export const useModelsLoaded = () => useStore((s) => s.modelsLoaded);
export const usePartialAnalysis = () => useStore((s) => s.partialAnalysis);
export const useByokEnabled = () => useStore((s) => s.subscription?.features?.byok ?? false);

export const useCharacters = (): Entity[] => {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  if (!knowledgeGraph) return [];
  return Object.values(knowledgeGraph.entities).filter(
    (e) => e.category === 'character'
  );
};

export const useValidationResults = () => useStore((s) => s.validationResults);
export const useIsValidating = () => useStore((s) => s.isValidating);
export const useValidatingFileId = () => useStore((s) => s.validatingFileId);
