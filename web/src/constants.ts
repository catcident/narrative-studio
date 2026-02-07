/**
 * 공유 상수 - 카테고리 색상, 라벨, 관계 유형 등
 * 여러 컴포넌트에서 중복 정의되던 상수들을 통합
 */

import type { EntityCategory } from './types';

// 카테고리별 색상 (hex)
export const CATEGORY_COLORS: Record<EntityCategory, string> = {
  character: '#3b82f6',
  location: '#22c55e',
  organization: '#a855f7',
  item: '#f59e0b',
  creature: '#ef4444',
  event: '#ec4899',
  concept: '#6366f1',
  time_period: '#14b8a6',
  status: '#64748b',
  emotion: '#f43f5e',
};

// 카테고리별 Tailwind 배경색 클래스 (DetailPanel용)
export const CATEGORY_BG_CLASSES: Record<EntityCategory, string> = {
  character: 'bg-blue-500',
  location: 'bg-green-500',
  organization: 'bg-purple-500',
  item: 'bg-amber-500',
  creature: 'bg-red-500',
  event: 'bg-pink-500',
  concept: 'bg-indigo-500',
  time_period: 'bg-teal-500',
  status: 'bg-slate-500',
  emotion: 'bg-rose-500',
};

// 카테고리별 한글 라벨
export const CATEGORY_LABELS: Record<EntityCategory, string> = {
  character: '인물',
  location: '장소',
  organization: '조직',
  item: '아이템',
  creature: '생물',
  event: '사건',
  concept: '개념',
  time_period: '시간',
  status: '상태',
  emotion: '감정',
};

// 관계 유형 한글화 (가장 포괄적인 버전)
export const RELATION_LABELS: Record<string, string> = {
  family: '가족',
  romantic: '연인',
  friendship: '친구',
  rivalry: '적대',
  mentor: '스승',
  subordinate: '부하',
  trust: '신뢰',
  belongs_to: '소속',
  owns: '소유',
  ownership: '소유',
  rules: '지배',
  located_at: '위치',
  location: '위치',
  occurred_at: '발생',
  during: '기간',
  participates: '참여',
  causes: '원인',
  transforms: '변화',
  knows: '아는 사이',
  knows_about: '인지',
  has_status: '상태',
  related_to: '관련',
  related: '관련',
  // 한글은 그대로
  '가족': '가족',
  '연인': '연인',
  '친구': '친구',
  '적대': '적대',
  '동료': '동료',
  '주인': '주인',
  '위치': '위치',
  '소유': '소유',
  '관련': '관련',
  '소속': '소속',
};

// 관계 유형별 색상
export const RELATION_COLORS: Record<string, string> = {
  '가족': '#8b5cf6',
  '연인': '#ec4899',
  '친구': '#22c55e',
  '적대': '#ef4444',
  '동료': '#3b82f6',
  '주인': '#f59e0b',
  '위치': '#14b8a6',
  '소유': '#f59e0b',
  '관련': '#9ca3af',
  family: '#8b5cf6',
  romantic: '#ec4899',
  friendship: '#22c55e',
  rivalry: '#ef4444',
  mentor: '#3b82f6',
  subordinate: '#64748b',
  belongs_to: '#a855f7',
  owns: '#f59e0b',
  rules: '#dc2626',
  located_at: '#14b8a6',
  occurred_at: '#06b6d4',
  during: '#64748b',
  participates: '#3b82f6',
  causes: '#ef4444',
  transforms: '#f59e0b',
  knows: '#6366f1',
  has_status: '#64748b',
  related_to: '#9ca3af',
};

// 감정(sentiment)별 색상 - CharacterChronicle 카드용
export const SENTIMENT_CARD_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  positive: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  negative: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
  neutral: { bg: '#f3f4f6', border: '#d1d5db', text: '#4b5563' },
  complex: { bg: '#f3e8ff', border: '#d8b4fe', text: '#7e22ce' },
};

// 감정별 엣지 스타일 - RelationshipGraph용
export const SENTIMENT_STROKE_STYLES: Record<string, { strokeDasharray: string }> = {
  positive: { strokeDasharray: 'none' },
  negative: { strokeDasharray: '5,5' },
  neutral: { strokeDasharray: '2,2' },
  complex: { strokeDasharray: '10,5,2,5' },
};

// 캐릭터 팔레트 (연대기, 그래프 등에서 사용)
export const CHARACTER_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899',
  '#14b8a6', '#6366f1', '#f43f5e', '#06b6d4', '#f59e0b',
];
