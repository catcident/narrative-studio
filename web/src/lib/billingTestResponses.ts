import 'server-only';
import type { CreditTransaction, PlanFeatures } from '@/types';

const BILLING_TEST_FEATURES: PlanFeatures = {
  byok: true,
  models: 'all',
  max_file_size_mb: 512,
  can_purchase_credits: false,
  max_chats_per_analysis: -1,
  max_saved_graphs: -1,
  max_versions: -1,
  export_formats: ['png', 'svg', 'pdf'],
};

export function buildBillingTestSubscription(session: {
  sessionId: string;
  balanceCredits: number;
  createdAt: number;
  expiresAt: number;
}) {
  return {
    subscription_id: 0,
    service_code: 'storygraph',
    plan: {
      code: 'billing-test',
      name: 'Billing Test',
      monthly_credits: 0,
      price_krw: 0,
    },
    status: 'active',
    credit_balance: session.balanceCredits,
    purchased_credit_balance: 0,
    credit_reset_at: null,
    features: BILLING_TEST_FEATURES,
    started_at: new Date(session.createdAt).toISOString(),
    expires_at: new Date(session.expiresAt).toISOString(),
  };
}

export function buildBillingTestBalance(session: { balanceCredits: number }) {
  return {
    balance: session.balanceCredits,
    plan: 'billing-test',
  };
}

export function buildBillingTestTransactions() {
  return {
    count: 0,
    next: null,
    previous: null,
    results: [] as CreditTransaction[],
  };
}
