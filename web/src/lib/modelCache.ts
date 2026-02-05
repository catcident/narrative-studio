/**
 * OpenRouter 모델 목록 서버 사이드 캐시
 *
 * 큐레이션 목록(CURATED_MODEL_META)으로 필터,
 * per-token → per-1M-tokens 변환,
 * 1시간 캐시 TTL, 실패 시 stale cache → AVAILABLE_MODELS 폴백.
 */

import { AVAILABLE_MODELS, CURATED_MODEL_META, type ModelInfo } from '@/types';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간
const FETCH_TIMEOUT_MS = 10_000; // 10초

interface ModelCache {
  models: ModelInfo[];
  fetchedAt: number;
}

let cache: ModelCache | null = null;
let fetchPromise: Promise<ModelInfo[]> | null = null;

interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: string;      // per-token USD (string)
    completion: string;  // per-token USD (string)
  };
  top_provider?: {
    is_moderated?: boolean;
  };
  architecture?: {
    modality?: string;
  };
  per_request_limits?: unknown;
}

function toPerMillion(perToken: string): number {
  const val = parseFloat(perToken);
  if (isNaN(val) || val <= 0) return 0;
  return parseFloat((val * 1_000_000).toFixed(4));
}

async function fetchFromOpenRouter(): Promise<ModelInfo[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const json = await response.json();
    const allModels: OpenRouterModel[] = json.data || [];

    const curatedIds = Object.keys(CURATED_MODEL_META);

    const models: ModelInfo[] = [];
    for (const orModel of allModels) {
      if (!curatedIds.includes(orModel.id)) continue;

      const meta = CURATED_MODEL_META[orModel.id];
      const inputCost = toPerMillion(orModel.pricing.prompt);
      const outputCost = toPerMillion(orModel.pricing.completion);

      models.push({
        id: orModel.id,
        name: orModel.name,
        inputCost,
        outputCost,
        description: meta.description,
        available: true,
      });
    }

    // CURATED_MODEL_META에 있지만 OpenRouter에 없는 모델 = 만료됨
    for (const modelId of curatedIds) {
      if (!models.find((m) => m.id === modelId)) {
        const staticModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
        if (staticModel) {
          models.push({
            ...staticModel,
            available: false,
          });
        }
      }
    }

    // sortOrder로 정렬
    models.sort((a, b) => {
      const orderA = CURATED_MODEL_META[a.id]?.sortOrder ?? 999;
      const orderB = CURATED_MODEL_META[b.id]?.sortOrder ?? 999;
      return orderA - orderB;
    });

    return models;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 캐시된 모델 목록 반환.
 * - 캐시 유효: 즉시 반환
 * - 캐시 만료/없음: OpenRouter fetch 시도
 * - fetch 실패: stale cache 우선, 없으면 AVAILABLE_MODELS 폴백
 */
export async function getCachedModels(): Promise<ModelInfo[]> {
  // 캐시가 유효한 경우 즉시 반환
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models;
  }

  // 이미 진행 중인 fetch가 있으면 대기
  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    try {
      const models = await fetchFromOpenRouter();
      cache = { models, fetchedAt: Date.now() };
      console.log(`[modelCache] OpenRouter에서 ${models.length}개 모델 캐시 갱신`);
      return models;
    } catch (err: unknown) {
      console.warn('[modelCache] OpenRouter fetch 실패:', err instanceof Error ? err.message : err);

      // stale cache가 있으면 사용
      if (cache) {
        console.log('[modelCache] stale 캐시 사용');
        return cache.models;
      }

      // 폴백: 정적 모델 목록
      console.log('[modelCache] 정적 모델 목록 폴백');
      return AVAILABLE_MODELS;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}
