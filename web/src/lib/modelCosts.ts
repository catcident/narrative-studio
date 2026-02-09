/**
 * 모델 비용 공유 상수 (클라이언트 + 서버)
 *
 * USD 단가, 마크업, 크레딧 계산 등 원가 관련 함수는 serverCosts.ts로 이동됨.
 * 이 모듈에는 청크 분할, 토큰 추정 등 공유 상수만 유지.
 */

// 한국어 텍스트는 ~1.0 char/token이지만, 시스템 프롬프트(영문)와 혼합되므로 보수적으로 1.5 사용.
export const CHARS_PER_TOKEN = 1.5;
export const CHUNK_SIZE = 5000;
export const CHUNK_OVERLAP = 300;
export const OUTPUT_RATIO = 0.45;

// Selector 추정 상수 (estimateUsageLocally에서 selector 호출 비용 추정용)
// ENTITY_SELECTION_PROMPT(~500자) + textPreview(1000자) + SYSTEM_PROMPT(~250자) + entitySummaries 평균(~1000자)
export const SELECTOR_PROMPT_CHARS = 2750;
export const SELECTOR_OUTPUT_TOKENS = 100;
export const SELECTOR_MODEL = 'google/gemini-2.0-flash-001';

// Merger review 추정 상수 (3청크 이상일 때 1회 호출)
export const MERGER_REVIEW_PROMPT_CHARS = 2500;
export const MERGER_REVIEW_OUTPUT_TOKENS = 200;
export const MERGER_REVIEW_MODEL = 'google/gemini-2.0-flash-001';
