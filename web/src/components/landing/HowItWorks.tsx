import { Upload, Sparkles, Share2 } from 'lucide-react';

const STEPS = [
  {
    number: '01',
    title: '소설 업로드',
    description: 'TXT, PDF, MD 형식의 소설 파일을 드래그 앤 드롭으로 업로드하세요. 여러 파일을 순서대로 추가할 수도 있습니다.',
    icon: Upload,
    bgAccent: 'bg-blue-50',
    textAccent: 'text-blue-600',
  },
  {
    number: '02',
    title: 'AI 자동 분석',
    description: 'AI가 텍스트를 읽고 인물, 장소, 조직 등 엔티티를 추출합니다. 관계 유형과 장면별 변화도 자동으로 파악합니다.',
    icon: Sparkles,
    bgAccent: 'bg-violet-50',
    textAccent: 'text-violet-600',
  },
  {
    number: '03',
    title: '관계도 탐색',
    description: '인터랙티브 그래프에서 인물 관계를 탐색하세요. 타임라인, 연대기, 세계관 등 6가지 뷰로 분석 결과를 확인합니다.',
    icon: Share2,
    bgAccent: 'bg-emerald-50',
    textAccent: 'text-emerald-600',
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 md:py-32 bg-gray-50/50">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16 md:mb-20">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            세 단계로 완성되는 관계도
          </h2>
          <p className="mt-4 text-gray-500 max-w-md mx-auto">
            업로드부터 관계도 탐색까지, 복잡한 설정 없이 바로 시작하세요
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 md:gap-6 lg:gap-12">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="relative group">
                <div className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-300">
                  {/* Step number */}
                  <span className="text-xs font-bold text-gray-300 tracking-widest">{step.number}</span>

                  {/* Icon */}
                  <div className={`mt-4 w-12 h-12 ${step.bgAccent} rounded-xl flex items-center justify-center`}>
                    <Icon aria-hidden="true" className={`w-6 h-6 ${step.textAccent}`} />
                  </div>

                  {/* Content */}
                  <h3 className="mt-5 text-lg font-bold text-gray-900">{step.title}</h3>
                  <p className="mt-3 text-sm text-gray-500 leading-relaxed">{step.description}</p>
                </div>

                {/* Connector line (hidden on mobile, visible between cards on desktop) */}
                {step.number !== '03' && (
                  <div className="hidden md:block absolute top-1/2 -right-3 lg:-right-6 w-6 lg:w-12" aria-hidden="true">
                    <div className="border-t-2 border-dashed border-gray-200 w-full" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
