/**
 * Zustand 스토어
 */

import { create } from 'zustand';
import type { NovelKnowledgeGraph, Entity, HyperEdge, ModelInfo, BillingSubscription, CurrentUsage, ChunkUsage, ViewMode, FileValidationResult, PartialAnalysisInfo, QueueItem } from './types';
import { AVAILABLE_MODELS } from './types';
import { getSubscription } from './services/billing';
import type { ByokMode } from './services/extraction';
import { getByokMode, setByokMode as persistByokMode } from './services/extraction';

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

  // Batch Analysis
  analysisQueue: QueueItem[];
  isQueueProcessing: boolean;

  // Billing
  subscription: BillingSubscription | null;
  currentUsage: CurrentUsage;
  showUsageSummary: boolean;

  // Models (앱 수준 — reset()에서 유지)
  models: ModelInfo[];
  modelsLoaded: boolean;
  loadModels: () => Promise<void>;

  // BYOK 모드 (앱 수준 — reset()에서 유지)
  byokMode: ByokMode;
  setByokMode: (mode: ByokMode) => void;

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

  // Batch Analysis 액션
  addToQueue: (items: QueueItem[]) => void;
  removeFromQueue: (id: string) => void;
  updateQueueItem: (id: string, updates: Partial<QueueItem>) => void;
  clearQueue: () => void;
  setQueueProcessing: (processing: boolean) => void;

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
  analysisQueue: [],
  isQueueProcessing: false,
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

  byokMode: (typeof window !== 'undefined' ? getByokMode() : 'disabled') as ByokMode,
  setByokMode: (mode) => {
    persistByokMode(mode);
    set({ byokMode: mode });
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

  // Batch Analysis 액션
  addToQueue: (items) => set((state) => ({
    analysisQueue: [...state.analysisQueue, ...items],
  })),
  removeFromQueue: (id) => set((state) => ({
    analysisQueue: state.analysisQueue.filter((item) => item.id !== id),
  })),
  updateQueueItem: (id, updates) => set((state) => ({
    analysisQueue: state.analysisQueue.map((item) =>
      item.id === id ? { ...item, ...updates } : item,
    ),
  })),
  clearQueue: () => set({ analysisQueue: [], isQueueProcessing: false }),
  setQueueProcessing: (isQueueProcessing) => set({ isQueueProcessing }),

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
      analysisQueue: [],
      isQueueProcessing: false,
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
            purchasedCreditBalance: info.purchased_credit_balance ?? 0,
            monthlyCredits: info.plan.monthly_credits,
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
// WARNING: 셀렉터 콜백 내 `?? []`/`?? {}` 사용 금지 — 매번 새 참조 생성으로 React #185 무한 루프 유발.
// 반드시 모듈 수준 상수 사용 (예: EMPTY_EXPORT_FORMATS). 원시값(null, false, 0)은 안전.
const EMPTY_EDGES: HyperEdge[] = [];
const EMPTY_ENTITIES: Entity[] = [];
const EMPTY_EXPORT_FORMATS: string[] = [];
const ALL_EXPORT_FORMATS: string[] = ['png', 'svg', 'pdf'];

export const useSelectedEntity = (): Entity | null => {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const selectedEntityId = useStore((s) => s.selectedEntityId);
  if (!knowledgeGraph || !selectedEntityId) return null;
  return knowledgeGraph.entities[selectedEntityId] || null;
};

export const useEntityEdges = (entityId: string | null): HyperEdge[] => {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  if (!knowledgeGraph || !entityId) return EMPTY_EDGES;
  return Object.values(knowledgeGraph.hyperedges).filter(
    (edge) => edge.entities.includes(entityId)
  );
};

export const useBillingSubscription = () => useStore((s) => s.subscription);
export const useCreditBalance = () => useStore((s) => s.subscription?.creditBalance ?? null);
export const usePurchasedCreditBalance = () => useStore((s) => s.subscription?.purchasedCreditBalance ?? null);
export const useAuthEnabled = () => useStore((s) => s.authEnabled);
export const useModels = () => useStore((s) => s.models);
export const useModelsLoaded = () => useStore((s) => s.modelsLoaded);
export const usePartialAnalysis = () => useStore((s) => s.partialAnalysis);
export const useByokEnabled = () => useStore((s) =>
  s.authEnabled === false ? true : s.subscription?.features?.byok ?? false);
export const useExportFormats = () => useStore((s) =>
  s.authEnabled === false ? ALL_EXPORT_FORMATS : s.subscription?.features?.export_formats ?? EMPTY_EXPORT_FORMATS);
export const useCanBatchAnalysis = () => useStore((s) =>
  s.authEnabled === false ? true : s.subscription?.features?.export_formats?.includes('pdf') ?? false);
export const useByokMode = () => useStore((s) => s.byokMode);
export const useAnalysisQueue = () => useStore((s) => s.analysisQueue);
export const useIsQueueProcessing = () => useStore((s) => s.isQueueProcessing);

export const useCharacters = (): Entity[] => {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  if (!knowledgeGraph) return EMPTY_ENTITIES;
  return Object.values(knowledgeGraph.entities).filter(
    (e) => e.category === 'character'
  );
};

export const useValidationResults = () => useStore((s) => s.validationResults);
export const useIsValidating = () => useStore((s) => s.isValidating);
export const useValidatingFileId = () => useStore((s) => s.validatingFileId);
