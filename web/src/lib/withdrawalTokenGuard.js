export const WITHDRAWN_ACCOUNT_ERROR = 'WithdrawnAccountError';

export function invalidateWithdrawnToken(token) {
  return {
    ...token,
    id: undefined,
    sub: undefined,
    name: undefined,
    email: undefined,
    picture: undefined,
    nickname: undefined,
    memberType: undefined,
    roles: undefined,
    accessToken: undefined,
    refreshToken: undefined,
    accessTokenExpires: undefined,
    error: WITHDRAWN_ACCOUNT_ERROR,
  };
}

export function isActiveSession(session) {
  return typeof session?.user?.id === 'string'
    && session.user.id.length > 0
    && session.error !== WITHDRAWN_ACCOUNT_ERROR;
}
