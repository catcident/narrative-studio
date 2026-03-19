import 'server-only';

import type { PlanFeatures } from '@/types';
import { proxyToCatcident } from '@/services/billingProxy';

const STORYGRAPH_SERVICE_CODE = 'storygraph';

export interface NormalizedSubscriptionInfo {
  subscription_id: number;
  service_code: string;
  plan: {
    code: string;
    name: string;
    monthly_credits: number;
    price_krw: number;
  };
  status: string;
  credit_balance: number;
  purchased_credit_balance: number;
  credit_reset_at: string | null;
  features: PlanFeatures;
  started_at?: string | null;
  expires_at: string | null;
}

interface BackendSubscriptionRow {
  id: number;
  service_code: string;
  service_name: string;
  plan_code: string;
  plan_name: string;
  plan_price_krw: number;
  included_service_credits: number;
  feature_flags: PlanFeatures;
  credit_balance: number;
  purchased_credit_balance: number;
  status: string;
  expires_at: string | null;
  renewal_anchor_at: string | null;
  auto_renew: boolean;
  has_active_payment_method?: boolean;
}

interface BackendWalletGrant {
  scopeType?: string;
  serviceCode?: string | null;
  remainingCredits?: number;
}

interface BackendWalletSummary {
  availableTotal: number;
  grants?: BackendWalletGrant[];
}

interface BackendServiceSummary {
  code: string;
  name: string;
  status: string;
  base_url: string;
  allow_platform_topup: boolean;
}

interface BackendPublicPlan {
  id: number;
  service_code: string;
  code: string;
  name: string;
  sort_order: number;
  monthly_credits: number;
  included_service_credits: number;
  price_krw: number;
  features: PlanFeatures;
  feature_flags: PlanFeatures;
  is_public: boolean;
}

interface BackendTopupPackage {
  id: number;
  code: string;
  service_code: string;
  name: string;
  credits: number;
  price_krw: number;
  bonus_pct: number;
  scope_type: string;
  bonus_policy: Record<string, unknown>;
}

export interface BackendPublicPricingCatalog {
  service: BackendServiceSummary;
  plans: BackendPublicPlan[];
  topup_packages: BackendTopupPackage[];
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

async function readUpstreamJson<T>(
  path: string,
  accessToken?: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const response = await proxyToCatcident(path, accessToken);
  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const data = await response.json() as T;
  return { ok: true, data };
}

export function mapBackendSubscriptionRow(row: BackendSubscriptionRow): NormalizedSubscriptionInfo {
  return {
    subscription_id: row.id,
    service_code: row.service_code,
    plan: {
      code: row.plan_code,
      name: row.plan_name,
      monthly_credits: row.included_service_credits,
      price_krw: row.plan_price_krw,
    },
    status: row.status,
    credit_balance: row.credit_balance,
    purchased_credit_balance: row.purchased_credit_balance,
    credit_reset_at: row.renewal_anchor_at,
    features: row.feature_flags,
    started_at: null,
    expires_at: row.expires_at,
  };
}

function pickFreePlan(catalog: BackendPublicPricingCatalog): BackendPublicPlan | null {
  const explicitFree = catalog.plans.find((plan) => plan.code === 'free');
  if (explicitFree) return explicitFree;
  return catalog.plans[0] ?? null;
}

function computeScopedWalletBalance(wallet: BackendWalletSummary): number {
  if (!Array.isArray(wallet.grants) || wallet.grants.length === 0) {
    return wallet.availableTotal ?? 0;
  }

  let total = 0;
  for (const grant of wallet.grants) {
    const remaining = typeof grant.remainingCredits === 'number' ? grant.remainingCredits : 0;
    const isPlatform = grant.scopeType === 'platform';
    const isStorygraph = grant.scopeType === 'service' && grant.serviceCode === STORYGRAPH_SERVICE_CODE;
    if (isPlatform || isStorygraph) {
      total += remaining;
    }
  }
  return total;
}

function buildFreeFallbackSubscription(
  catalog: BackendPublicPricingCatalog,
  wallet: BackendWalletSummary,
): NormalizedSubscriptionInfo | null {
  const freePlan = pickFreePlan(catalog);
  if (!freePlan) return null;

  const walletBalance = computeScopedWalletBalance(wallet);
  const bootstrapCredits = freePlan.included_service_credits ?? freePlan.monthly_credits ?? 0;

  return {
    subscription_id: 0,
    service_code: STORYGRAPH_SERVICE_CODE,
    plan: {
      code: freePlan.code,
      name: freePlan.name,
      monthly_credits: freePlan.included_service_credits ?? freePlan.monthly_credits,
      price_krw: freePlan.price_krw,
    },
    status: 'active',
    credit_balance: walletBalance + bootstrapCredits,
    purchased_credit_balance: 0,
    credit_reset_at: null,
    features: freePlan.feature_flags ?? freePlan.features,
    started_at: null,
    expires_at: null,
  };
}

export async function fetchStorygraphPublicPricing(): Promise<BackendPublicPricingCatalog> {
  const result = await readUpstreamJson<BackendPublicPricingCatalog>(
    `/public/pricing/?service=${STORYGRAPH_SERVICE_CODE}`,
    undefined,
  );
  if (!result.ok) {
    throw new Error(`public pricing upstream error: ${result.status}`);
  }
  return result.data;
}

export async function fetchStorygraphWalletSummary(accessToken: string): Promise<BackendWalletSummary> {
  const result = await readUpstreamJson<BackendWalletSummary>('/credits/wallet/', accessToken);
  if (!result.ok) {
    throw new Error(`wallet upstream error: ${result.status}`);
  }
  return result.data;
}

export async function fetchStorygraphSubscription(
  accessToken: string,
): Promise<NormalizedSubscriptionInfo | null> {
  const subscriptionsResult = await readUpstreamJson<PaginatedResponse<BackendSubscriptionRow> | BackendSubscriptionRow[]>(
    '/subscriptions/',
    accessToken,
  );

  if (!subscriptionsResult.ok) {
    throw new Error(`subscriptions upstream error: ${subscriptionsResult.status}`);
  }

  const rows = Array.isArray(subscriptionsResult.data)
    ? subscriptionsResult.data
    : subscriptionsResult.data.results;
  const row = rows.find((item) => item.service_code === STORYGRAPH_SERVICE_CODE);

  if (row) {
    return mapBackendSubscriptionRow(row);
  }

  const [catalog, wallet] = await Promise.all([
    fetchStorygraphPublicPricing(),
    fetchStorygraphWalletSummary(accessToken),
  ]);

  const fallback = buildFreeFallbackSubscription(catalog, wallet);
  if (!fallback) {
    throw new Error('storygraph free plan not found');
  }
  return fallback;
}

export async function fetchStorygraphBalanceSnapshot(
  accessToken: string,
): Promise<{ balance: number; plan: string }> {
  const subscription = await fetchStorygraphSubscription(accessToken);
  if (!subscription) {
    return { balance: 0, plan: 'free' };
  }
  return {
    balance: subscription.credit_balance,
    plan: subscription.plan.code,
  };
}
