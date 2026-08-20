import {
  digestWithdrawalSubject,
  digestWithdrawalSubjectSync,
} from './withdrawalSubject.js';

export const SUBJECT_WRITE_FENCES_COLLECTION = 'subjectWriteFences';
const locallyBlockedSubjectDigests = new Set();

export class SubjectWriteBlockedError extends Error {
  constructor() {
    super('subject_write_blocked');
    this.name = 'SubjectWriteBlockedError';
  }
}

class SubjectWriteFenceCollisionError extends Error {
  constructor() {
    super('subject_write_fence_collision');
    this.name = 'SubjectWriteFenceCollisionError';
  }
}

function isDuplicateKeyError(error) {
  return typeof error === 'object' && error !== null && error.code === 11000;
}

async function claimSubjectWriteFence(db, subjectDigest, session) {
  const collection = db.collection(SUBJECT_WRITE_FENCES_COLLECTION);
  const now = new Date();
  try {
    await collection.updateOne(
      { _id: subjectDigest, status: 'active' },
      {
        $inc: { generation: 1 },
        $set: { updatedAt: now },
        $setOnInsert: { status: 'active', createdAt: now },
      },
      { upsert: true, session },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new SubjectWriteFenceCollisionError();
    throw error;
  }
}

export async function runWithSubjectWriteFence(db, userId, work) {
  if (isSubjectLocallyBlocked(userId)) throw new SubjectWriteBlockedError();
  const subjectDigest = await digestWithdrawalSubject(userId);
  const collection = db.collection(SUBJECT_WRITE_FENCES_COLLECTION);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (isSubjectLocallyBlocked(userId)) throw new SubjectWriteBlockedError();
    const session = db.client.startSession();
    try {
      let result;
      try {
        await session.withTransaction(async () => {
          await claimSubjectWriteFence(db, subjectDigest, session);
          result = await work(session);
        });
        return result;
      } catch (error) {
        if (!(error instanceof SubjectWriteFenceCollisionError)) throw error;
      }
    } finally {
      await session.endSession();
    }

    const durableFence = await collection.findOne(
      { _id: subjectDigest },
      { projection: { status: 1 } },
    );
    if (durableFence?.status === 'blocked') throw new SubjectWriteBlockedError();
  }

  throw new Error('subject_write_fence_retry_exhausted');
}

export async function blockSubjectWrites(db, userId) {
  const subjectDigest = digestWithdrawalSubjectSync(userId);
  locallyBlockedSubjectDigests.add(subjectDigest);
  const now = new Date();
  await db.collection(SUBJECT_WRITE_FENCES_COLLECTION).updateOne(
    { _id: subjectDigest },
    {
      $set: { status: 'blocked', updatedAt: now },
      $setOnInsert: { createdAt: now },
      $inc: { generation: 1 },
    },
    { upsert: true },
  );
}

export function isSubjectLocallyBlocked(userId) {
  return locallyBlockedSubjectDigests.has(digestWithdrawalSubjectSync(userId));
}
