import Link from 'next/link';

const GRAPH_NODES = [
  { id: 'a', label: '주인공', x: 50, y: 30, size: 44, color: '#6366f1' },
  { id: 'b', label: '조력자', x: 22, y: 55, size: 34, color: '#8b5cf6' },
  { id: 'c', label: '적대자', x: 78, y: 52, size: 36, color: '#ef4444' },
  { id: 'd', label: '멘토', x: 35, y: 80, size: 30, color: '#22c55e' },
  { id: 'e', label: '연인', x: 68, y: 78, size: 32, color: '#f59e0b' },
] as const;

const GRAPH_EDGES = [
  { from: 'a', to: 'b', label: '친구' },
  { from: 'a', to: 'c', label: '적대' },
  { from: 'a', to: 'e', label: '연인' },
  { from: 'b', to: 'd', label: '소속' },
  { from: 'c', to: 'e', label: '갈등' },
] as const;

function getNode(id: string) {
  return GRAPH_NODES.find(n => n.id === id);
}

function GraphVisualization() {
  return (
    <div className="relative w-full aspect-[4/3] max-w-lg mx-auto" aria-hidden="true">
      {/* Background glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-100/50 via-transparent to-violet-100/50 rounded-3xl" />

      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" fill="none">
        {/* Edges */}
        {GRAPH_EDGES.map((edge) => {
          const from = getNode(edge.from);
          const to = getNode(edge.to);
          if (!from || !to) return null;
          return (
            <g key={`${edge.from}-${edge.to}`}>
              <line
                x1={from.x} y1={from.y}
                x2={to.x} y2={to.y}
                stroke="#c7d2fe"
                strokeWidth="0.4"
                strokeDasharray={edge.label === '적대' ? '1.5 1' : 'none'}
              />
              <text
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 1.2}
                textAnchor="middle"
                className="fill-gray-400"
                style={{ fontSize: '2.4px' }}
              >
                {edge.label}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {GRAPH_NODES.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x} cy={node.y}
              r={node.size / 10}
              fill={node.color}
              opacity={0.15}
            />
            <circle
              cx={node.x} cy={node.y}
              r={node.size / 14}
              fill={node.color}
              opacity={0.9}
            />
            <text
              x={node.x}
              y={node.y + node.size / 10 + 3.5}
              textAnchor="middle"
              className="fill-gray-600 font-medium"
              style={{ fontSize: '3px' }}
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ── 앱 인터페이스 목업 ─────────────────────────────────── */

const MOCKUP_NODES: readonly { x: number; y: number; r: number; color: string; label: string; selected?: true }[] = [
  { x: 35, y: 28, r: 3.2, color: '#6366f1', label: '김민수', selected: true },
  { x: 58, y: 22, r: 2.6, color: '#8b5cf6', label: '이서연' },
  { x: 20, y: 48, r: 2.8, color: '#ef4444', label: '박준혁' },
  { x: 48, y: 52, r: 2.2, color: '#22c55e', label: '한강마을' },
  { x: 70, y: 45, r: 2.4, color: '#f59e0b', label: '정하나' },
  { x: 30, y: 72, r: 2.0, color: '#a855f7', label: '청풍회' },
  { x: 55, y: 75, r: 2.6, color: '#6366f1', label: '최도윤' },
  { x: 75, y: 68, r: 1.8, color: '#eab308', label: '비밀편지' },
];

const MOCKUP_EDGES = [
  { from: 0, to: 1 }, { from: 0, to: 2 }, { from: 0, to: 4 },
  { from: 1, to: 4 }, { from: 2, to: 5 }, { from: 3, to: 0 },
  { from: 4, to: 6 }, { from: 5, to: 6 }, { from: 6, to: 7 },
] as const;

const SIDEBAR_FIELDS = [
  { label: '별칭', value: '민수, 김대리' },
  { label: '카테고리', value: '인물 (주인공)' },
  { label: '중요도', value: '10 / 10' },
] as const;

const SIDEBAR_RELATIONS = [
  { name: '이서연', type: '연인', color: '#8b5cf6' },
  { name: '박준혁', type: '적대', color: '#ef4444' },
  { name: '정하나', type: '동료', color: '#f59e0b' },
] as const;

function AppMockup() {
  return (
    <div className="relative mx-auto max-w-5xl" aria-hidden="true">
      {/* Glow background */}
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
          <span className="text-[9px] text-gray-400 truncate">나미야 잡화점의 기적</span>
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
        <div className="flex" style={{ height: '280px' }}>
          {/* Graph area */}
          <div className="flex-1 bg-gray-50 relative overflow-hidden">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" fill="none">
              {/* Edges */}
              {MOCKUP_EDGES.map((edge, i) => {
                const from = MOCKUP_NODES[edge.from];
                const to = MOCKUP_NODES[edge.to];
                return (
                  <line
                    key={i}
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke="#d1d5db" strokeWidth="0.3"
                  />
                );
              })}

              {/* Nodes */}
              {MOCKUP_NODES.map((node, i) => (
                <g key={i}>
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
          </div>

          {/* Detail sidebar */}
          <div className="w-[180px] bg-white border-l border-gray-200 p-3 overflow-hidden">
            {/* Character header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
                <span className="text-[7px] text-white font-bold">김</span>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-800">김민수</div>
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
  return (
    <section className="relative pt-32 pb-20 md:pt-40 md:pb-32 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-50 to-white" aria-hidden="true" />
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30"
        style={{ background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.15) 0%, transparent 70%)' }}
        aria-hidden="true"
      />

      <div className="relative max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center">
          {/* Text content */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 rounded-full mb-8">
              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" aria-hidden="true" />
              <span className="text-xs font-medium text-indigo-600">AI 기반 자동 분석</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-[3.25rem] font-bold text-gray-900 leading-[1.2] tracking-tight">
              AI가 소설을 읽고
              <br />
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                인물 관계도
              </span>
              를
              <br />
              그려드립니다
            </h1>

            <p className="mt-6 text-lg text-gray-500 leading-relaxed max-w-md">
              소설 텍스트를 업로드하면, AI가 인물을 추출하고
              관계를 분석하여 인터랙티브 관계도를 생성합니다.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-3">
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-7 py-3.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-600 hover:to-violet-700 transition-all shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5 active:translate-y-0"
              >
                무료로 시작하기
              </Link>
              <a
                href="#features"
                className="inline-flex items-center justify-center px-7 py-3.5 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all"
              >
                기능 살펴보기
              </a>
            </div>

            <div className="mt-8 flex items-center gap-6 text-sm text-gray-400">
              <span>TXT, PDF, MD 지원</span>
              <span className="w-px h-4 bg-gray-200" aria-hidden="true" />
              <span>한국어 최적화</span>
            </div>
          </div>

          {/* Graph visualization */}
          <GraphVisualization />
        </div>

        {/* App mockup — replaces screenshot placeholder */}
        <div className="mt-20 md:mt-28">
          <AppMockup />
        </div>
      </div>
    </section>
  );
}
