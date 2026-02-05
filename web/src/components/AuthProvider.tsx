'use client';

import { SessionProvider } from 'next-auth/react';
import { useSessionErrorHandler } from '../lib/useSessionErrorHandler';

function SessionErrorHandler({ children }: { children: React.ReactNode }) {
  useSessionErrorHandler();
  return <>{children}</>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SessionErrorHandler>{children}</SessionErrorHandler>
    </SessionProvider>
  );
}
