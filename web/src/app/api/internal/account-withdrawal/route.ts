import { NextRequest, NextResponse } from 'next/server';
import { MongoServerError } from 'mongodb';

import { clearBalanceCacheForUser } from '@/lib/balanceCache';
import { clearHoldSessionsForUser } from '@/lib/holdSessionCache';
import { connectMongo, runInMongoTransaction } from '@/lib/mongo';
import { clearRateLimitForKey } from '@/lib/rateLimit';
import { blockSubjectWrites } from '@/lib/subjectWriteFence';
import {
  digestWithdrawalSubject,
  findWithdrawnSubject,
  isWithdrawalServiceConfigured,
  isWithdrawalServiceKeyValid,
  toWithdrawalReceipt,
  WITHDRAWAL_RECEIPT_VERSION,
  WITHDRAWAL_USER_COLLECTIONS,
  WITHDRAWN_SUBJECTS_COLLECTION,
  type WithdrawnSubjectRecord,
} from '@/lib/withdrawnSubjects';

export const runtime = 'nodejs';

const SUBJECT_PATTERN = /^\d{1,20}$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function genericError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function clearInMemoryUserState(userId: string): void {
  clearHoldSessionsForUser(userId);
  clearBalanceCacheForUser(userId);
  clearRateLimitForKey(userId);
}

export async function POST(request: NextRequest) {
  if (!isWithdrawalServiceConfigured()) {
    return genericError(503, 'Withdrawal service unavailable');
  }
  if (!(await isWithdrawalServiceKeyValid(request.headers.get('x-service-key')))) {
    return genericError(403, 'Forbidden');
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return genericError(400, 'Invalid request');
  }

  const userId = typeof body.userId === 'string' ? body.userId : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.toLowerCase() : '';
  const idempotencyKey = request.headers.get('idempotency-key')?.toLowerCase() || '';
  if (!SUBJECT_PATTERN.test(userId) || !REQUEST_ID_PATTERN.test(requestId) || idempotencyKey !== requestId) {
    return genericError(400, 'Invalid request');
  }

  try {
    const db = await connectMongo();
    const collection = db.collection<WithdrawnSubjectRecord>(WITHDRAWN_SUBJECTS_COLLECTION);
    const subjectDigest = await digestWithdrawalSubject(userId);
    const now = new Date();

    let record = await collection.findOne({ $or: [{ subjectDigest }, { requestId }] });
    if (record && (record.subjectDigest !== subjectDigest || record.requestId !== requestId)) {
      return genericError(409, 'Withdrawal receipt conflict');
    }

    if (!record) {
      try {
        await collection.insertOne({
          subjectDigest,
          requestId,
          status: 'blocked',
          deletedCounts: {},
          receiptVersion: WITHDRAWAL_RECEIPT_VERSION,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error: unknown) {
        if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      }
      record = await collection.findOne({ $or: [{ subjectDigest }, { requestId }] });
      if (!record || record.subjectDigest !== subjectDigest || record.requestId !== requestId) {
        return genericError(409, 'Withdrawal receipt conflict');
      }
    }

    await blockSubjectWrites(db, userId);
    clearInMemoryUserState(userId);

    if (record.status === 'deleted') {
      return NextResponse.json(toWithdrawalReceipt(record, 'already_deleted'));
    }

    const completedRecord = await runInMongoTransaction(db, async (session) => {
      const current = await findWithdrawnSubject(db, userId, session);
      if (!current || current.requestId !== requestId) {
        throw new Error('withdrawal_receipt_conflict');
      }
      if (current.status === 'deleted') return current;

      const graphIds = await db.collection('knowledgeGraphs')
        .find({ userId }, { projection: { _id: 1 }, session })
        .toArray();
      const legacyGraphReferences = graphIds.flatMap(({ _id }) => [_id, _id.toString()]);
      const deletedCounts: Record<string, number> = {};
      for (const collectionName of WITHDRAWAL_USER_COLLECTIONS) {
        const filter = collectionName === 'knowledgeGraphVersions'
          ? { $or: [{ userId }, { dataId: { $in: legacyGraphReferences } }] }
          : { userId };
        const deletion = await db.collection(collectionName).deleteMany(filter, { session });
        deletedCounts[collectionName] = deletion.deletedCount;
      }
      const completedAt = new Date();
      await collection.updateOne(
        { subjectDigest, requestId, status: 'blocked' },
        {
          $set: {
            status: 'deleted',
            deletedCounts,
            completedAt,
            updatedAt: completedAt,
          },
        },
        { session },
      );
      return {
        ...current,
        status: 'deleted' as const,
        deletedCounts,
        completedAt,
        updatedAt: completedAt,
      };
    });

    clearInMemoryUserState(userId);
    return NextResponse.json(toWithdrawalReceipt(completedRecord, 'deleted'), { status: 201 });
  } catch (error: unknown) {
    console.error('[account-withdrawal] deletion failed', error instanceof Error ? error.name : 'unknown');
    return genericError(500, 'Withdrawal processing failed');
  }
}
