import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function FinalCTA() {
  return (
    <section className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-12 md:p-16 text-center">
          {/* Background decorations */}
          <div className="absolute top-0 left-0 w-72 h-72 bg-white/5 rounded-full -translate-x-1/2 -translate-y-1/2" aria-hidden="true" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-white/5 rounded-full translate-x-1/3 translate-y-1/3" aria-hidden="true" />

          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
              지금 바로 시작하세요
            </h2>
            <p className="mt-4 text-indigo-200 max-w-md mx-auto">
              회원가입 후 바로 소설 분석을 시작할 수 있습니다.
              무료 크레딧으로 서비스를 체험해 보세요.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 mt-8 px-8 py-4 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors shadow-xl shadow-black/10"
            >
              무료로 시작하기
              <ArrowRight aria-hidden="true" className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
