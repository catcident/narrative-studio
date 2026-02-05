/**
 * 지식 그래프 추출 서비스 — 내부 타입 및 상수
 */

import type { NovelKnowledgeGraph } from '../../types';

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
}

export interface ChunkExtractionResult {
  data: any;
  billing: ChunkBilling | null;
}

// 중간 저장용 타입
export interface ExtractionProgress {
  title: string;
  totalChunks: number;
  processedChunks: number;
  allExtracted: any[];
  knownEntities: KnownEntity[];
  chunks: string[];
  timestamp: number;
  model?: string;  // 사용된 모델
  originalText?: string;  // 원본 텍스트
  fileName?: string;  // 원본 파일명
}

export type ProgressCallback = (msg: string, current?: number, total?: number, estimatedMinutes?: number | null) => void;
export type ChunkBillingCallback = (chunkIndex: number, billing: ChunkBilling) => void;

export interface ExtractionOptions {
  text: string;
  title: string;
  onProgress?: ProgressCallback;
  resumeFrom?: ExtractionProgress;
  model?: string;
  fileName?: string;
  existingGraph?: NovelKnowledgeGraph;
  onChunkBilling?: ChunkBillingCallback;
  /** 분석 세션 ID (서버 측 토큰 추적용) */
  sessionId?: string;
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
