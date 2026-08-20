import { MongoClient, Db, type ClientSession } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';

let client: MongoClient | null = null;
let db: Db | null = null;
let clientPromise: Promise<MongoClient> | null = null;
let dbPromise: Promise<Db> | null = null;

let indexesCreated = false;
let withdrawalIndexesCreated = false;

const ANONYMOUS_TTL_SECONDS = 30 * 24 * 60 * 60; // 30일

async function ensureIndexes(database: Db): Promise<void> {
  if (indexesCreated) return;
  try {
    await Promise.all([
      database.collection('knowledgeGraphs').createIndex({ userId: 1 }),
      database.collection('knowledgeGraphs').createIndex({ userId: 1, title: 1 }),
      database.collection('knowledgeGraphVersions').createIndex({ dataId: 1, version: -1 }),
      database.collection('novels').createIndex({ userId: 1 }),
      database.collection('entityEmbeddings').createIndex({ graphId: 1, userId: 1 }),
      database.collection('chunkEmbeddings').createIndex({ graphId: 1, userId: 1 }),

      // anonymous 사용자 데이터 30일 자동 만료
      database.collection('knowledgeGraphs').createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: ANONYMOUS_TTL_SECONDS, partialFilterExpression: { userId: 'anonymous' } },
      ),
      database.collection('novels').createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: ANONYMOUS_TTL_SECONDS, partialFilterExpression: { userId: 'anonymous' } },
      ),
      database.collection('knowledgeGraphVersions').createIndex(
        { savedAt: 1 },
        { expireAfterSeconds: ANONYMOUS_TTL_SECONDS, partialFilterExpression: { userId: 'anonymous' } },
      ),
    ]);
    indexesCreated = true;
    console.log('[MongoDB] 인덱스 확인 완료');
  } catch (err: unknown) {
    console.warn('[MongoDB] 인덱스 생성 실패 (무시):', err);
  }
}

export function isMongoTransactionRuntimeConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const mongoUrl = env.MONGO_URL?.trim() || '';
  if (!mongoUrl) return false;
  if (mongoUrl.startsWith('mongodb+srv://')) return true;
  return /^mongodb:\/\//i.test(mongoUrl) && /[?&]replicaSet=[^&]+/i.test(mongoUrl);
}

async function ensureWithdrawalIndexes(database: Db): Promise<void> {
  if (withdrawalIndexesCreated) return;
  await Promise.all([
    database.collection('withdrawnSubjects').createIndex({ subjectDigest: 1 }, { unique: true }),
    database.collection('withdrawnSubjects').createIndex({ requestId: 1 }, { unique: true }),
  ]);
  withdrawalIndexesCreated = true;
}

async function connectMongoClient(): Promise<MongoClient> {
  if (client) return client;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const nextClient = new MongoClient(MONGO_URL);
    await nextClient.connect();
    client = nextClient;
    return nextClient;
  })();
  try {
    return await clientPromise;
  } finally {
    clientPromise = null;
  }
}

export async function connectMongo(): Promise<Db> {
  if (db) return db;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const mongoClient = await connectMongoClient();
    const database = mongoClient.db('character_relationship_chart');
    console.log('[MongoDB] 연결 성공');
    await ensureIndexes(database);
    await ensureWithdrawalIndexes(database);
    db = database;
    return database;
  })();
  try {
    return await dbPromise;
  } finally {
    dbPromise = null;
  }
}

export async function runInMongoTransaction<T>(
  _database: Db,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const mongoClient = client ?? await connectMongoClient();
  const session = mongoClient.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}
