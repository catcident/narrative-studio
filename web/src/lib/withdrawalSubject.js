import { createHmac } from 'node:crypto';
import { configuredWithdrawalSubjectPepper } from './withdrawalConfig.js';

const SUBJECT_DIGEST_DOMAIN = 'catcident-storygraph-withdrawal:v1:';

export function digestWithdrawalSubjectSync(userId, env = process.env) {
  return createHmac('sha256', configuredWithdrawalSubjectPepper(env))
    .update(`${SUBJECT_DIGEST_DOMAIN}${userId}`, 'utf8')
    .digest('hex');
}

export async function digestWithdrawalSubject(userId, env = process.env) {
  return digestWithdrawalSubjectSync(userId, env);
}
