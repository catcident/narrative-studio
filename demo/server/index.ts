/**
 * Express API 서버
 * MongoDB 연결 및 지식 그래프 CRUD API 제공
 * 프로덕션에서는 정적 파일도 서빙
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, Db, ObjectId } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MongoDB 연결
let db: Db | null = null;

async function connectDB(): Promise<Db> {
  if (db) return db;

  const url = process.env.MONGO_URL || 'mongodb://localhost:27017';
  console.log('Connecting to MongoDB...', url.replace(/:[^:@]+@/, ':****@'));

  const client = new MongoClient(url);
  await client.connect();
  db = client.db('character_relationship_chart');

  console.log('MongoDB connected successfully');
  return db;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== Knowledge Graph API ====================

// 목록 조회
app.get('/api/knowledge-graphs', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection('knowledgeGraphs');

    const items = await collection
      .find({})
      .sort({ updatedAt: -1 })
      .toArray();

    const list = items.map(item => ({
      id: item._id.toString(),
      title: item.title || item.data?.metadata?.title || '제목 없음',
      savedAt: item.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: item.updatedAt?.toISOString() || new Date().toISOString(),
      version: item.version || 1,
      entityCount: item.entityCount || Object.keys(item.data?.entities || {}).length,
      edgeCount: item.edgeCount || Object.keys(item.data?.hyperedges || {}).length,
      sceneCount: item.sceneCount || Object.keys(item.data?.snapshots || {}).length,
    }));

    res.json(list);
  } catch (err: any) {
    console.error('목록 조회 실패:', err);
    res.status(500).json({ error: err.message });
  }
});

// 단일 조회
app.get('/api/knowledge-graphs/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection('knowledgeGraphs');

    const item = await collection.findOne({ _id: new ObjectId(req.params.id) });
    if (!item) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(item.data);
  } catch (err: any) {
    console.error('조회 실패:', err);
    res.status(500).json({ error: err.message });
  }
});

// 저장 (신규/업데이트)
app.post('/api/knowledge-graphs', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection('knowledgeGraphs');
    const data = req.body;

    if (!data || !data.metadata) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    const title = data.metadata.title;
    const now = new Date();
    const entityCount = Object.keys(data.entities || {}).length;
    const edgeCount = Object.keys(data.hyperedges || {}).length;
    const sceneCount = Object.keys(data.snapshots || {}).length;

    // 같은 제목의 기존 데이터 확인
    const existing = await collection.findOne({ title });

    if (existing) {
      // 이전 버전 저장
      const versionsCollection = database.collection('knowledgeGraphVersions');
      await versionsCollection.insertOne({
        knowledgeGraphId: existing._id,
        version: existing.version || 1,
        data: existing.data,
        createdAt: now,
      });

      // 버전 10개 초과 시 오래된 것 삭제
      const versions = await versionsCollection
        .find({ knowledgeGraphId: existing._id })
        .sort({ version: -1 })
        .skip(10)
        .toArray();

      if (versions.length > 0) {
        await versionsCollection.deleteMany({
          _id: { $in: versions.map(v => v._id) }
        });
      }

      // 업데이트
      const newVersion = (existing.version || 1) + 1;
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            data,
            version: newVersion,
            updatedAt: now,
            entityCount,
            edgeCount,
            sceneCount,
          }
        }
      );

      res.json({
        id: existing._id.toString(),
        title,
        savedAt: existing.createdAt?.toISOString() || now.toISOString(),
        updatedAt: now.toISOString(),
        version: newVersion,
        entityCount,
        edgeCount,
        sceneCount,
      });
    } else {
      // 신규 생성
      const result = await collection.insertOne({
        title,
        data,
        version: 1,
        createdAt: now,
        updatedAt: now,
        entityCount,
        edgeCount,
        sceneCount,
      });

      res.json({
        id: result.insertedId.toString(),
        title,
        savedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        version: 1,
        entityCount,
        edgeCount,
        sceneCount,
      });
    }
  } catch (err: any) {
    console.error('저장 실패:', err);
    res.status(500).json({ error: err.message });
  }
});

// 삭제
app.delete('/api/knowledge-graphs/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection('knowledgeGraphs');
    const versionsCollection = database.collection('knowledgeGraphVersions');
    const objectId = new ObjectId(req.params.id);

    // 버전 히스토리 삭제
    await versionsCollection.deleteMany({ knowledgeGraphId: objectId });

    // 본 데이터 삭제
    const result = await collection.deleteOne({ _id: objectId });

    res.json({ success: result.deletedCount > 0 });
  } catch (err: any) {
    console.error('삭제 실패:', err);
    res.status(500).json({ error: err.message });
  }
});

// 버전 히스토리 조회
app.get('/api/knowledge-graphs/:id/versions', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection('knowledgeGraphVersions');
    const objectId = new ObjectId(req.params.id);

    const versions = await collection
      .find({ knowledgeGraphId: objectId })
      .sort({ version: -1 })
      .toArray();

    res.json(versions.map(v => ({
      version: v.version,
      savedAt: v.createdAt?.toISOString() || new Date().toISOString(),
      note: v.note,
    })));
  } catch (err: any) {
    console.error('버전 히스토리 조회 실패:', err);
    res.status(500).json({ error: err.message });
  }
});

// 버전 복원
app.post('/api/knowledge-graphs/:id/restore/:version', async (req, res) => {
  try {
    const database = await connectDB();
    const graphsCollection = database.collection('knowledgeGraphs');
    const versionsCollection = database.collection('knowledgeGraphVersions');
    const objectId = new ObjectId(req.params.id);
    const version = parseInt(req.params.version);

    const versionDoc = await versionsCollection.findOne({
      knowledgeGraphId: objectId,
      version,
    });

    if (!versionDoc) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const current = await graphsCollection.findOne({ _id: objectId });
    if (!current) {
      return res.status(404).json({ error: 'Knowledge graph not found' });
    }

    // 현재 버전을 히스토리에 저장
    await versionsCollection.insertOne({
      knowledgeGraphId: objectId,
      version: current.version || 1,
      data: current.data,
      createdAt: new Date(),
      note: '복원 전 자동 백업',
    });

    // 복원
    const newVersion = (current.version || 1) + 1;
    await graphsCollection.updateOne(
      { _id: objectId },
      {
        $set: {
          data: versionDoc.data,
          version: newVersion,
          updatedAt: new Date(),
        }
      }
    );

    res.json(versionDoc.data);
  } catch (err: any) {
    console.error('버전 복원 실패:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== 정적 파일 서빙 (프로덕션) ====================

// dist 폴더의 정적 파일 서빙
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA 라우팅 - API가 아닌 모든 요청은 index.html로
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Static files from: ${distPath}`);
  connectDB().catch(console.error);
});
