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

        {/* Product screenshot placeholder */}
        <div className="mt-20 md:mt-28">
          <div className="relative mx-auto max-w-5xl">
            <div className="absolute -inset-4 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 rounded-3xl blur-2xl" aria-hidden="true" />
            <div className="relative aspect-[16/9] bg-gray-900 rounded-2xl border border-gray-800 shadow-2xl overflow-hidden flex items-center justify-center">
              <div className="text-center text-gray-500">
                <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm">제품 스크린샷</p>
                <p className="text-xs text-gray-600 mt-1">추후 실제 화면으로 교체</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
