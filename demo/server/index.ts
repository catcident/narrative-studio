import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, type Db, ObjectId } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

let db: Db | null = null;

async function connectDB(): Promise<Db> {
  if (db) return db;
  const url = process.env.MONGO_URL || 'mongodb://localhost:27017';
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(url);
  await client.connect();
  db = client.db('character_relationship_chart');
  console.log('MongoDB connected');
  return db;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/knowledge-graphs', async (req, res) => {
  try {
    const database = await connectDB();
    const items = await database.collection('knowledgeGraphs').find({}).sort({ updatedAt: -1 }).toArray();
    res.json(items.map(item => ({
      id: item._id.toString(),
      title: item.title || item.data?.metadata?.title || '제목 없음',
      savedAt: item.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: item.updatedAt?.toISOString() || new Date().toISOString(),
      version: item.version || 1,
      entityCount: item.entityCount || 0,
      edgeCount: item.edgeCount || 0,
      sceneCount: item.sceneCount || 0,
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/knowledge-graphs/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const item = await database.collection('knowledgeGraphs').findOne({ _id: new ObjectId(req.params.id) });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item.data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/knowledge-graphs', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection('knowledgeGraphs');
    const data = req.body;
    if (!data?.metadata) return res.status(400).json({ error: 'Invalid data' });

    const title = data.metadata.title;
    const now = new Date();
    const entityCount = Object.keys(data.entities || {}).length;
    const edgeCount = Object.keys(data.hyperedges || {}).length;
    const sceneCount = Object.keys(data.snapshots || {}).length;

    const existing = await collection.findOne({ title });

    if (existing) {
      const newVersion = (existing.version || 1) + 1;
      await collection.updateOne({ _id: existing._id }, {
        $set: { data, version: newVersion, updatedAt: now, entityCount, edgeCount, sceneCount }
      });
      res.json({ id: existing._id.toString(), title, savedAt: existing.createdAt?.toISOString(), updatedAt: now.toISOString(), version: newVersion, entityCount, edgeCount, sceneCount });
    } else {
      const result = await collection.insertOne({ title, data, version: 1, createdAt: now, updatedAt: now, entityCount, edgeCount, sceneCount });
      res.json({ id: result.insertedId.toString(), title, savedAt: now.toISOString(), updatedAt: now.toISOString(), version: 1, entityCount, edgeCount, sceneCount });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/knowledge-graphs/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const result = await database.collection('knowledgeGraphs').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: result.deletedCount > 0 });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 정적 파일 서빙
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  connectDB().catch(console.error);
});
