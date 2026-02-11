/**
 * AI 생성 결과 라벨 컴포넌트
 * AI 기본법 제31조 (2026.1.22 시행) 준수를 위한 AI 생성 콘텐츠 표시
 */

import { Sparkles } from 'lucide-react';

interface AiGeneratedBadgeProps {
  /** 인라인 표시 (작은 뱃지) vs 블록 표시 (영역 상단 라벨) */
  variant?: 'inline' | 'block';
  className?: string;
}

export function AiGeneratedBadge({ variant = 'inline', className = '' }: AiGeneratedBadgeProps) {
  if (variant === 'block') {
    return (
      <div
        className={`flex items-center gap-1.5 text-xs text-violet-500 ${className}`}
        aria-label="AI 생성 결과"
      >
        <Sparkles className="w-3 h-3" aria-hidden="true" />
        <span>AI 생성 결과</span>
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full font-medium ${className}`}
      aria-label="AI 생성 결과"
    >
      <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
      AI 생성
    </span>
  );
}
