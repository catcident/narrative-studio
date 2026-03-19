import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 인증은 기본 활성 — AUTH_ENABLED=false로 명시적 비활성화만 가능 (보안 기본값)
const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';

// 인증 비활성화 시: / → /app 리다이렉트만 적용
export async function middleware(request: NextRequest) {
  if (!AUTH_ENABLED) {
    // AUTH_ENABLED=false에서도 /app으로 라우팅
    if (request.nextUrl.pathname === '/') {
      return NextResponse.redirect(new URL('/app', request.nextUrl));
    }
    return NextResponse.next();
  }

  // 동적으로 auth 미들웨어 import
  const { auth } = await import('@/lib/auth');

  // @ts-expect-error - NextAuth middleware 타입 호환성
  return auth((req: NextRequest & { auth?: { user?: unknown } }) => {
    const isLoggedIn = !!req.auth;
    const { pathname } = req.nextUrl;
    const isApiRoute = pathname.startsWith('/api');
    const isAuthRoute = pathname.startsWith('/api/auth');
    const isPublicApi = pathname === '/api/config'
      || pathname === '/api/models'
      || pathname === '/api/legal-meta'
      || pathname === '/api/billing/public-pricing';
    const isLoginPage = pathname === '/login';
    const isLandingPage = pathname === '/';
    const isPublicPage = isLandingPage
      || pathname === '/sitemap.xml'
      || pathname === '/robots.txt';

    // Auth routes and public API routes are always accessible
    if (isAuthRoute || isPublicApi) {
      return NextResponse.next();
    }

    // API routes require authentication (except auth routes and public APIs)
    if (isApiRoute && !isLoggedIn) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Public pages: accessible without auth (including landing page for logged-in users)
    if (isPublicPage) {
      return NextResponse.next();
    }

    // Login page: redirect to /app if already logged in
    if (isLoginPage && isLoggedIn) {
      return NextResponse.redirect(new URL('/app', req.nextUrl));
    }

    // Protected pages (/app, etc.): redirect to login if not logged in
    if (!isLoggedIn && !isLoginPage) {
      return NextResponse.redirect(new URL('/login', req.nextUrl));
    }

    return NextResponse.next();
  })(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
