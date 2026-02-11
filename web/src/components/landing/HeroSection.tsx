'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/* ── 배경 부유 노드 데이터 ──────────────────────────────── */

const FLOATING_NODES = [
  { x: 8, y: 15, r: 18, color: '#6366f1', delay: 0 },
  { x: 25, y: 8, r: 12, color: '#8b5cf6', delay: 0.8 },
  { x: 42, y: 20, r: 14, color: '#a855f7', delay: 1.6 },
  { x: 60, y: 10, r: 16, color: '#6366f1', delay: 0.4 },
  { x: 78, y: 18, r: 10, color: '#ec4899', delay: 1.2 },
  { x: 92, y: 12, r: 14, color: '#8b5cf6', delay: 2 },
  { x: 15, y: 45, r: 10, color: '#22c55e', delay: 1.4 },
  { x: 35, y: 55, r: 16, color: '#ef4444', delay: 0.6 },
  { x: 55, y: 42, r: 12, color: '#f59e0b', delay: 1.8 },
  { x: 72, y: 50, r: 14, color: '#6366f1', delay: 1 },
  { x: 88, y: 40, r: 10, color: '#a855f7', delay: 2.2 },
  { x: 10, y: 75, r: 14, color: '#8b5cf6', delay: 0.2 },
  { x: 30, y: 82, r: 10, color: '#22c55e', delay: 1.6 },
  { x: 50, y: 70, r: 16, color: '#ec4899', delay: 0.8 },
  { x: 68, y: 78, r: 12, color: '#ef4444', delay: 1.2 },
  { x: 85, y: 72, r: 14, color: '#6366f1', delay: 2.4 },
  { x: 20, y: 30, r: 8, color: '#f59e0b', delay: 1.8 },
  { x: 48, y: 88, r: 10, color: '#8b5cf6', delay: 0.4 },
] as const;

function FloatingGraphBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none">
        {FLOATING_NODES.map((node, i) => (
          <circle
            key={i}
            cx={node.x}
            cy={node.y}
            r={node.r / 10}
            fill={node.color}
            opacity={0.06}
            style={{
              animation: `landing-float ${4 + (i % 3)}s ease-in-out infinite`,
              animationDelay: `${node.delay}s`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}

/* ── 앱 인터페이스 목업 ─────────────────────────────────── */

interface MockupNode {
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  selected?: true;
}

const MOCKUP_NODES: readonly MockupNode[] = [
  { x: 30, y: 20, r: 4.0, color: '#6366f1', label: '서하준', selected: true },
  { x: 55, y: 15, r: 3.2, color: '#8b5cf6', label: '윤채린' },
  { x: 15, y: 40, r: 3.0, color: '#ef4444', label: '강도현' },
  { x: 42, y: 42, r: 2.8, color: '#22c55e', label: '달빛서원' },
  { x: 72, y: 35, r: 2.8, color: '#f59e0b', label: '정하나' },
  { x: 88, y: 22, r: 2.4, color: '#a855f7', label: '무영단' },
  { x: 55, y: 58, r: 2.8, color: '#6366f1', label: '최도윤' },
  { x: 78, y: 55, r: 2.0, color: '#eab308', label: '봉인검' },
  { x: 12, y: 65, r: 2.4, color: '#3b82f6', label: '오세진' },
  { x: 35, y: 68, r: 2.0, color: '#22c55e', label: '북방관문' },
  { x: 65, y: 75, r: 2.4, color: '#a855f7', label: '현월회' },
  { x: 88, y: 70, r: 1.8, color: '#ef4444', label: '혈야제' },
  { x: 20, y: 82, r: 1.5, color: '#eab308', label: '고서' },
  { x: 50, y: 82, r: 2.0, color: '#6366f1', label: '한소리' },
];

interface MockupEdge {
  from: number;
  to: number;
  type: string;
}

const MOCKUP_EDGES: readonly MockupEdge[] = [
  { from: 0, to: 1, type: '연인' },
  { from: 0, to: 2, type: '적대' },
  { from: 0, to: 3, type: '위치' },
  { from: 0, to: 4, type: '동료' },
  { from: 1, to: 5, type: '소속' },
  { from: 1, to: 6, type: '친구' },
  { from: 2, to: 8, type: '가족' },
  { from: 2, to: 9, type: '위치' },
  { from: 3, to: 5, type: '관련' },
  { from: 4, to: 6, type: '동료' },
  { from: 5, to: 10, type: '소속' },
  { from: 6, to: 7, type: '소유' },
  { from: 6, to: 10, type: '소속' },
  { from: 8, to: 12, type: '소유' },
  { from: 10, to: 11, type: '적대' },
  { from: 11, to: 9, type: '위치' },
  { from: 13, to: 0, type: '가족' },
];

function getEdgeColor(type: string): string {
  switch (type) {
    case '연인': return '#ec4899';
    case '적대': return '#ef4444';
    case '가족': return '#6366f1';
    case '동료': return '#3b82f6';
    case '친구': return '#22c55e';
    case '소속': return '#a855f7';
    case '위치': return '#22c55e';
    case '소유': return '#eab308';
    case '관련': return '#9ca3af';
    default: return '#9ca3af';
  }
}

function getEdgeDash(type: string): string {
  if (type === '적대') return '1.5 1';
  return 'none';
}

const SIDEBAR_FIELDS = [
  { label: '별칭', value: '하준, 백검' },
  { label: '카테고리', value: '인물 (주인공)' },
  { label: '직위', value: '달빛서원 수석제자' },
] as const;

const SIDEBAR_RELATIONS = [
  { name: '윤채린', type: '연인', color: '#ec4899' },
  { name: '강도현', type: '적대', color: '#ef4444' },
  { name: '정하나', type: '동료', color: '#3b82f6' },
  { name: '달빛서원', type: '위치', color: '#22c55e' },
  { name: '한소리', type: '관련', color: '#9ca3af' },
] as const;

const LEGEND_ITEMS = [
  { label: '가족', color: '#6366f1' },
  { label: '연인', color: '#ec4899' },
  { label: '적대', color: '#ef4444' },
  { label: '소속', color: '#a855f7' },
] as const;

const IMPORTANCE_BAR_COUNT = 4;

const APPEARANCE_DOTS = [1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14] as const;

function AppMockup() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative mx-auto max-w-6xl" aria-hidden="true">
      <div className="absolute -inset-4 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 rounded-3xl blur-2xl" />

      <div className="relative rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 border-b border-gray-800">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="px-4 py-1 bg-gray-800 rounded-md text-[10px] text-gray-400">
              storygraph.catcident.com
            </div>
          </div>
          <div className="w-12" />
        </div>

        {/* App chrome — toolbar */}
        <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-indigo-500/20" />
            <span className="text-[10px] font-bold text-gray-700">스토리그래프</span>
          </div>
          <span className="text-[9px] text-gray-400 truncate">달빛 서원의 비밀</span>
          <div className="ml-auto flex items-center gap-1">
            {['관계도', '타임라인', '채팅'].map((tab, i) => (
              <div key={tab} className={`px-2 py-0.5 rounded text-[8px] font-medium ${
                i === 0 ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400'
              }`}>
                {tab}
              </div>
            ))}
          </div>
        </div>

        {/* Main content area */}
        <div className="flex" style={{ height: '380px' }}>
          {/* Graph area */}
          <div className="flex-1 bg-gray-50 relative overflow-hidden">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" fill="none">
              {/* Edges with relationship colors */}
              {MOCKUP_EDGES.map((edge, i) => {
                const from = MOCKUP_NODES[edge.from];
                const to = MOCKUP_NODES[edge.to];
                const pathLength = Math.hypot(to.x - from.x, to.y - from.y);
                return (
                  <line
                    key={i}
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={getEdgeColor(edge.type)}
                    strokeWidth="0.35"
                    strokeDasharray={getEdgeDash(edge.type) === 'none' ? `${pathLength}` : getEdgeDash(edge.type)}
                    strokeDashoffset={loaded ? 0 : pathLength}
                    opacity={0.6}
                    style={{
                      transition: 'stroke-dashoffset 0.8s ease-out',
                      transitionDelay: `${0.6 + i * 0.1}s`,
                    }}
                  />
                );
              })}

              {/* Nodes */}
              {MOCKUP_NODES.map((node, i) => (
                <g
                  key={i}
                  style={{
                    opacity: loaded ? 1 : 0,
                    transform: loaded ? 'scale(1)' : 'scale(0.3)',
                    transformOrigin: `${node.x}px ${node.y}px`,
                    transition: 'opacity 0.4s ease-out, transform 0.4s ease-out',
                    transitionDelay: `${0.2 + i * 0.12}s`,
                  }}
                >
                  {node.selected && (
                    <circle cx={node.x} cy={node.y} r={node.r + 1.2}
                      fill="none" stroke="#6366f1" strokeWidth="0.3" opacity={0.5}
                      strokeDasharray="1 0.8"
                    />
                  )}
                  <circle cx={node.x} cy={node.y} r={node.r}
                    fill={node.color} opacity={0.85}
                  />
                  <text x={node.x} y={node.y + node.r + 2.5}
                    textAnchor="middle" style={{ fontSize: '2.2px' }}
                    className="fill-gray-500 font-medium"
                  >
                    {node.label}
                  </text>
                </g>
              ))}
            </svg>

            {/* Mini legend */}
            <div className="absolute bottom-2 left-2 flex items-center gap-2 bg-white/80 backdrop-blur-sm rounded-md px-2 py-1">
              {LEGEND_ITEMS.map((item) => (
                <div key={item.label} className="flex items-center gap-0.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-[6px] text-gray-500">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Detail sidebar */}
          <div className="w-[180px] bg-white border-l border-gray-200 p-3 overflow-hidden">
            {/* Character header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
                <span className="text-[7px] text-white font-bold">서</span>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-800">서하준</div>
                <div className="text-[8px] text-gray-400">주인공</div>
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-2 mb-3">
              {SIDEBAR_FIELDS.map((f) => (
                <div key={f.label}>
                  <div className="text-[7px] text-gray-400 uppercase tracking-wider">{f.label}</div>
                  <div className="text-[9px] text-gray-600 mt-0.5">{f.value}</div>
                </div>
              ))}
              {/* Importance gauge */}
              <div>
                <div className="text-[7px] text-gray-400 uppercase tracking-wider">중요도</div>
                <div className="flex items-center gap-0.5 mt-1">
                  {Array.from({ length: IMPORTANCE_BAR_COUNT }).map((_, i) => (
                    <div
                      key={i}
                      className="h-2 rounded-sm"
                      style={{
                        width: '12px',
                        backgroundColor: i < 3 ? '#6366f1' : '#e5e7eb',
                        opacity: i < 3 ? 1 - i * 0.15 : 0.5,
                      }}
                    />
                  ))}
                  <span className="text-[8px] text-gray-500 ml-1">10/10</span>
                </div>
              </div>
              {/* Appearance dots */}
              <div>
                <div className="text-[7px] text-gray-400 uppercase tracking-wider">등장 장면</div>
                <div className="flex items-center gap-0.5 mt-1 flex-wrap">
                  {APPEARANCE_DOTS.map((scene) => (
                    <div
                      key={scene}
                      className="w-1.5 h-1.5 rounded-full bg-indigo-400"
                      style={{ opacity: 0.4 + (scene / 14) * 0.6 }}
                    />
                  ))}
                  <span className="text-[7px] text-gray-400 ml-0.5">12장면</span>
                </div>
              </div>
            </div>

            {/* Separator */}
            <div className="border-t border-gray-100 mb-2" />

            {/* Relations */}
            <div className="text-[7px] text-gray-400 uppercase tracking-wider mb-1.5">관계</div>
            <div className="space-y-1.5">
              {SIDEBAR_RELATIONS.map((rel) => (
                <div key={rel.name} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: rel.color }} />
                  <span className="text-[8px] text-gray-600">{rel.name}</span>
                  <span className="ml-auto text-[7px] text-gray-400 bg-gray-50 px-1 rounded">{rel.type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Hero Section ────────────────────────────────────────── */

export function HeroSection() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="relative pt-32 pb-20 md:pt-40 md:pb-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-50 to-white" aria-hidden="true" />
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30"
        style={{ background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.15) 0%, transparent 70%)' }}
        aria-hidden="true"
      />
      <FloatingGraphBackground />

      <div className="relative max-w-6xl mx-auto px-6">
        {/* Center-aligned hero content */}
        <div className="text-center max-w-3xl mx-auto">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 rounded-full mb-8"
            style={{
              opacity: loaded ? 1 : 0,
              transform: loaded ? 'translateY(0)' : 'translateY(24px)',
              transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
            }}
          >
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" aria-hidden="true" />
            <span className="text-xs font-medium text-indigo-600">AI 기반 자동 분석</span>
          </div>

          <h1
            className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 leading-[1.15] tracking-tight"
            style={{
              opacity: loaded ? 1 : 0,
              transform: loaded ? 'translateY(0)' : 'translateY(24px)',
              transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
              transitionDelay: '0.1s',
            }}
          >
            AI가 소설을 읽고
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: 'linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7, #6366f1)',
                backgroundSize: '200% 100%',
                animation: 'landing-gradient-shift 4s ease-in-out infinite',
              }}
            >
              인물 관계도
            </span>
            를
            <br />
            그려드립니다
          </h1>

          <p
            className="mt-6 text-lg md:text-xl text-gray-500 leading-relaxed max-w-xl mx-auto"
            style={{
              opacity: loaded ? 1 : 0,
              transform: loaded ? 'translateY(0)' : 'translateY(24px)',
              transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
              transitionDelay: '0.2s',
            }}
          >
            소설 텍스트를 업로드하면, AI가 인물을 추출하고
            관계를 분석하여 인터랙티브 관계도를 생성합니다.
          </p>

          <div
            className="mt-10 flex flex-col sm:flex-row gap-3 justify-center"
            style={{
              opacity: loaded ? 1 : 0,
              transform: loaded ? 'translateY(0)' : 'translateY(24px)',
              transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
              transitionDelay: '0.3s',
            }}
          >
            <Link
              href="/login"
              className="group relative inline-flex items-center justify-center px-8 py-4 text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-600 hover:to-violet-700 transition-all shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5 active:translate-y-0 overflow-hidden"
            >
              <span className="relative z-10">무료로 시작하기</span>
              {/* Shimmer effect */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 overflow-hidden pointer-events-none">
                <div
                  className="absolute inset-0 -translate-x-full"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                    animation: 'landing-shimmer 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            </Link>
            <a
              href="#features"
              className="inline-flex items-center justify-center px-8 py-4 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all"
            >
              기능 살펴보기
            </a>
          </div>

          <div
            className="mt-8 flex items-center justify-center gap-6 text-sm text-gray-400"
            style={{
              opacity: loaded ? 1 : 0,
              transition: 'opacity 0.6s ease-out',
              transitionDelay: '0.4s',
            }}
          >
            <span>TXT, PDF, MD 지원</span>
            <span className="w-px h-4 bg-gray-200" aria-hidden="true" />
            <span>한국어 최적화</span>
          </div>
        </div>

        {/* App mockup */}
        <div className="mt-20 md:mt-28">
          <AppMockup />
        </div>
      </div>
    </section>
  );
}
