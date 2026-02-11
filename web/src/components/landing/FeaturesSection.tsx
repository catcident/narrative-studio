'use client';

import { useScrollReveal } from './useScrollReveal';

/* ── 미니 비주얼: 관계도 (큰 카드) ────────────────────────── */

interface MiniGraphNode {
  x: number;
  y: number;
  r: number;
  color: string;
  selected?: boolean;
}

const MINI_GRAPH_NODES: readonly MiniGraphNode[] = [
  { x: 22, y: 18, r: 4, color: '#6366f1', selected: true },
  { x: 50, y: 12, r: 3, color: '#8b5cf6' },
  { x: 80, y: 22, r: 3.2, color: '#ef4444' },
  { x: 8, y: 42, r: 2.8, color: '#22c55e' },
  { x: 38, y: 40, r: 2.5, color: '#f59e0b' },
  { x: 65, y: 45, r: 2.2, color: '#a855f7' },
  { x: 92, y: 50, r: 2.4, color: '#3b82f6' },
  { x: 25, y: 65, r: 2.8, color: '#6366f1' },
  { x: 55, y: 68, r: 2.0, color: '#ec4899' },
];

const MINI_GRAPH_EDGES = [
  { from: 0, to: 1, color: '#ec4899' },
  { from: 0, to: 3, color: '#22c55e' },
  { from: 0, to: 4, color: '#3b82f6' },
  { from: 1, to: 2, color: '#ef4444' },
  { from: 1, to: 4, color: '#f59e0b' },
  { from: 2, to: 6, color: '#a855f7' },
  { from: 3, to: 7, color: '#6366f1' },
  { from: 4, to: 5, color: '#9ca3af' },
  { from: 5, to: 6, color: '#8b5cf6' },
  { from: 7, to: 8, color: '#ec4899' },
  { from: 8, to: 5, color: '#3b82f6' },
];

function GraphVisual() {
  return (
    <div className="h-28 relative mt-4 rounded-lg bg-gray-50/50 overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 80" fill="none">
        {MINI_GRAPH_EDGES.map((edge, i) => {
          const from = MINI_GRAPH_NODES[edge.from];
          const to = MINI_GRAPH_NODES[edge.to];
          return (
            <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={edge.color} strokeWidth="0.4" opacity={0.5}
            />
          );
        })}
        {MINI_GRAPH_NODES.map((node, i) => (
          <g key={i}>
            {node.selected && (
              <circle cx={node.x} cy={node.y} r={node.r + 1.5}
                fill="none" stroke="#6366f1" strokeWidth="0.3" opacity={0.4}
                strokeDasharray="1.2 0.8"
              />
            )}
            <circle cx={node.x} cy={node.y} r={node.r} fill={node.color} opacity={0.85} />
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ── 미니 비주얼: 타임라인 ────────────────────────────────── */

const TIMELINE_SCENES = [
  { chapter: '1장', dots: 3, color: '#6366f1' },
  { chapter: '2장', dots: 5, color: '#8b5cf6' },
  { chapter: '3장', dots: 2, color: '#a855f7' },
  { chapter: '4장', dots: 4, color: '#6366f1' },
] as const;

function TimelineVisual() {
  return (
    <div className="h-28 relative mt-4 flex items-center justify-center gap-3 px-3" aria-hidden="true">
      {TIMELINE_SCENES.map((scene, si) => (
        <div key={si} className="flex flex-col items-center gap-1.5">
          <div className="text-[8px] text-gray-400 font-medium">{scene.chapter}</div>
          <div className="w-px h-2 bg-gray-200" />
          <div className="flex flex-col items-center gap-1">
            {Array.from({ length: scene.dots }).map((_, di) => (
              <div key={di} className="w-2 h-2 rounded-full" style={{ backgroundColor: scene.color, opacity: 0.5 + di * 0.1 }} />
            ))}
          </div>
          {si < TIMELINE_SCENES.length - 1 && (
            <div className="absolute" style={{ left: `${25 + si * 25}%`, top: '50%', width: '15%', height: '1px', backgroundColor: '#e5e7eb' }} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── 미니 비주얼: 세계관 ─────────────────────────────────── */

const WORLD_CATEGORIES = [
  { label: '인물', color: '#6366f1', count: 8 },
  { label: '장소', color: '#22c55e', count: 4 },
  { label: '조직', color: '#a855f7', count: 3 },
  { label: '사건', color: '#ef4444', count: 5 },
] as const;

function WorldVisual() {
  return (
    <div className="h-28 relative mt-4 flex items-center justify-center" aria-hidden="true">
      <div className="relative w-24 h-24">
        {WORLD_CATEGORIES.map((cat, i) => {
          const angle = (i / WORLD_CATEGORIES.length) * Math.PI * 2 - Math.PI / 2;
          const cx = 48 + Math.cos(angle) * 32;
          const cy = 48 + Math.sin(angle) * 32;
          return (
            <div key={i} className="absolute flex flex-col items-center" style={{ left: `${cx}%`, top: `${cy}%`, transform: 'translate(-50%, -50%)' }}>
              <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: cat.color, opacity: 0.2 }}>
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color, opacity: 0.8 }} />
              </div>
              <span className="text-[7px] text-gray-400 mt-0.5">{cat.label}</span>
            </div>
          );
        })}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-gray-200" />
      </div>
    </div>
  );
}

/* ── 미니 비주얼: 내보내기 (큰 카드) ──────────────────────── */

const EXPORT_FORMATS = [
  { label: 'PNG', color: '#3b82f6', z: 3 },
  { label: 'SVG', color: '#22c55e', z: 2 },
  { label: 'PDF', color: '#ef4444', z: 1 },
] as const;

function ExportVisual() {
  return (
    <div className="h-28 relative mt-4 flex items-center justify-center" aria-hidden="true">
      <div className="flex items-center -space-x-3" style={{ perspective: '600px' }}>
        {EXPORT_FORMATS.map((fmt, i) => (
          <div
            key={fmt.label}
            className="rounded-lg border border-gray-200 bg-white shadow-md px-6 py-4 flex items-center gap-2"
            style={{
              transform: `translateZ(${(2 - i) * 8}px) rotateY(-5deg)`,
              zIndex: EXPORT_FORMATS.length - i,
            }}
          >
            <div className="w-7 h-8 rounded flex items-center justify-center" style={{ backgroundColor: fmt.color, opacity: 0.2 }}>
              <span className="text-[7px] font-bold" style={{ color: fmt.color, opacity: 1 }}>{fmt.label}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] font-medium text-gray-600">{fmt.label}</span>
              <span className="text-[7px] text-gray-400">Export</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Features 데이터 ─────────────────────────────────────── */

interface FeatureItem {
  title: string;
  description: string;
  gradient: string;
  visual: () => React.ReactNode;
}

const FEATURES: FeatureItem[] = [
  {
    title: '인터랙티브 관계도',
    description: '드래그, 줌, 필터링이 가능한 동적 그래프. 관계 유형별 색상 구분과 중요도 기반 노드 크기로 한눈에 파악하세요.',
    gradient: 'from-indigo-500 to-blue-500',
    visual: GraphVisual,
  },
  {
    title: '장면별 타임라인',
    description: '장면 순서대로 인물 등장과 관계 변화를 추적합니다. 범위를 선택하여 특정 구간의 관계 변화를 분석하세요.',
    gradient: 'from-amber-500 to-orange-500',
    visual: TimelineVisual,
  },
  {
    title: '세계관 & 연대기',
    description: '장소, 조직, 사건 등 세계관 요소를 체계적으로 정리합니다. 캐릭터별 연대기 뷰로 인물의 여정을 따라가세요.',
    gradient: 'from-emerald-500 to-teal-500',
    visual: WorldVisual,
  },
  {
    title: '다양한 내보내기',
    description: 'PNG, SVG, PDF 형식으로 관계도를 내보내세요. 보고서용 PDF에는 인물 정보와 관계 목록이 포함됩니다.',
    gradient: 'from-rose-500 to-pink-500',
    visual: ExportVisual,
  },
];

/* ── FeaturesSection ─────────────────────────────────────── */

export function FeaturesSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="features" className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6" ref={ref}>
        <div className="text-center mb-16 md:mb-20">
          <span className="text-xs font-semibold text-indigo-500 tracking-widest uppercase mb-3 block">
            FEATURES
          </span>
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            분석부터 공유까지, 한 곳에서
          </h2>
          <p className="mt-4 text-gray-500 max-w-lg mx-auto">
            소설 분석에 필요한 모든 도구를 제공합니다
          </p>
        </div>

        {/* Feature grid: 2x2 layout */}
        <div className="grid md:grid-cols-2 gap-5">
          {FEATURES.map((feature, i) => {
            const Visual = feature.visual;
            return (
              <div
                key={feature.title}
                className="group relative bg-white rounded-2xl p-7 border border-gray-100 hover:border-gray-200 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
                  transition: 'opacity 0.5s ease-out, transform 0.5s ease-out, box-shadow 0.3s ease, border-color 0.3s ease',
                  transitionDelay: `${i * 0.1}s`,
                }}
              >
                {/* Hover gradient background */}
                <div
                  className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-[0.03] transition-opacity duration-300 pointer-events-none`}
                  aria-hidden="true"
                />

                <div className="relative">
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{feature.description}</p>
                  <Visual />
                </div>

                {/* Bottom accent line */}
                <div
                  className={`absolute bottom-0 left-7 right-7 h-0.5 bg-gradient-to-r ${feature.gradient} rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
                  aria-hidden="true"
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
