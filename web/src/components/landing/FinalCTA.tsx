'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useScrollReveal } from './useScrollReveal';

const FLOATING_CIRCLES = [
  { x: 5, y: 15, size: 80, delay: 0 },
  { x: 20, y: 70, size: 50, delay: 1.2 },
  { x: 40, y: 10, size: 60, delay: 0.6 },
  { x: 60, y: 80, size: 40, delay: 1.8 },
  { x: 75, y: 20, size: 70, delay: 0.4 },
  { x: 85, y: 60, size: 45, delay: 1.4 },
  { x: 15, y: 45, size: 35, delay: 2 },
  { x: 92, y: 40, size: 55, delay: 0.8 },
] as const;

export function FinalCTA() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6" ref={ref}>
        <div
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-12 md:p-16 text-center"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.98)',
            transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
          }}
        >
          {/* Floating background decorations */}
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            {FLOATING_CIRCLES.map((circle, i) => (
              <div
                key={i}
                className="absolute rounded-full bg-white/5"
                style={{
                  left: `${circle.x}%`,
                  top: `${circle.y}%`,
                  width: `${circle.size}px`,
                  height: `${circle.size}px`,
                  animation: `landing-float ${5 + (i % 3)}s ease-in-out infinite`,
                  animationDelay: `${circle.delay}s`,
                }}
              />
            ))}
          </div>

          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
              소설 한 편을 업로드하는 것만으로
            </h2>
            <p className="mt-4 text-indigo-200 max-w-md mx-auto">
              AI가 인물과 관계를 자동으로 분석해 드립니다.
              <br />
              무료 크레딧으로 바로 체험 · 신용카드 불필요
            </p>
            <Link
              href="/login"
              className="group relative inline-flex items-center gap-2 mt-8 px-8 py-4 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors shadow-xl shadow-black/10 overflow-hidden"
            >
              <span className="relative z-10 flex items-center gap-2">
                무료로 시작하기
                <ArrowRight aria-hidden="true" className="w-4 h-4" />
              </span>
              {/* Shimmer effect */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 overflow-hidden pointer-events-none">
                <div
                  className="absolute inset-0 -translate-x-full"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.1), transparent)',
                    animation: 'landing-shimmer 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
