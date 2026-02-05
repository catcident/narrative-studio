import 'next-auth';
import 'next-auth/jwt';

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

  interface User {
    id: string;
    email: string;
    name?: string | null;
    nickname?: string | null;
    memberType?: string | null;
    roles?: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    nickname?: string | null;
    memberType?: string | null;
    roles?: string[];
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
  }
}
