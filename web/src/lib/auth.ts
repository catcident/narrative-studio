import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { headers } from 'next/headers';

// 환경 변수로 인증 활성화 여부 결정
export const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

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

/** 만료 임박한 access token을 refresh token으로 갱신 */
async function refreshAccessToken(token: import('next-auth/jwt').JWT): Promise<import('next-auth/jwt').JWT> {
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
  } catch (error) {
    console.error('[auth] Token refresh error:', error);
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

      // 토큰 갱신: 만료 60초 전이면 refresh 시도
      const needsRefresh =
        token.accessTokenExpires &&
        token.refreshToken &&
        Date.now() > token.accessTokenExpires - 60_000;

      return needsRefresh ? refreshAccessToken(token) : token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.nickname = token.nickname;
      session.user.memberType = token.memberType;
      session.user.roles = token.roles;
      session.error = token.error;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/auth/error',
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
  return session?.user?.id || null;
}

export async function requireAuth(): Promise<{ userId: string; accessToken?: string } | { error: Response }> {
  if (!AUTH_ENABLED) {
    return { userId: 'anonymous' };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  // JWT에서 직접 accessToken 읽기 (클라이언트 세션에 노출하지 않음)
  const headerStore = await headers();
  const token = await getToken({
    req: { headers: headerStore },
    secureCookie: process.env.AUTH_URL?.startsWith('https://'),
  });
  return { userId: session.user.id, accessToken: token?.accessToken };
}
