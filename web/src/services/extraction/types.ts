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
  knownCharacters: { name: string; description: string; aliases?: string[] }[];
  chunks: string[];
  timestamp: number;
  model?: string;  // 사용된 모델
  originalText?: string;  // 원본 텍스트
  fileName?: string;  // 원본 파일명
}

export type ProgressCallback = (msg: string, current?: number, total?: number, estimatedMinutes?: number | null) => void;
export type ChunkBillingCallback = (chunkIndex: number, billing: { prompt_tokens: number; completion_tokens: number; model: string }) => void;

export interface ExtractionOptions {
  text: string;
  title: string;
  onProgress?: ProgressCallback;
  resumeFrom?: ExtractionProgress;
  model?: string;
  fileName?: string;
  existingGraph?: NovelKnowledgeGraph;
  onChunkBilling?: ChunkBillingCallback;
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
