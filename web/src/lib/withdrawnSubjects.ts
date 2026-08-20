import 'server-only';

import type { ClientSession, Db } from 'mongodb';

import { connectMongo } from '@/lib/mongo';
import {
  configuredWithdrawalServiceKeys,
  isWithdrawalRuntimeConfigured,
} from '@/lib/withdrawalConfig';
import { digestWithdrawalSubject } from '@/lib/withdrawalSubject';

export { digestWithdrawalSubject } from '@/lib/withdrawalSubject';

export const WITHDRAWN_SUBJECTS_COLLECTION = 'withdrawnSubjects';
export const WITHDRAWAL_RECEIPT_VERSION = 1;
export const WITHDRAWAL_USER_COLLECTIONS = [
  'knowledgeGraphs',
  'knowledgeGraphVersions',
  'novels',
  'entityEmbeddings',
  'chunkEmbeddings',
] as const;

export interface WithdrawalReceipt {
  requestId: string;
  status: 'deleted' | 'already_deleted';
  deletedCounts: Record<string, number>;
  receiptVersion: number;
}

export interface WithdrawnSubjectRecord {
  subjectDigest: string;
  requestId: string;
  status: 'blocked' | 'deleted';
  deletedCounts: Record<string, number>;
  receiptVersion: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

export async function isWithdrawalServiceKeyValid(candidate: string | null): Promise<boolean> {
  if (!candidate) return false;
  const keys = configuredWithdrawalServiceKeys();
  if (keys.length === 0) return false;
  const candidateDigest = await sha256(candidate);
  const configuredDigests = await Promise.all(keys.map(sha256));
  let matched = 0;
  for (const digest of configuredDigests) {
    matched |= Number(constantTimeEqual(candidateDigest, digest));
  }
  return matched === 1;
}

export function isWithdrawalServiceConfigured(): boolean {
  return isWithdrawalRuntimeConfigured();
}

export async function findWithdrawnSubject(
  db: Db,
  userId: string,
  session?: ClientSession,
): Promise<WithdrawnSubjectRecord | null> {
  return db.collection<WithdrawnSubjectRecord>(WITHDRAWN_SUBJECTS_COLLECTION).findOne(
    { subjectDigest: await digestWithdrawalSubject(userId) },
    session ? { session } : undefined,
  );
}

export async function isWithdrawnSubject(userId: string): Promise<boolean> {
  const db = await connectMongo();
  return (await findWithdrawnSubject(db, userId)) !== null;
}

export function toWithdrawalReceipt(
  record: Pick<WithdrawnSubjectRecord, 'requestId' | 'deletedCounts' | 'receiptVersion'>,
  status: WithdrawalReceipt['status'],
): WithdrawalReceipt {
  if (record.receiptVersion !== WITHDRAWAL_RECEIPT_VERSION) {
    throw new Error('withdrawal_receipt_version_invalid');
  }
  const deletedCounts: Record<string, number> = {};
  for (const collectionName of WITHDRAWAL_USER_COLLECTIONS) {
    const count = record.deletedCounts?.[collectionName];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('withdrawal_receipt_counts_invalid');
    }
    deletedCounts[collectionName] = count;
  }
  return {
    requestId: record.requestId,
    status,
    deletedCounts,
    receiptVersion: record.receiptVersion,
  };
}
