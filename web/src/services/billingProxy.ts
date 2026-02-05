/**
 * catcident-backend billing API 프록시 유틸리티 (서버 사이드)
 */

const CATCIDENT_API_URL = process.env.CATCIDENT_API_URL || 'https://catcident.com';
const CATCIDENT_SERVICE_KEY = process.env.CATCIDENT_SERVICE_KEY || '';

interface ProxyOptions {
  method?: string;
  body?: string | null;
}

export async function proxyToCatcident(
  path: string,
  accessToken: string | undefined,
  options: ProxyOptions = {}
): Promise<Response> {
  const { method = 'GET', body = null } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  if (CATCIDENT_SERVICE_KEY) {
    headers['X-Service-Key'] = CATCIDENT_SERVICE_KEY;
  }

  const url = `${CATCIDENT_API_URL}/api/v1/billing${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? body : undefined,
    });

    return response;
  } catch (error) {
    console.error(`[billing] Proxy error: ${path}`, error);
    throw error;
  }
}
