'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface BillingTestSessionState {
  enabled: boolean;
  active: boolean;
  sessionId?: string;
  balanceCredits?: number;
  holdCount?: number;
  createdAt?: string;
  expiresAt?: string;
  message?: string;
}

const DEFAULT_CREDITS = '30';

export default function BillingTestPage() {
  const [secret, setSecret] = useState('');
  const [initialCredits, setInitialCredits] = useState(DEFAULT_CREDITS);
  const [session, setSession] = useState<BillingTestSessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/internal/billing-test-session', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setSession(data);
      if (typeof data?.balanceCredits === 'number') {
        setInitialCredits(String(data.balanceCredits));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '세션 상태를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const isEnabled = session?.enabled ?? false;
  const isActive = session?.active ?? false;

  const submitSession = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const numericCredits = Number(initialCredits);
      const res = await fetch('/api/internal/billing-test-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          initialCredits: numericCredits,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setSession(data);
      setNotice(isActive ? 'Mock billing 세션을 재설정했습니다.' : 'Mock billing 세션을 활성화했습니다.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '세션 활성화에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }, [initialCredits, isActive, secret]);

  const clearSession = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch('/api/internal/billing-test-session', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setSession({ enabled: true, active: false });
      setNotice('Mock billing 세션을 종료했습니다.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '세션 종료에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }, [secret]);

  const sessionStatus = useMemo(() => {
    if (loading) return '불러오는 중';
    if (!isEnabled) return '비활성화됨';
    if (!isActive) return '대기 중';
    return '활성';
  }, [isActive, isEnabled, loading]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-sky-100 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-700">Internal</p>
            <h1 className="text-3xl font-semibold text-slate-900">Billing Test Session</h1>
            <p className="mt-2 text-sm text-slate-600">
              Railway 익명 환경에서만 사용하는 mock billing 세션입니다.
            </p>
          </div>
          <Link
            href="/app"
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
          >
            /app으로 돌아가기
          </Link>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
            <div className="space-y-5">
              <div>
                <label htmlFor="secret" className="mb-2 block text-sm font-medium text-slate-700">
                  Billing Test Secret
                </label>
                <input
                  id="secret"
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder="shared secret"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>

              <div>
                <label htmlFor="initialCredits" className="mb-2 block text-sm font-medium text-slate-700">
                  Initial Mock Credits
                </label>
                <input
                  id="initialCredits"
                  type="number"
                  min="0"
                  step="1"
                  value={initialCredits}
                  onChange={(event) => setInitialCredits(event.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={submitSession}
                  disabled={submitting || loading}
                  className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isActive ? '세션 재설정' : '세션 활성화'}
                </button>
                <button
                  type="button"
                  onClick={clearSession}
                  disabled={submitting || loading || !isActive}
                  className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  세션 종료
                </button>
                <button
                  type="button"
                  onClick={loadState}
                  disabled={submitting || loading}
                  className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  상태 새로고침
                </button>
              </div>

              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              )}

              {notice && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {notice}
                </div>
              )}
            </div>

            <aside className="rounded-3xl bg-slate-950 px-5 py-6 text-slate-100">
              <p className="text-xs uppercase tracking-[0.24em] text-sky-300">Session State</p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">상태</span>
                  <span className="font-medium text-white">{sessionStatus}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">잔액</span>
                  <span className="font-medium text-white">{session?.balanceCredits ?? 0} cr</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">열린 hold</span>
                  <span className="font-medium text-white">{session?.holdCount ?? 0}</span>
                </div>
              </div>

              <div className="mt-6 space-y-2 text-xs text-slate-400">
                <p>created: {session?.createdAt ?? '-'}</p>
                <p>expires: {session?.expiresAt ?? '-'}</p>
                <p>session: {session?.sessionId ?? '-'}</p>
                {session?.message && <p>{session.message}</p>}
              </div>
            </aside>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white/80 p-6 text-sm text-slate-600 shadow-sm">
          <p className="font-medium text-slate-900">사용 순서</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>secret과 초기 크레딧을 입력해 mock billing 세션을 활성화합니다.</li>
            <li>`/app`으로 돌아가 큰 파일 분석을 시작하면 기존 UI에서 warning, hold, partial stop 흐름을 그대로 볼 수 있습니다.</li>
            <li>세션이 활성화된 브라우저에서는 무료 Railway analyze fallback을 타지 않고 hold 예산이 강제됩니다.</li>
          </ol>
        </section>
      </div>
    </main>
  );
}
