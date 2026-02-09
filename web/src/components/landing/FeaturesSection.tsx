import { Network, Clock, Globe, Download } from 'lucide-react';

const FEATURES = [
  {
    icon: Network,
    title: '인터랙티브 관계도',
    description: '드래그, 줌, 필터링이 가능한 동적 그래프. 관계 유형별 색상 구분과 중요도 기반 노드 크기로 한눈에 파악하세요.',
    gradient: 'from-indigo-500 to-blue-500',
    bg: 'bg-indigo-50',
    text: 'text-indigo-600',
  },
  {
    icon: Clock,
    title: '장면별 타임라인',
    description: '장면 순서대로 인물 등장과 관계 변화를 추적합니다. 범위를 선택하여 특정 구간의 관계 변화를 분석하세요.',
    gradient: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-50',
    text: 'text-amber-600',
  },
  {
    icon: Globe,
    title: '세계관 & 연대기',
    description: '장소, 조직, 사건 등 세계관 요소를 체계적으로 정리합니다. 캐릭터별 연대기 뷰로 인물의 여정을 따라가세요.',
    gradient: 'from-emerald-500 to-teal-500',
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
  },
  {
    icon: Download,
    title: '다양한 내보내기',
    description: 'PNG, SVG, PDF 형식으로 관계도를 내보내세요. 보고서용 PDF에는 인물 정보와 관계 목록이 포함됩니다.',
    gradient: 'from-rose-500 to-pink-500',
    bg: 'bg-rose-50',
    text: 'text-rose-600',
  },
] as const;

export function FeaturesSection() {
  return (
    <section id="features" className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16 md:mb-20">
          <span className="text-sm font-medium text-indigo-600 tracking-wide uppercase">Features</span>
          <h2 className="mt-3 text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            분석부터 공유까지, 한 곳에서
          </h2>
          <p className="mt-4 text-gray-500 max-w-lg mx-auto">
            소설 분석에 필요한 모든 도구를 제공합니다
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group relative bg-white rounded-2xl p-8 border border-gray-100 hover:border-gray-200 shadow-sm hover:shadow-lg transition-all duration-300"
              >
                <div className={`w-11 h-11 ${feature.bg} rounded-xl flex items-center justify-center mb-5`}>
                  <Icon aria-hidden="true" className={`w-5 h-5 ${feature.text}`} />
                </div>

                <h3 className="text-lg font-bold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{feature.description}</p>

                {/* Hover accent line */}
                <div
                  className={`absolute bottom-0 left-8 right-8 h-0.5 bg-gradient-to-r ${feature.gradient} rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
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
