/**
 * 사용자별 localStorage 정리 유틸리티
 * 로그아웃 또는 계정 전환 시 이전 사용자의 로컬 데이터를 제거하여
 * 다른 계정에서 기존 사용자의 분석 진행상황이나 채팅이 보이는 것을 방지
 */

// 마지막 로그인 사용자 추적 키
const LAST_USER_KEY = 'storygraph-last-user';

// 사용자별 고정 키
const USER_SCOPED_KEYS = [
  LAST_USER_KEY,
  'OPENROUTER_API_KEY',
  'BYOK_MODE',
  'novel-extraction-progress',
  'chat_sessions',
];

const SESSION_SCOPED_KEYS = [
  'auth_relogin_attempt',
  'currentDataId',
  'viewMode',
];

const SESSION_SCOPED_PREFIXES = [
  'balance_alert_dismissed_',
];

// 사용자별 동적 프리픽스 (chat_messages_*, chat_count_*)
const USER_SCOPED_PREFIXES = [
  'chat_messages_',
  'chat_count_',
];

/** 사용자별 localStorage 데이터 모두 제거 */
export function clearUserScopedStorage(): void {
  for (const key of USER_SCOPED_KEYS) {
    localStorage.removeItem(key);
  }

  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && USER_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }

  for (const key of SESSION_SCOPED_KEYS) {
    sessionStorage.removeItem(key);
  }

  const sessionKeysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && SESSION_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      sessionKeysToRemove.push(key);
    }
  }
  for (const key of sessionKeysToRemove) {
    sessionStorage.removeItem(key);
  }
}

/**
 * 사용자 전환 감지 및 정리.
 * @returns 전환이 감지되어 정리가 수행되었으면 true
 */
export function handleUserChange(userId: string): boolean {
  const lastUserId = localStorage.getItem(LAST_USER_KEY);

  if (lastUserId && lastUserId !== userId) {
    console.log('[auth] 사용자 전환 감지, 이전 데이터 정리');
    clearUserScopedStorage();
    localStorage.setItem(LAST_USER_KEY, userId);
    return true;
  }
  localStorage.setItem(LAST_USER_KEY, userId);
  return false;
}
