import { billingGetHandler } from '@/services/billingProxy';

export const GET = billingGetHandler('/credits/balance/?service=storygraph', 'credits/balance GET');
