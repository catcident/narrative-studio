import { billingPostHandler } from '@/services/billingProxy';

export const POST = billingPostHandler('/credits/deduct/', 'credits/deduct POST');
