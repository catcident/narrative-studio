import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

// 인증 비활성화 시 미들웨어 바이패스
export async function middleware(request: NextRequest) {
  if (!AUTH_ENABLED) {
    return NextResponse.next();
  }

  // 동적으로 auth 미들웨어 import
  const { auth } = await import('@/lib/auth');

  // @ts-expect-error - NextAuth middleware 타입 호환성
  return auth((req) => {
    const isLoggedIn = !!req.auth;
    const isApiRoute = req.nextUrl.pathname.startsWith('/api');
    const isAuthRoute = req.nextUrl.pathname.startsWith('/api/auth');
    const isLoginPage = req.nextUrl.pathname === '/login';

    // Auth routes are always accessible
    if (isAuthRoute) {
      return NextResponse.next();
    }

    // API routes require authentication (except auth routes)
    if (isApiRoute && !isLoggedIn) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Login page: redirect to home if already logged in
    if (isLoginPage && isLoggedIn) {
      return NextResponse.redirect(new URL('/', req.nextUrl));
    }

    // Protected pages: redirect to login if not logged in
    if (!isLoggedIn && !isLoginPage) {
      return NextResponse.redirect(new URL('/login', req.nextUrl));
    }

    return NextResponse.next();
  })(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
