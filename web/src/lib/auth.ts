import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import { NextResponse } from 'next/server';

// 환경 변수로 인증 활성화 여부 결정
export const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

// OIDC 설정 (discovery가 /oauth/ 경로에 있으므로 수동 설정)
const OIDC_ISSUER = process.env.AUTH_CATCIDENT_ISSUER;

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      nickname?: string | null;
      memberType?: string | null;
      roles?: string[];
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    nickname?: string | null;
    memberType?: string | null;
    roles?: string[];
  }
}

export const authConfig: NextAuthConfig = {
  providers: [
    {
      id: 'catcident',
      name: 'CatCident',
      type: 'oidc',
      // Discovery가 /oauth/ 경로에 있으므로 수동 설정
      issuer: OIDC_ISSUER,
      wellKnown: OIDC_ISSUER ? `${OIDC_ISSUER}/oauth/.well-known/openid-configuration` : undefined,
      clientId: process.env.AUTH_CATCIDENT_ID,
      clientSecret: process.env.AUTH_CATCIDENT_SECRET || '',
      // 수동 엔드포인트 설정 (discovery 우회)
      authorization: {
        url: OIDC_ISSUER ? `${OIDC_ISSUER}/oauth/authorize/` : undefined,
        params: {
          scope: 'openid profile email member',
        },
      },
      token: {
        url: OIDC_ISSUER ? `${OIDC_ISSUER}/oauth/token/` : undefined,
      },
      // Public 클라이언트: token 요청 시 client_secret 없이 client_id만 전송
      client: {
        token_endpoint_auth_method: 'none',
      },
      userinfo: {
        url: OIDC_ISSUER ? `${OIDC_ISSUER}/oauth/userinfo/` : undefined,
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
      if (account && profile) {
        token.id = profile.sub as string;
        token.nickname = (profile as any).nickname;
        token.memberType = (profile as any).member_type;
        token.roles = (profile as any).roles || [];
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.nickname = token.nickname;
      session.user.memberType = token.memberType;
      session.user.roles = token.roles;
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

export async function requireAuth(): Promise<{ userId: string } | { error: Response }> {
  if (!AUTH_ENABLED) {
    return { userId: 'anonymous' };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { userId: session.user.id };
}
