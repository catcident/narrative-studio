export const MIN_WITHDRAWAL_SUBJECT_PEPPER_BYTES = 32;

export function configuredWithdrawalServiceKeys(env = process.env) {
  return [
    env.CATCIDENT_SERVICE_KEY,
    env.CATCIDENT_SERVICE_KEY_PREVIOUS,
  ].filter((value) => Boolean(value?.trim())).map((value) => value.trim());
}

export function configuredWithdrawalSubjectPepper(env = process.env) {
  const pepper = env.WITHDRAWAL_SUBJECT_PEPPER?.trim();
  if (!pepper) throw new Error('withdrawal_subject_pepper_missing');
  if (new TextEncoder().encode(pepper).byteLength < MIN_WITHDRAWAL_SUBJECT_PEPPER_BYTES) {
    throw new Error('withdrawal_subject_pepper_too_short');
  }
  if (configuredWithdrawalServiceKeys(env).includes(pepper)) {
    throw new Error('withdrawal_subject_pepper_reuses_service_key');
  }
  return pepper;
}

export function isWithdrawalSubjectRuntimeConfigured(env = process.env) {
  try {
    configuredWithdrawalSubjectPepper(env);
    return true;
  } catch {
    return false;
  }
}

export function isWithdrawalRuntimeConfigured(env = process.env) {
  return configuredWithdrawalServiceKeys(env).length > 0
    && isWithdrawalSubjectRuntimeConfigured(env);
}
