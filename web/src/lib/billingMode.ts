import 'server-only';

export type BillingMode = 'live' | 'test';

function parseBillingMode(value: string | undefined): BillingMode | null {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'live' || normalized === 'test') return normalized;
  return null;
}

export function getBillingMode(): BillingMode {
  return parseBillingMode(process.env.BILLING_MODE)
    ?? parseBillingMode(process.env.CATCIDENT_BILLING_MODE)
    ?? 'test';
}
