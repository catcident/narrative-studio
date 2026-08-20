import type { ClientSession, Db } from 'mongodb';

export const SUBJECT_WRITE_FENCES_COLLECTION: string;

export class SubjectWriteBlockedError extends Error {}

export function runWithSubjectWriteFence<T>(
  db: Db,
  userId: string,
  work: (session: ClientSession) => Promise<T>,
): Promise<T>;

export function blockSubjectWrites(db: Db, userId: string): Promise<void>;
export function isSubjectLocallyBlocked(userId: string): boolean;
