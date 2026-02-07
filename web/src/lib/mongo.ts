import { MongoClient, Db } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';

let client: MongoClient | null = null;
let db: Db | null = null;

let indexesCreated = false;

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
    ]);
    indexesCreated = true;
    console.log('[MongoDB] 인덱스 확인 완료');
  } catch (err) {
    console.warn('[MongoDB] 인덱스 생성 실패 (무시):', err);
  }
}

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db('character_relationship_chart');
  console.log('[MongoDB] 연결 성공');
  await ensureIndexes(db);
  return db;
}
