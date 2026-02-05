import { billingGetHandler } from '@/services/billingProxy';

export const GET = billingGetHandler('/subscription/?service=storygraph', 'subscription GET');
