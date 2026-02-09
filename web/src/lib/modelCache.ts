/**
 * OpenRouter 모델 목록 서버 사이드 캐시
 *
 * 큐레이션 목록(CURATED_MODEL_META)으로 필터,
 * per-token → per-1M-tokens 변환,
 * 1시간 캐시 TTL, 실패 시 stale cache → FALLBACK_MODELS 폴백.
 *
 * 듀얼 접근자:
 * - getCachedServerModels(): ServerModelInfo[] (서버 내부용, inputCost/outputCost 포함)
 * - getCachedClientModels(): ModelInfo[] (클라이언트 전달용, creditsPerChunk/creditsPerChat)
 */

import { FALLBACK_MODELS, CURATED_MODEL_META, type ModelInfo } from '@/types';
import {
  SERVER_MODEL_COSTS,
  computeCreditsPerChunk,
  computeCreditsPerChat,
  type ServerModelInfo,
} from './serverCosts';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간
const FETCH_TIMEOUT_MS = 10_000; // 10초

interface ModelCache {
  serverModels: ServerModelInfo[];
  clientModels: ModelInfo[];
  fetchedAt: number;
}

let cache: ModelCache | null = null;
let fetchPromise: Promise<ModelCache> | null = null;

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

/** ServerModelInfo → ModelInfo (USD 정보 strip, 이미 계산된 크레딧 값 사용) */
function toClientModel(server: ServerModelInfo): ModelInfo {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    creditsPerChunk: server.creditsPerChunk,
    creditsPerChat: server.creditsPerChat,
    available: server.available,
    coreModel: server.coreModel,
  };
}

async function fetchFromOpenRouter(): Promise<ModelCache> {
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
    const allModels: OpenRouterModel[] = json.data ?? [];

    const curatedIdSet = new Set(Object.keys(CURATED_MODEL_META));

    const serverModels: ServerModelInfo[] = [];
    for (const orModel of allModels) {
      if (!curatedIdSet.has(orModel.id)) continue;

      const meta = CURATED_MODEL_META[orModel.id];

      // pricing 구조 검증: 누락 시 정적 가격 폴백
      if (!orModel.pricing || typeof orModel.pricing.prompt !== 'string' || typeof orModel.pricing.completion !== 'string') {
        const staticCost = SERVER_MODEL_COSTS[orModel.id];
        if (staticCost) {
          console.warn(`[modelCache] ${orModel.id}: pricing 구조 누락, 정적 가격 사용`);
          serverModels.push({
            id: orModel.id,
            name: orModel.name,
            description: meta.description,
            inputCost: staticCost.inputCost,
            outputCost: staticCost.outputCost,
            creditsPerChunk: 0, // will be computed below
            creditsPerChat: 0,
            available: true,
            coreModel: meta.coreModel,
          });
        }
        continue;
      }

      const inputCost = toPerMillion(orModel.pricing.prompt);
      const outputCost = toPerMillion(orModel.pricing.completion);

      // 가격이 0(무효)이면 정적 가격 폴백 (과소 과금 방지)
      const staticCost = SERVER_MODEL_COSTS[orModel.id];
      const finalInputCost = inputCost > 0 ? inputCost : (staticCost?.inputCost ?? inputCost);
      const finalOutputCost = outputCost > 0 ? outputCost : (staticCost?.outputCost ?? outputCost);

      if (inputCost === 0 || outputCost === 0) {
        console.warn(`[modelCache] ${orModel.id}: 가격 파싱 실패, 정적 가격 사용`);
      }

      serverModels.push({
        id: orModel.id,
        name: orModel.name,
        inputCost: finalInputCost,
        outputCost: finalOutputCost,
        description: meta.description,
        creditsPerChunk: 0, // will be computed below
        creditsPerChat: 0,
        available: true,
        coreModel: meta.coreModel,
      });
    }

    // CURATED_MODEL_META에 있지만 OpenRouter에 없는 모델 = 만료됨
    const addedIds = new Set(serverModels.map(m => m.id));
    for (const modelId of curatedIdSet) {
      if (addedIds.has(modelId)) continue;
      const staticCost = SERVER_MODEL_COSTS[modelId];
      if (staticCost) {
        const meta = CURATED_MODEL_META[modelId];
        serverModels.push({
          id: modelId,
          name: modelId,
          description: meta?.description ?? '',
          inputCost: staticCost.inputCost,
          outputCost: staticCost.outputCost,
          creditsPerChunk: 0,
          creditsPerChat: 0,
          available: false,
          coreModel: meta?.coreModel ?? false,
        });
      }
    }

    // sortOrder로 정렬
    serverModels.sort((a, b) => {
      const orderA = CURATED_MODEL_META[a.id]?.sortOrder ?? 999;
      const orderB = CURATED_MODEL_META[b.id]?.sortOrder ?? 999;
      return orderA - orderB;
    });

    // creditsPerChunk/creditsPerChat 계산 (전체 모델 목록 확정 후)
    for (const m of serverModels) {
      m.creditsPerChunk = computeCreditsPerChunk(m.id, serverModels);
      m.creditsPerChat = computeCreditsPerChat(m.id, serverModels);
    }

    // 클라이언트 모델 생성 (USD 정보 strip, 이미 계산된 크레딧 값 복사)
    const clientModels = serverModels.map(toClientModel);

    return { serverModels, clientModels, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** FALLBACK_MODELS에서 ModelCache 생성 */
function buildFallbackCache(): ModelCache {
  const serverModels: ServerModelInfo[] = FALLBACK_MODELS.map(m => {
    const staticCost = SERVER_MODEL_COSTS[m.id] ?? { inputCost: 1.0, outputCost: 5.0 };
    return { ...m, inputCost: staticCost.inputCost, outputCost: staticCost.outputCost };
  });
  const clientModels = [...FALLBACK_MODELS];
  return { serverModels, clientModels, fetchedAt: 0 };
}

async function ensureCache(): Promise<ModelCache> {
  // 캐시가 유효한 경우 즉시 반환
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  // 이미 진행 중인 fetch가 있으면 대기
  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    try {
      const result = await fetchFromOpenRouter();
      cache = result;
      console.log(`[modelCache] OpenRouter에서 ${result.serverModels.length}개 모델 캐시 갱신`);
      return result;
    } catch (err: unknown) {
      console.warn('[modelCache] OpenRouter fetch 실패:', err instanceof Error ? err.message : err);

      // stale cache가 있으면 사용
      if (cache) {
        console.log('[modelCache] stale 캐시 사용');
        return cache;
      }

      // 폴백: 정적 모델 목록
      console.log('[modelCache] 정적 모델 목록 폴백');
      return buildFallbackCache();
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/**
 * 서버 내부용 모델 목록 (inputCost/outputCost 포함).
 * settle 정산 등 USD 계산이 필요한 서버 로직에서 사용.
 */
export async function getCachedServerModels(): Promise<ServerModelInfo[]> {
  const result = await ensureCache();
  return result.serverModels;
}

/**
 * 클라이언트 전달용 모델 목록 (creditsPerChunk/creditsPerChat).
 * /api/models 라우트에서 사용. inputCost/outputCost는 포함되지 않음.
 */
export async function getCachedClientModels(): Promise<ModelInfo[]> {
  const result = await ensureCache();
  return result.clientModels;
}
