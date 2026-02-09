'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Network, ArrowRight } from 'lucide-react';

export function LandingHeader() {
  const { data: session, status } = useSession();
  const isLoggedIn = status === 'authenticated' && !!session;
  const isLoading = status === 'loading';

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/70 backdrop-blur-xl border-b border-gray-200/50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
            <Network aria-hidden="true" className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold text-gray-900 tracking-tight">스토리그래프</span>
        </Link>

        <nav aria-label="메인 네비게이션" className="flex items-center gap-1">
          <a href="#features" className="sr-only md:not-sr-only md:inline-flex px-3 py-2 text-sm text-gray-500 hover:text-gray-900 transition-colors rounded-lg">
            기능
          </a>
          <a href="#how-it-works" className="sr-only md:not-sr-only md:inline-flex px-3 py-2 text-sm text-gray-500 hover:text-gray-900 transition-colors rounded-lg">
            사용 방법
          </a>
          <a href="#pricing" className="sr-only md:not-sr-only md:inline-flex px-3 py-2 text-sm text-gray-500 hover:text-gray-900 transition-colors rounded-lg">
            요금제
          </a>
          <div className="w-px h-5 bg-gray-200 mx-2" aria-hidden="true" />

          {isLoading ? (
            <div className="w-24 h-9" />
          ) : isLoggedIn ? (
            <Link
              href="/app"
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-lg hover:from-indigo-600 hover:to-violet-700 transition-all shadow-sm hover:shadow-md"
            >
              앱으로 이동
              <ArrowRight aria-hidden="true" className="w-4 h-4" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors rounded-lg">
                로그인
              </Link>
              <Link
                href="/login"
                className="ml-1 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-lg hover:from-indigo-600 hover:to-violet-700 transition-all shadow-sm hover:shadow-md"
              >
                시작하기
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
