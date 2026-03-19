import 'server-only';

import type { PlanFeatures } from '@/types';
import { proxyToCatcident } from '@/services/billingProxy';

const STORYGRAPH_SERVICE_CODE = 'storygraph';

type BillingBackendErrorKind = 'transient' | 'config';

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

export class BillingBackendError extends Error {
  readonly kind: BillingBackendErrorKind;
  readonly status?: number;

  constructor(message: string, kind: BillingBackendErrorKind, status?: number) {
    super(message);
    this.name = 'BillingBackendError';
    this.kind = kind;
    this.status = status;
  }
}

export function isBillingBackendError(error: unknown): error is BillingBackendError {
  return error instanceof BillingBackendError;
}

export function isTransientBillingBackendError(error: unknown): error is BillingBackendError {
  return isBillingBackendError(error) && error.kind === 'transient';
}

export function isConfigBillingBackendError(error: unknown): error is BillingBackendError {
  return isBillingBackendError(error) && error.kind === 'config';
}

function classifyStatus(status: number): BillingBackendErrorKind {
  return status >= 500 ? 'transient' : 'config';
}

async function requestUpstreamJson<T>(
  path: string,
  accessToken?: string,
  options?: { method?: 'GET' | 'POST'; body?: string },
): Promise<T> {
  let response: Response;
  try {
    response = await proxyToCatcident(path, accessToken, options);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BillingBackendError(`${path} request failed: ${message}`, 'transient');
  }

  if (!response.ok) {
    throw new BillingBackendError(
      `${path} upstream error: ${response.status}`,
      classifyStatus(response.status),
      response.status,
    );
  }

  try {
    return await response.json() as T;
  } catch {
    throw new BillingBackendError(`${path} invalid JSON response`, 'transient');
  }
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

function computeScopedWalletBalance(wallet: BackendWalletSummary, serviceCode: string): number {
  if (!Array.isArray(wallet.grants) || wallet.grants.length === 0) {
    return wallet.availableTotal ?? 0;
  }

  let total = 0;
  for (const grant of wallet.grants) {
    const remaining = typeof grant.remainingCredits === 'number' ? grant.remainingCredits : 0;
    const isPlatform = grant.scopeType === 'platform';
    const isScopedService = grant.scopeType === 'service' && grant.serviceCode === serviceCode;
    if (isPlatform || isScopedService) {
      total += remaining;
    }
  }
  return total;
}

function buildFreeFallbackSubscription(
  serviceCode: string,
  catalog: BackendPublicPricingCatalog,
  wallet: BackendWalletSummary,
): NormalizedSubscriptionInfo | null {
  const freePlan = pickFreePlan(catalog);
  if (!freePlan) return null;

  const walletBalance = computeScopedWalletBalance(wallet, serviceCode);
  const bootstrapCredits = freePlan.included_service_credits ?? freePlan.monthly_credits ?? 0;

  return {
    subscription_id: 0,
    service_code: serviceCode,
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

function extractSubscriptionRows(
  data: PaginatedResponse<BackendSubscriptionRow> | BackendSubscriptionRow[],
): BackendSubscriptionRow[] {
  return Array.isArray(data) ? data : data.results;
}

async function fetchPublicPricingForService(serviceCode: string): Promise<BackendPublicPricingCatalog> {
  return requestUpstreamJson<BackendPublicPricingCatalog>(
    `/public/pricing/?service=${serviceCode}`,
    undefined,
  );
}

async function fetchWalletSummary(accessToken: string): Promise<BackendWalletSummary> {
  return requestUpstreamJson<BackendWalletSummary>('/credits/wallet/', accessToken);
}

async function fetchSubscriptionRowForService(
  accessToken: string,
  serviceCode: string,
): Promise<BackendSubscriptionRow | null> {
  const data = await requestUpstreamJson<PaginatedResponse<BackendSubscriptionRow> | BackendSubscriptionRow[]>(
    '/subscriptions/',
    accessToken,
  );
  const rows = extractSubscriptionRows(data);
  return rows.find((item) => item.service_code === serviceCode) ?? null;
}

async function bootstrapSubscriptionForService(
  accessToken: string,
  serviceCode: string,
): Promise<BackendSubscriptionRow> {
  return requestUpstreamJson<BackendSubscriptionRow>(
    '/subscriptions/bootstrap/',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ service_code: serviceCode }),
    },
  );
}

async function buildFallbackSubscriptionForService(
  accessToken: string,
  serviceCode: string,
): Promise<NormalizedSubscriptionInfo> {
  const [catalog, wallet] = await Promise.all([
    fetchPublicPricingForService(serviceCode),
    fetchWalletSummary(accessToken),
  ]);

  const fallback = buildFreeFallbackSubscription(serviceCode, catalog, wallet);
  if (!fallback) {
    throw new BillingBackendError(`${serviceCode} free plan not found`, 'config');
  }
  return fallback;
}

async function ensureSubscriptionForService(
  accessToken: string,
  serviceCode: string,
): Promise<NormalizedSubscriptionInfo> {
  let row: BackendSubscriptionRow | null;
  try {
    row = await fetchSubscriptionRowForService(accessToken, serviceCode);
  } catch (err: unknown) {
    if (!isTransientBillingBackendError(err)) {
      throw err;
    }
    console.warn(`[billing] ${serviceCode} subscription read failed, using fallback:`, err.message);
    return buildFallbackSubscriptionForService(accessToken, serviceCode);
  }

  if (row) {
    return mapBackendSubscriptionRow(row);
  }

  try {
    const bootstrapRow = await bootstrapSubscriptionForService(accessToken, serviceCode);
    return mapBackendSubscriptionRow(bootstrapRow);
  } catch (err: unknown) {
    if (!isTransientBillingBackendError(err)) {
      throw err;
    }
    console.warn(`[billing] ${serviceCode} subscription bootstrap failed, using fallback:`, err.message);
    return buildFallbackSubscriptionForService(accessToken, serviceCode);
  }
}

export async function fetchStorygraphPublicPricing(): Promise<BackendPublicPricingCatalog> {
  return fetchPublicPricingForService(STORYGRAPH_SERVICE_CODE);
}

export async function fetchStorygraphWalletSummary(accessToken: string): Promise<BackendWalletSummary> {
  return fetchWalletSummary(accessToken);
}

export async function fetchStorygraphSubscription(
  accessToken: string,
): Promise<NormalizedSubscriptionInfo | null> {
  const row = await fetchSubscriptionRowForService(accessToken, STORYGRAPH_SERVICE_CODE);

  if (row) {
    return mapBackendSubscriptionRow(row);
  }

  return buildFallbackSubscriptionForService(accessToken, STORYGRAPH_SERVICE_CODE);
}

export async function ensureStorygraphSubscription(accessToken: string): Promise<NormalizedSubscriptionInfo> {
  return ensureSubscriptionForService(accessToken, STORYGRAPH_SERVICE_CODE);
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

export async function ensureStorygraphBalanceSnapshot(
  accessToken: string,
): Promise<{ balance: number; plan: string }> {
  const subscription = await ensureStorygraphSubscription(accessToken);
  return {
    balance: subscription.credit_balance,
    plan: subscription.plan.code,
  };
}
