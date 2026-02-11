'use client';

import { useScrollReveal } from './useScrollReveal';

/* ── 미니 일러스트: 업로드 ───────────────────────────────── */

const FILE_TYPES = [
  { ext: 'TXT', color: '#3b82f6' },
  { ext: 'PDF', color: '#ef4444' },
  { ext: 'MD', color: '#22c55e' },
] as const;

function UploadIllustration() {
  return (
    <div className="h-24 flex items-center justify-center gap-2" aria-hidden="true">
      {/* Drop zone border */}
      <div className="relative flex items-center gap-2 px-5 py-3 border-2 border-dashed border-blue-200 rounded-xl bg-blue-50/30">
        {FILE_TYPES.map((ft) => (
          <div key={ft.ext} className="flex flex-col items-center">
            <div className="w-8 h-10 rounded bg-white border border-gray-200 shadow-sm flex flex-col items-center justify-center">
              <div className="w-4 h-0.5 bg-gray-200 rounded mb-0.5" />
              <div className="w-3 h-0.5 bg-gray-200 rounded mb-1" />
              <span className="text-[6px] font-bold" style={{ color: ft.color }}>{ft.ext}</span>
            </div>
          </div>
        ))}
        {/* Arrow indicator */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
            <path d="M6 8L0 0h12L6 8z" fill="#bfdbfe" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ── 미니 일러스트: AI 분석 ──────────────────────────────── */

function AnalysisIllustration() {
  return (
    <div className="h-24 flex items-center justify-center px-3" aria-hidden="true">
      <div className="space-y-1.5 w-full max-w-[160px]">
        {/* Simulated text lines with highlights */}
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-8 bg-gray-200 rounded" />
          <div className="h-1.5 w-10 bg-indigo-300/60 rounded" />
          <div className="h-1.5 w-6 bg-gray-200 rounded" />
          <div className="h-1.5 w-8 bg-pink-300/60 rounded" />
        </div>
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-6 bg-gray-200 rounded" />
          <div className="h-1.5 w-12 bg-emerald-300/60 rounded" />
          <div className="h-1.5 w-10 bg-gray-200 rounded" />
        </div>
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-10 bg-indigo-300/60 rounded" />
          <div className="h-1.5 w-4 bg-gray-200 rounded" />
          <div className="h-1.5 w-8 bg-gray-200 rounded" />
          <div className="h-1.5 w-6 bg-pink-300/60 rounded" />
        </div>
        {/* Legend */}
        <div className="flex items-center gap-2 mt-2 pt-1 border-t border-gray-100">
          <span className="flex items-center gap-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span className="text-[6px] text-gray-400">인물</span>
          </span>
          <span className="flex items-center gap-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-pink-400" />
            <span className="text-[6px] text-gray-400">관계</span>
          </span>
          <span className="flex items-center gap-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[6px] text-gray-400">장소</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── 미니 일러스트: 관계도 ───────────────────────────────── */

const MINI_NODES = [
  { x: 25, y: 30, r: 4, color: '#6366f1' },
  { x: 55, y: 20, r: 3.5, color: '#8b5cf6' },
  { x: 75, y: 45, r: 3, color: '#ef4444' },
  { x: 40, y: 60, r: 3.2, color: '#22c55e' },
] as const;

const MINI_EDGES = [
  { from: 0, to: 1 }, { from: 0, to: 3 }, { from: 1, to: 2 }, { from: 2, to: 3 },
] as const;

function GraphIllustration() {
  return (
    <div className="h-24 flex items-center justify-center" aria-hidden="true">
      <svg width="120" height="80" viewBox="0 0 100 80" fill="none">
        {MINI_EDGES.map((edge, i) => {
          const from = MINI_NODES[edge.from];
          const to = MINI_NODES[edge.to];
          return (
            <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="#c7d2fe" strokeWidth="0.8"
            />
          );
        })}
        {MINI_NODES.map((node, i) => (
          <circle key={i} cx={node.x} cy={node.y} r={node.r} fill={node.color} opacity={0.85} />
        ))}
      </svg>
    </div>
  );
}

/* ── Steps 데이터 ────────────────────────────────────────── */

interface StepItem {
  number: string;
  title: string;
  description: string;
  illustration: () => React.ReactNode;
  accentFrom: string;
}

const STEPS: StepItem[] = [
  {
    number: '01',
    title: '소설 업로드',
    description: 'TXT, PDF, MD 형식의 소설 파일을 드래그 앤 드롭으로 업로드하세요. 여러 파일을 순서대로 추가할 수도 있습니다.',
    illustration: UploadIllustration,
    accentFrom: '#3b82f6',
  },
  {
    number: '02',
    title: 'AI 자동 분석',
    description: 'AI가 텍스트를 읽고 인물, 장소, 조직 등 엔티티를 추출합니다. 관계 유형과 장면별 변화도 자동으로 파악합니다.',
    illustration: AnalysisIllustration,
    accentFrom: '#8b5cf6',
  },
  {
    number: '03',
    title: '관계도 탐색',
    description: '인터랙티브 그래프에서 인물 관계를 탐색하세요. 타임라인, 연대기, 세계관 등 6가지 뷰로 분석 결과를 확인합니다.',
    illustration: GraphIllustration,
    accentFrom: '#22c55e',
  },
];

/* ── 그라디언트 화살표 커넥터 ─────────────────────────────── */

function ArrowConnector({ toColor }: { toColor: string }) {
  return (
    <div className="hidden md:flex items-center justify-center w-12 lg:w-16 shrink-0" aria-hidden="true">
      <div
        className="w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M6 3l5 5-5 5" stroke={toColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

/* ── HowItWorks ──────────────────────────────────────────── */

export function HowItWorks() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="how-it-works" className="py-24 md:py-32 bg-gray-50/50">
      <div className="max-w-6xl mx-auto px-6" ref={ref}>
        <div className="text-center mb-16 md:mb-20">
          <span className="text-xs font-semibold text-indigo-500 tracking-widest uppercase mb-3 block">
            HOW IT WORKS
          </span>
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            세 단계로 완성되는 관계도
          </h2>
          <p className="mt-4 text-gray-500 max-w-md mx-auto">
            업로드부터 관계도 탐색까지, 복잡한 설정 없이 바로 시작하세요
          </p>
        </div>

        <div className="flex flex-col md:flex-row items-stretch gap-6 md:gap-0">
          {STEPS.flatMap((step, i) => {
            const Illustration = step.illustration;
            const card = (
              <div
                key={step.number}
                className="flex-1 bg-white rounded-2xl p-8 border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-300"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
                  transition: 'opacity 0.5s ease-out, transform 0.5s ease-out, box-shadow 0.3s ease, border-color 0.3s ease',
                  transitionDelay: `${i * 0.15}s`,
                }}
              >
                <span className="text-xs font-bold text-gray-300 tracking-widest">{step.number}</span>
                <Illustration />
                <h3 className="mt-4 text-lg font-bold text-gray-900">{step.title}</h3>
                <p className="mt-3 text-sm text-gray-500 leading-relaxed">{step.description}</p>
              </div>
            );
            if (i < STEPS.length - 1) {
              return [card, <ArrowConnector key={`arrow-${i}`} toColor={STEPS[i + 1].accentFrom} />];
            }
            return [card];
          })}
        </div>
      </div>
    </section>
  );
}
