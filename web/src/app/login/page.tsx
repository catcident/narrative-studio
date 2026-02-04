'use client';

import { signIn } from 'next-auth/react';
import { Network } from 'lucide-react';

const NETWORK_LINES = [
  { x1: '10%', y1: '20%', x2: '30%', y2: '35%' },
  { x1: '30%', y1: '35%', x2: '25%', y2: '60%' },
  { x1: '30%', y1: '35%', x2: '50%', y2: '25%' },
  { x1: '70%', y1: '15%', x2: '85%', y2: '30%' },
  { x1: '85%', y1: '30%', x2: '75%', y2: '55%' },
  { x1: '85%', y1: '30%', x2: '95%', y2: '45%' },
  { x1: '15%', y1: '75%', x2: '35%', y2: '85%' },
  { x1: '35%', y1: '85%', x2: '55%', y2: '75%' },
  { x1: '65%', y1: '80%', x2: '80%', y2: '70%' },
  { x1: '80%', y1: '70%', x2: '90%', y2: '85%' },
] as const;

const NETWORK_NODES = [
  { position: 'top-[20%] left-[10%]', size: 'w-3 h-3', color: 'bg-blue-400/30', delay: '0s' },
  { position: 'top-[35%] left-[30%]', size: 'w-4 h-4', color: 'bg-indigo-400/40', delay: '0.5s' },
  { position: 'top-[60%] left-[25%]', size: 'w-2.5 h-2.5', color: 'bg-blue-500/30', delay: '1s' },
  { position: 'top-[25%] left-[50%]', size: 'w-3 h-3', color: 'bg-violet-400/30', delay: '0.3s' },
  { position: 'top-[15%] right-[30%]', size: 'w-3.5 h-3.5', color: 'bg-blue-400/35', delay: '0.7s' },
  { position: 'top-[30%] right-[15%]', size: 'w-4 h-4', color: 'bg-indigo-500/40', delay: '0.2s' },
  { position: 'top-[55%] right-[25%]', size: 'w-3 h-3', color: 'bg-blue-400/30', delay: '0.9s' },
  { position: 'top-[45%] right-[5%]', size: 'w-2.5 h-2.5', color: 'bg-violet-400/25', delay: '0.4s' },
  { position: 'bottom-[25%] left-[15%]', size: 'w-3 h-3', color: 'bg-indigo-400/30', delay: '0.6s' },
  { position: 'bottom-[15%] left-[35%]', size: 'w-3.5 h-3.5', color: 'bg-blue-500/35', delay: '1.1s' },
  { position: 'bottom-[25%] left-[55%]', size: 'w-3 h-3', color: 'bg-violet-400/30', delay: '0.8s' },
  { position: 'bottom-[20%] right-[35%]', size: 'w-4 h-4', color: 'bg-blue-400/40', delay: '0.1s' },
  { position: 'bottom-[30%] right-[20%]', size: 'w-3 h-3', color: 'bg-indigo-500/30', delay: '1.2s' },
  { position: 'bottom-[15%] right-[10%]', size: 'w-2.5 h-2.5', color: 'bg-blue-400/25', delay: '0.5s' },
] as const;

const FEATURES = [
  { color: 'bg-blue-500', text: '소설 텍스트에서 인물 자동 추출' },
  { color: 'bg-indigo-500', text: '관계 유형별 인터랙티브 그래프' },
  { color: 'bg-violet-500', text: '장면별 타임라인 & 연대기 뷰' },
] as const;

function NetworkBackground(): React.ReactElement {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg className="absolute inset-0 w-full h-full opacity-[0.08]">
        <defs>
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        {NETWORK_LINES.map((line, i) => (
          <line key={i} {...line} stroke="url(#lineGradient)" strokeWidth="1.5" />
        ))}
      </svg>
      {NETWORK_NODES.map((node, i) => (
        <div
          key={i}
          className={`absolute ${node.position} ${node.size} rounded-full ${node.color} animate-pulse`}
          style={{ animationDelay: node.delay }}
        />
      ))}
    </div>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100" />
      <NetworkBackground />

      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl shadow-blue-900/5 border border-white/50 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-lg shadow-blue-500/25 mb-5">
              <Network className="w-8 h-8 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              인물 관계도
            </h1>
            <p className="text-gray-500 mt-2 text-sm">
              AI가 소설을 분석하여 인물 관계를 시각화합니다
            </p>
          </div>

          <ul className="mb-8 space-y-3">
            {FEATURES.map((feature) => (
              <li key={feature.text} className="flex items-center gap-3 text-sm text-gray-600">
                <div className={`w-1.5 h-1.5 rounded-full ${feature.color}`} aria-hidden="true" />
                <span>{feature.text}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={() => signIn('catcident', { callbackUrl: '/' })}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium rounded-xl shadow-lg shadow-blue-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
            </svg>
            Catcident 계정으로 로그인
          </button>

          <p className="mt-6 text-center text-xs text-gray-400">
            Catcident 회원만 이용 가능합니다
          </p>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by AI · 인물 관계 분석 엔진
        </p>
      </div>
    </div>
  );
}
