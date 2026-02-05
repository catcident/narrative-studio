import { billingGetHandler } from '@/services/billingProxy';

export const GET = billingGetHandler('/plans/?service=storygraph', 'plans GET');
