'use client';

import { useScrollReveal } from './useScrollReveal';

const STATS = [
  { value: '10+', label: '지원 관계 유형' },
  { value: '6가지', label: '분석 뷰' },
  { value: '3종', label: '내보내기 형식' },
  { value: 'PDF · TXT · MD', label: '지원 포맷' },
] as const;

const DECORATIVE_CIRCLES = [
  { x: 5, y: 20, r: 60, delay: 0 },
  { x: 25, y: 70, r: 40, delay: 0.8 },
  { x: 50, y: 10, r: 50, delay: 1.6 },
  { x: 75, y: 65, r: 35, delay: 0.4 },
  { x: 90, y: 25, r: 45, delay: 1.2 },
] as const;

export function StatsSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="relative py-20 md:py-24 overflow-hidden">
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-700" aria-hidden="true" />

      {/* Decorative floating circles */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {DECORATIVE_CIRCLES.map((circle, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/5"
            style={{
              left: `${circle.x}%`,
              top: `${circle.y}%`,
              width: `${circle.r}px`,
              height: `${circle.r}px`,
              animation: `landing-float ${5 + i}s ease-in-out infinite`,
              animationDelay: `${circle.delay}s`,
            }}
          />
        ))}
      </div>

      <div className="relative max-w-6xl mx-auto px-6" ref={ref}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              className="text-center"
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? 'translateY(0)' : 'translateY(16px)',
                transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
                transitionDelay: `${i * 0.1}s`,
              }}
            >
              <div className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                {stat.value}
              </div>
              <div className="mt-2 text-sm text-indigo-200">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
