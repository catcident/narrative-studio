'use client';

import { signIn } from 'next-auth/react';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">인물 관계도</h1>
          <p className="mt-2 text-gray-600">소설 인물 관계 분석기</p>
        </div>
        <div className="mt-8">
          <button
            onClick={() => signIn('catcident', { callbackUrl: '/' })}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            CatCident 계정으로 로그인
          </button>
        </div>
        <p className="mt-4 text-center text-sm text-gray-500">
          CatCident 회원만 이용 가능합니다
        </p>
      </div>
    </div>
  );
}
