import { billingGetHandler } from '@/services/billingProxy';

export const GET = billingGetHandler('/packages/?service=storygraph', 'packages GET');
