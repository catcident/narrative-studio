import { MessageCircle, Sparkles } from 'lucide-react';

const CHAT_MESSAGES = [
  { role: 'user' as const, text: '주인공과 가장 갈등이 깊은 인물은 누구인가요?' },
  { role: 'ai' as const, text: '분석 결과, 주인공과 가장 갈등이 깊은 인물은 적대자입니다. 전체 15개 장면 중 8개 장면에서 대립하며, 관계 강도는 0.85로 가장 높습니다.' },
  { role: 'user' as const, text: '두 인물의 관계가 변화하는 전환점은 어디인가요?' },
] as const;

export function ChatShowcase() {
  return (
    <section className="py-24 md:py-32 bg-gray-50/50">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center">
          {/* Text */}
          <div>
            <span className="text-sm font-medium text-indigo-600 tracking-wide uppercase">AI Chat</span>
            <h2 className="mt-3 text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
              분석 결과에 대해
              <br />
              AI와 대화하세요
            </h2>
            <p className="mt-4 text-gray-500 leading-relaxed">
              관계도를 보면서 떠오르는 질문을 AI에게 물어보세요.
              인물 관계, 스토리 구조, 숨겨진 패턴까지 심층적으로 분석해 드립니다.
            </p>
            <ul className="mt-8 space-y-3">
              {[
                '인물 관계에 대한 심층 질의',
                '스토리 구조와 전개 분석',
                '관계도 데이터 기반 정확한 답변',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-gray-600">
                  <Sparkles aria-hidden="true" className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Chat preview */}
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-br from-indigo-100/50 to-violet-100/50 rounded-3xl blur-xl" aria-hidden="true" />
            <div className="relative bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
              {/* Chat header */}
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2.5">
                <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center">
                  <MessageCircle aria-hidden="true" className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm font-semibold text-gray-900">AI 채팅</span>
              </div>

              {/* Chat messages */}
              <div className="p-5 space-y-4">
                {CHAT_MESSAGES.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-md'
                        : 'bg-gray-100 text-gray-700 rounded-bl-md'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}

                {/* Typing indicator */}
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} aria-hidden="true" />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} aria-hidden="true" />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} aria-hidden="true" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
