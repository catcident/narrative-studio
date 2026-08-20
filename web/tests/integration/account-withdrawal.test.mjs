import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { isActiveSession, invalidateWithdrawnToken, WITHDRAWN_ACCOUNT_ERROR } from '../../src/lib/withdrawalTokenGuard.js';
import { configuredWithdrawalSubjectPepper } from '../../src/lib/withdrawalConfig.js';
import { runWithSubjectWriteFence, SubjectWriteBlockedError } from '../../src/lib/subjectWriteFence.js';

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3300';
const mongoUrl = process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018/character_relationship_chart?replicaSet=rs0&directConnection=true';
const serviceKey = process.env.TEST_CATCIDENT_SERVICE_KEY || 'integration-storygraph-service-key';
const subjectPepper = process.env.TEST_WITHDRAWAL_SUBJECT_PEPPER || 'integration-withdrawal-subject-pepper';
const userCollections = [
  'knowledgeGraphs',
  'knowledgeGraphVersions',
  'novels',
  'entityEmbeddings',
  'chunkEmbeddings',
];

function subjectDigest(userId) {
  return createHmac('sha256', subjectPepper)
    .update(`catcident-storygraph-withdrawal:v1:${userId}`, 'utf8')
    .digest('hex');
}

async function postWithdrawal(userId, requestId, key = serviceKey) {
  return fetch(`${baseUrl}/api/internal/account-withdrawal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Key': key,
      'Idempotency-Key': requestId,
    },
    body: JSON.stringify({ userId, requestId }),
  });
}

test('withdrawal serializes with writes, deletes all owned data, and returns a durable receipt', { timeout: 60_000 }, async () => {
  const userId = String(Date.now());
  const requestId = randomUUID();
  const client = new MongoClient(mongoUrl);
  await client.connect();
  const db = client.db();
  const graphId = new ObjectId();
  let releaseInFlightWrite = () => {};

  try {
    const warmup = await fetch(`${baseUrl}/api/novels`);
    assert.equal(warmup.status, 200);

    for (const collectionName of userCollections) {
      if (collectionName === 'knowledgeGraphs') {
        await db.collection(collectionName).insertOne({ _id: graphId, userId, fixture: requestId });
      } else if (collectionName === 'knowledgeGraphVersions') {
        await db.collection(collectionName).insertMany([
          { dataId: graphId.toString(), fixture: requestId },
          { dataId: graphId, fixture: requestId },
        ]);
      } else {
        await db.collection(collectionName).insertOne({ userId, fixture: requestId });
      }
    }

    await Promise.all([0, 1].map((writer) => runWithSubjectWriteFence(db, userId, async (session) => {
      await db.collection('novels').insertOne({ userId, fixture: requestId, concurrentFenceWriter: writer }, { session });
    })));

    assert.equal((await postWithdrawal(userId, requestId, 'invalid-service-key')).status, 403);

    let signalFenceClaimed = () => {};
    const fenceClaimed = new Promise((resolve) => { signalFenceClaimed = resolve; });
    const releaseFence = new Promise((resolve) => { releaseInFlightWrite = resolve; });
    const inFlightWrite = runWithSubjectWriteFence(db, userId, async (session) => {
      await db.collection('novels').insertOne({ userId, fixture: requestId, inFlight: true }, { session });
      signalFenceClaimed();
      await releaseFence;
    });
    await fenceClaimed;

    const completedPromise = postWithdrawal(userId, requestId);
    const tombstoneDeadline = Date.now() + 10_000;
    let blockedTombstone = null;
    while (!blockedTombstone && Date.now() < tombstoneDeadline) {
      blockedTombstone = await db.collection('withdrawnSubjects').findOne({ requestId });
      if (!blockedTombstone) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(blockedTombstone);
    assert.equal(blockedTombstone.status, 'blocked');

    releaseInFlightWrite();
    await inFlightWrite;

    const completed = await completedPromise;
    assert.equal(completed.status, 201);
    const firstReceipt = await completed.json();
    assert.equal(firstReceipt.requestId, requestId);
    assert.equal(firstReceipt.status, 'deleted');
    assert.equal(firstReceipt.receiptVersion, 1);
    for (const collectionName of userCollections) {
      const expectedCount = collectionName === 'novels' ? 4 : collectionName === 'knowledgeGraphVersions' ? 2 : 1;
      assert.equal(firstReceipt.deletedCounts[collectionName], expectedCount);
      assert.equal(await db.collection(collectionName).countDocuments({ fixture: requestId }), 0);
    }

    const tombstone = await db.collection('withdrawnSubjects').findOne({ requestId });
    assert.equal(tombstone.subjectDigest, subjectDigest(userId));
    assert.equal(tombstone.status, 'deleted');
    assert.equal(Object.hasOwn(tombstone, 'userId'), false);

    const durableFence = await db.collection('subjectWriteFences').findOne({ _id: subjectDigest(userId) });
    assert.equal(durableFence.status, 'blocked');
    assert.equal(Object.hasOwn(durableFence, 'userId'), false);

    await assert.rejects(
      runWithSubjectWriteFence(db, userId, async (session) => {
        await db.collection('novels').insertOne({ userId, fixture: requestId, afterReceipt: true }, { session });
      }),
      SubjectWriteBlockedError,
    );

    const staleJwt = invalidateWithdrawnToken({
      id: userId,
      sub: userId,
      name: 'withdrawn user',
      email: 'withdrawn@example.com',
      accessToken: 'already-issued-access-token',
      refreshToken: 'already-issued-refresh-token',
      accessTokenExpires: Date.now() + 60_000,
    });
    assert.equal(staleJwt.error, WITHDRAWN_ACCOUNT_ERROR);
    for (const field of ['id', 'sub', 'name', 'email', 'accessToken', 'refreshToken', 'accessTokenExpires']) {
      assert.equal(staleJwt[field], undefined);
    }
    assert.equal(isActiveSession({ user: { id: userId } }), true);
    assert.equal(isActiveSession({ user: { id: userId }, error: WITHDRAWN_ACCOUNT_ERROR }), false);
    assert.equal(isActiveSession({ user: { id: '' } }), false);

    const distinctServiceKey = 'test-service-key-that-is-long-enough';
    const distinctPepper = 'test-withdrawal-pepper-that-is-distinct';
    assert.equal(configuredWithdrawalSubjectPepper({
      CATCIDENT_SERVICE_KEY: distinctServiceKey,
      WITHDRAWAL_SUBJECT_PEPPER: distinctPepper,
    }), distinctPepper);
    assert.throws(() => configuredWithdrawalSubjectPepper({
      CATCIDENT_SERVICE_KEY: distinctServiceKey,
      WITHDRAWAL_SUBJECT_PEPPER: '테스트-페퍼',
    }), /withdrawal_subject_pepper_too_short/);
    assert.throws(() => configuredWithdrawalSubjectPepper({
      CATCIDENT_SERVICE_KEY: 'current-test-service-key-that-is-distinct',
      CATCIDENT_SERVICE_KEY_PREVIOUS: distinctServiceKey,
      WITHDRAWAL_SUBJECT_PEPPER: distinctServiceKey,
    }), /withdrawal_subject_pepper_reuses_service_key/);

    const replay = await postWithdrawal(userId, requestId);
    assert.equal(replay.status, 200);
    const replayReceipt = await replay.json();
    assert.equal(replayReceipt.status, 'already_deleted');
    assert.deepEqual(replayReceipt.deletedCounts, firstReceipt.deletedCounts);
    assert.equal((await postWithdrawal(userId, randomUUID())).status, 409);

    await db.collection('withdrawnSubjects').updateOne(
      { requestId },
      { $unset: { receiptVersion: '' } },
    );
    const corruptReplay = await postWithdrawal(userId, requestId);
    assert.equal(corruptReplay.status, 500);
    assert.equal((await corruptReplay.json()).error, 'Withdrawal processing failed');
  } finally {
    releaseInFlightWrite();
    await db.collection('withdrawnSubjects').deleteMany({ requestId });
    await db.collection('subjectWriteFences').deleteMany({ _id: subjectDigest(userId) });
    for (const collectionName of userCollections) {
      await db.collection(collectionName).deleteMany({ fixture: requestId });
    }
    await client.close();
  }
});
