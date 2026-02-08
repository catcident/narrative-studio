/**
 * 지식 그래프 추출 서비스 — 내부 타입 및 상수
 */

import type { NovelKnowledgeGraph, Entity, HyperEdge } from '../../types';

export const CATEGORY_NAMES: Record<string, string> = {
  character: '인물',
  location: '장소',
  item: '물건',
  organization: '조직',
  event: '사건',
  concept: '개념',
};

// 엔티티 정보 타입 (모든 카테고리 지원)
export interface KnownEntity {
  name: string;
  description: string;
  category: string;
  aliases?: string[];
}

// 엔티티 요약 정보 (관계 포함)
export interface EntitySummary {
  name: string;
  category: string;
  description: string;
  relations: string[];  // "타입 → 상대: 설명" 형태
}

// knownEntities 크기 제한 (카테고리별로 관리)
export const MAX_KNOWN_ENTITIES = 100;  // 전체 최대
export const MAX_PER_CATEGORY = 30;     // 카테고리별 최대

export interface ChunkBilling {
  prompt_tokens: number;
  completion_tokens: number;
  model: string;
  credits_deducted?: number;
  balance_after?: number | null;
  insufficient_balance?: boolean;
  byok?: boolean;
}

/** LLM B가 청크에서 추출한 로어북 엔트리 (raw) */
export interface RawLoreEntry {
  entity_name: string;
  category: string;
  content: string;
  quote?: string;
  scene: number;  // 이 청크 내의 장면 번호 (localToGlobal 매핑 필요)
}

/** LLM이 단일 청크에서 추출한 데이터 */
export interface ChunkExtractedData {
  chapters: Array<{ id: number | string; title?: string; summary?: string }>;
  scenes: Array<{
    id: number; chapter?: number; location?: string; summary?: string;
    events?: string[]; mood?: string; time?: string; time_marker?: string | null;
  }>;
  entities: Array<{
    name: string; category?: string; description?: string; aliases?: string[];
    scenes?: number[]; attributes?: Record<string, unknown>; importance?: number;
  }>;
  relationships: Array<{
    from: string; to: string; type: string; description?: string; scenes?: number[];
    sentiment?: string; strength?: number; quote?: string; subtype?: string;
    start_time?: string; bidirectional?: boolean; from_perspective?: string; to_perspective?: string;
  }>;
  lore_entries?: RawLoreEntry[];
}

export const EMPTY_CHUNK_DATA: ChunkExtractedData = {
  chapters: [], scenes: [], entities: [], relationships: [],
};

export interface ChunkExtractionResult {
  data: ChunkExtractedData;
  billing: ChunkBilling | null;
}

/** LLM B 로어북 추출 결과 */
export interface LoreExtractionResult {
  data: RawLoreEntry[];
  billing: ChunkBilling | null;
}

// 중간 저장용 타입
export interface ExtractionProgress {
  title: string;
  totalChunks: number;
  processedChunks: number;
  allExtracted: ChunkExtractedData[];
  allExtractedLore?: RawLoreEntry[][];  // 청크별 로어북 결과 (이어하기용)
  knownEntities: KnownEntity[];
  chunks: string[];
  chunkSourceFileIndices?: number[];  // 각 청크가 어느 파일에서 왔는지
  timestamp: number;
  model?: string;  // 사용된 모델
  originalText?: string;  // 원본 텍스트
  fileNames?: string[];  // 원본 파일명 배열
}

export type ProgressCallback = (msg: string, current?: number, total?: number, estimatedRemainingSeconds?: number | null) => void;
export type ChunkBillingCallback = (chunkIndex: number, billing: ChunkBilling) => void;

export interface ExtractionOptions {
  text: string;
  title: string;
  onProgress?: ProgressCallback;
  resumeFrom?: ExtractionProgress;
  model?: string;
  fileNames?: string[];  // 원본 파일명 배열
  existingGraph?: NovelKnowledgeGraph;
  onChunkBilling?: ChunkBillingCallback;
  availableModelIds?: string[];  // 현재 사용 가능한 모델 ID 목록 (만료 모델 검증용)
  byokMode?: ByokMode;
  creditBalance?: number | null;
}

// --- 병합 타입 (merger.ts 내부 전용) ---

/** mergeExtractions() 반환 — 청크 병합 결과 (buildKnowledgeGraph 입력) */
export interface MergedEntity {
  name: string;
  category: string;
  description: string;
  aliases: string[];
  scenes: number[];
  attributes?: Record<string, unknown>;
  importance?: number;
}

export interface MergedRelationship {
  from: string;
  to: string;
  type: string;
  description?: string;
  scenes: number[];
  sentiment?: string;
  strength?: number;
  quote?: string;
  subtype?: string;
  start_time?: string;
  bidirectional?: boolean;
  from_perspective?: string;
  to_perspective?: string;
}

export interface MergedScene {
  id: number;
  chapter?: number;
  location?: string;
  summary?: string;
  events?: string[];
  mood?: string;
  time?: string;
  time_marker?: string | null;
  chunkNum: number;
  sourceFileIndex: number;
}

export interface MergedChapter {
  id: number;
  title?: string;
  summary?: string;
}

export interface MergedTimelinePoint {
  time_id?: string;
  time_expression?: string;
  events?: string[];
  characters?: string[];
  order?: number;
}

export interface MergedExtraction {
  entities: MergedEntity[];
  relationships: MergedRelationship[];
  scenes: MergedScene[];
  chapters: MergedChapter[];
  timeline?: MergedTimelinePoint[];
  loreEntries?: RawLoreEntry[];  // 모든 청크의 로어 엔트리 (장면 ID 미매핑)
}

/** buildAccumulatedGraph() 반환 — 경량 축적 그래프 (orchestrator/selector 내부 전용) */
export interface AccumulatedGraph {
  entities: Record<string, Entity>;
  hyperedges: Record<string, HyperEdge>;
}

// --- API 키 유틸리티 (순환 의존 방지를 위해 여기에 배치) ---

export function stripMarkdownCodeBlock(text: string): string {
  let s = text.trim();
  if (s.startsWith('```json')) {
    s = s.slice(7);
  } else if (s.startsWith('```')) {
    s = s.slice(3);
  }
  if (s.endsWith('```')) {
    s = s.slice(0, -3);
  }
  return s.trim();
}

export function getApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('OPENROUTER_API_KEY') || '';
}

export function setApiKey(key: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('OPENROUTER_API_KEY', key);
  }
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

export function removeApiKey(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('OPENROUTER_API_KEY');
  }
}

export async function validateApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch('/api/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      return { valid: false, error: data?.error || `서버 오류 (${response.status})` };
    }
    return await response.json();
  } catch {
    return { valid: false, error: '키 검증 중 네트워크 오류가 발생했습니다.' };
  }
}

// --- BYOK 모드 ---

export type ByokMode = 'disabled' | 'credit-first' | 'always-byok';

const BYOK_MODE_KEY = 'BYOK_MODE';

export function getByokMode(): ByokMode {
  if (typeof window === 'undefined') return 'disabled';
  const stored = localStorage.getItem(BYOK_MODE_KEY);
  if (stored === 'credit-first' || stored === 'always-byok') return stored;
  // 기존 키가 있으면 하위호환으로 always-byok
  if (hasApiKey()) return 'always-byok';
  return 'disabled';
}

export function setByokMode(mode: ByokMode): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(BYOK_MODE_KEY, mode);
  }
}

export function shouldUsePersonalKey(mode: ByokMode, creditBalance: number | null): boolean {
  if (mode === 'disabled') return false;
  if (mode === 'always-byok') return true;
  // credit-first: 잔액 0 이하일 때만 개인 키
  return creditBalance !== null && creditBalance <= 0;
}

/**
 * BYOK 모드와 잔액에 따라 실제 사용할 API 키 반환.
 * 개인 키를 사용하지 않을 경우 빈 문자열 → 서버 키 사용.
 */
export function getEffectiveApiKey(mode: ByokMode, creditBalance: number | null): string {
  if (!shouldUsePersonalKey(mode, creditBalance)) return '';
  return getApiKey();
}

// 클라이언트 측 fetch with timeout
export async function fetchWithClientTimeout(url: string, options: RequestInit, timeoutMs: number = 150000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- 엔티티 트리밍 (순환 의존 방지를 위해 여기에 배치) ---

export function trimKnownEntities(entities: KnownEntity[]): KnownEntity[] {
  if (entities.length <= MAX_KNOWN_ENTITIES) {
    return entities;
  }

  // 카테고리별로 그룹화하고 각각 제한
  const byCategory: Record<string, KnownEntity[]> = {};
  for (const e of entities) {
    if (!byCategory[e.category]) {
      byCategory[e.category] = [];
    }
    byCategory[e.category].push(e);
  }

  const result: KnownEntity[] = [];
  for (const category of Object.keys(byCategory)) {
    const categoryEntities = byCategory[category];
    // 최근 것들만 유지
    result.push(...categoryEntities.slice(-MAX_PER_CATEGORY));
  }

  return result.slice(-MAX_KNOWN_ENTITIES);
}
