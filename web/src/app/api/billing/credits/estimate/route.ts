import { billingPostHandler } from '@/services/billingProxy';

export const POST = billingPostHandler('/credits/estimate/', 'credits/estimate POST');
