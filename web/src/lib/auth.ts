import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { headers } from 'next/headers';
import { isWithdrawnSubject } from '@/lib/withdrawnSubjects';
import { invalidateWithdrawnToken, WITHDRAWN_ACCOUNT_ERROR } from '@/lib/withdrawalTokenGuard';

// 인증은 기본 활성 — AUTH_ENABLED=false로 명시적 비활성화만 가능 (보안 기본값)
export const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';

// Catcident OIDC profile shape
interface CatcidentProfile {
  sub: string;
  email: string;
  name?: string;
  nickname?: string;
  member_type?: string;
  roles?: string[];
}

// NextAuth type augmentations are in types/next-auth.d.ts

// OIDC issuer (django-oauth-toolkit은 /oauth/에 마운트되어 있음)
const OIDC_ISSUER = process.env.AUTH_CATCIDENT_ISSUER
  ? `${process.env.AUTH_CATCIDENT_ISSUER}/oauth`
  : undefined;

const REFRESH_TOKEN_ERROR = 'RefreshTokenError';

/** 동시 갱신 경쟁 조건 방지를 위한 토큰별 싱글턴 (멀티유저 환경 대응) */
const refreshPromises = new Map<string, Promise<import('next-auth/jwt').JWT>>();

/** 만료 임박한 access token을 refresh token으로 갱신 */
async function refreshAccessToken(token: import('next-auth/jwt').JWT): Promise<import('next-auth/jwt').JWT> {
  const key = token.refreshToken!;
  const existing = refreshPromises.get(key);
  if (existing) return existing;
  const promise = doRefreshAccessToken(token);
  refreshPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    refreshPromises.delete(key);
  }
}

async function doRefreshAccessToken(token: import('next-auth/jwt').JWT): Promise<import('next-auth/jwt').JWT> {
  try {
    const response = await fetch(`${OIDC_ISSUER}/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken!,
        client_id: process.env.AUTH_CATCIDENT_ID || '',
        client_secret: process.env.AUTH_CATCIDENT_SECRET || '',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error('[auth] Token refresh failed:', response.status);
      return { ...token, error: REFRESH_TOKEN_ERROR };
    }

    const data = await response.json();
    return {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      accessTokenExpires: Date.now() + (data.expires_in ?? 3600) * 1000,
      error: undefined,
    };
  } catch (err: unknown) {
    console.error('[auth] Token refresh error:', err);
    return { ...token, error: REFRESH_TOKEN_ERROR };
  }
}

export const authConfig: NextAuthConfig = {
  providers: [
    {
      id: 'catcident',
      name: 'Catcident',
      type: 'oidc',
      issuer: OIDC_ISSUER,
      clientId: process.env.AUTH_CATCIDENT_ID,
      clientSecret: process.env.AUTH_CATCIDENT_SECRET || '',
      // Confidential 클라이언트: token 요청 시 client_secret을 Body에 포함
      client: {
        token_endpoint_auth_method: 'client_secret_post',
      },
      authorization: {
        params: {
          scope: 'openid profile email member billing',
        },
      },
      checks: ['pkce', 'state'],
      profile(profile) {
        return {
          id: profile.sub,
          email: profile.email,
          name: profile.name,
          nickname: profile.nickname,
          memberType: profile.member_type,
          roles: profile.roles || [],
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // 초기 로그인: account/profile에서 토큰 정보 저장
      if (account && profile) {
        const p = profile as CatcidentProfile;
        if (await isWithdrawnSubject(p.sub)) {
          throw new Error(WITHDRAWN_ACCOUNT_ERROR);
        }
        token.id = p.sub;
        token.nickname = p.nickname;
        token.memberType = p.member_type;
        token.roles = p.roles || [];
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 3600 * 1000;
        return token;
      }

      if (token.id && await isWithdrawnSubject(token.id)) {
        return invalidateWithdrawnToken(token);
      }

      // 토큰 갱신: 만료 60초 전이면 refresh 시도
      const needsRefresh =
        token.accessTokenExpires &&
        token.refreshToken &&
        Date.now() > token.accessTokenExpires - 60_000;

      return needsRefresh ? refreshAccessToken(token) : token;
    },
    async session({ session, token }) {
      const isWithdrawn = token.error === WITHDRAWN_ACCOUNT_ERROR;
      session.user.id = isWithdrawn || typeof token.id !== 'string' ? '' : token.id;
      session.user.email = isWithdrawn ? '' : session.user.email;
      session.user.name = isWithdrawn ? null : session.user.name;
      session.user.image = isWithdrawn ? null : session.user.image;
      session.user.nickname = isWithdrawn ? null : token.nickname;
      session.user.memberType = isWithdrawn ? null : token.memberType;
      session.user.roles = isWithdrawn ? [] : token.roles;
      session.error = token.error;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/',
  },
  trustHost: true,
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);

// API 라우트에서 사용할 헬퍼 함수
export async function getAuthUserId(): Promise<string | null> {
  if (!AUTH_ENABLED) {
    return 'anonymous'; // 인증 비활성화 시 기본 userId
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  try {
    return await isWithdrawnSubject(userId) ? null : userId;
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<{ userId: string; accessToken?: string } | { error: Response }> {
  if (!AUTH_ENABLED) {
    return { userId: 'anonymous' };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  try {
    if (await isWithdrawnSubject(session.user.id)) {
      return { error: NextResponse.json({ error: 'Account unavailable' }, { status: 403 }) };
    }
  } catch {
    return { error: NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 }) };
  }
  // JWT에서 직접 accessToken 읽기 (클라이언트 세션에 노출하지 않음)
  const headerStore = await headers();
  const token = await getToken({
    req: { headers: headerStore },
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.AUTH_URL?.startsWith('https://'),
  });
  return { userId: session.user.id, accessToken: token?.accessToken };
}
