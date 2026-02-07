/**
 * 지식그래프 추출 파이프라인 테스트 스크립트
 *
 * 사용법:
 *   cd web && npx tsx ../test/run-test.ts [파일번호|all] [--outdir results2]
 *
 * 예시:
 *   npx tsx ../test/run-test.ts 08
 *   npx tsx ../test/run-test.ts all --outdir results2
 *
 * OpenRouter API 키를 web/.env.local에서 읽습니다.
 */

import fs from 'fs';
import path from 'path';

// ─── 설정 ───
const MODEL = 'google/gemini-2.0-flash-001';
const CHUNK_SIZE = 5000;
const TEST_DIR = path.resolve(__dirname);
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// API 키 로드
function loadApiKey(): string {
  const envPath = path.resolve(__dirname, '../web/.env.local');
  if (!fs.existsSync(envPath)) throw new Error('.env.local 없음');
  const content = fs.readFileSync(envPath, 'utf-8');
  const match = content.match(/OPENROUTER_API_KEY=(.+)/);
  return match?.[1]?.trim() || '';
}

const API_KEY = loadApiKey();

// 프롬프트 로드
function loadPrompts() {
  const p = path.resolve(__dirname, '../web/src/services/extraction/prompts.ts');
  const content = fs.readFileSync(p, 'utf-8');
  const userMatch = content.match(/export const USER_PROMPT = `([\s\S]*?)`;/);
  const mergeMatch = content.match(/export const ENTITY_MERGE_REVIEW_PROMPT = `([\s\S]*?)`;/);
  return {
    USER_PROMPT: userMatch?.[1] || '',
    ENTITY_MERGE_REVIEW_PROMPT: mergeMatch?.[1] || '',
  };
}

// ─── OpenRouter 직접 호출 ───
async function callLLM(prompt: string, model: string = MODEL): Promise<string> {
  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── JSON 파싱 ───
function tryFixJson(raw: string): string {
  let s = raw.trim();
  // markdown code block 제거
  const jsonStart = s.indexOf('{');
  const arrayStart = s.indexOf('[');
  const start = jsonStart >= 0 && arrayStart >= 0
    ? Math.min(jsonStart, arrayStart)
    : jsonStart >= 0 ? jsonStart : arrayStart;
  if (start > 0) s = s.slice(start);
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  s = s.replace(/,(\s*[}\]])/g, '$1');
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  return s;
}

// ─── 타입 ───
interface Entity { name: string; category: string; description: string; aliases: string[]; scenes: number[] }
interface Relationship { from: string; to: string; type: string; description: string; scenes: number[] }
interface Scene { id: number; chapter: number; location: string; time?: string; summary: string; time_marker?: string | null }
interface Chapter { id: number; title: string }
interface ChunkData { chapters: Chapter[]; scenes: Scene[]; entities: Entity[]; relationships: Relationship[] }
interface KnownEntity { name: string; description: string; category: string; aliases: string[] }

// ─── 청크 분할 ───
function splitIntoChunks(text: string, maxSize: number): string[] {
  const parts = text.split(/(?=^#\s|\n#\s)/gm).filter(p => p.trim());
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    if (current.length + part.length > maxSize && current) {
      chunks.push(current.trim());
      current = part;
    } else {
      current += part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

// ─── 추출 ───
async function extractChunk(chunkText: string, chunkNum: number, knownEntities: KnownEntity[], userPrompt: string): Promise<ChunkData> {
  let previousText = '';
  if (knownEntities.length > 0) {
    const byCategory: Record<string, KnownEntity[]> = {};
    for (const e of knownEntities) {
      if (!byCategory[e.category]) byCategory[e.category] = [];
      byCategory[e.category].push(e);
    }
    const catNames: Record<string, string> = { character: '등장인물', location: '장소', item: '아이템/물건', concept: '개념/세계관' };
    previousText = `## 이전 청크에서 발견된 엔티티들 (동일한 것이면 같은 이름 사용!)\n⚠️ 중요: 아래 목록에 있는 엔티티가 이번 청크에 다시 등장하면 반드시 같은 이름을 사용하세요!\n\n`;
    for (const [cat, entities] of Object.entries(byCategory)) {
      previousText += `### ${catNames[cat] || cat} (${cat})\n`;
      for (const e of entities.slice(-15)) {
        const alias = e.aliases?.length ? ` (별칭: ${e.aliases.slice(0, 3).join(', ')})` : '';
        previousText += `- ${e.name}${alias}: ${(e.description || '').slice(0, 50)}\n`;
      }
      previousText += '\n';
    }
  }

  const prompt = userPrompt
    .replace('{{chunkNum}}', String(chunkNum))
    .replace('{{text}}', chunkText)
    .replace('{{previousCharacters}}', previousText);

  console.log(`    LLM 호출 (${prompt.length}자)...`);
  const raw = await callLLM(prompt);
  try {
    return JSON.parse(tryFixJson(raw));
  } catch {
    console.error(`    JSON 파싱 실패`);
    return { chapters: [], scenes: [], entities: [], relationships: [] };
  }
}

// ─── 병합 ───
function mergeExtractions(extractions: ChunkData[]) {
  const entities: Entity[] = [];
  const relationships: Relationship[] = [];
  const scenes: Scene[] = [];
  const chapters: Chapter[] = [];
  const nameMap: Record<string, number> = {};
  let sceneOffset = 0;

  for (const ext of extractions) {
    for (const ch of (ext.chapters || [])) {
      if (!chapters.find(c => c.title === ch.title)) chapters.push(ch);
    }
    const localToGlobal: Record<number, number> = {};
    for (const s of (ext.scenes || [])) {
      const gid = sceneOffset + s.id;
      localToGlobal[s.id] = gid;
      scenes.push({ ...s, id: gid });
    }
    sceneOffset += (ext.scenes || []).length || 1;

    for (const e of (ext.entities || [])) {
      const norm = e.name.trim().toLowerCase();
      const gs = (e.scenes || []).map(s => localToGlobal[s] || s);
      if (nameMap[norm] !== undefined) {
        const ex = entities[nameMap[norm]];
        if (e.description && !ex.description?.includes(e.description)) ex.description = (ex.description + ' ' + e.description).trim();
        ex.scenes = [...new Set([...ex.scenes, ...gs])];
        ex.aliases = [...new Set([...(ex.aliases || []), ...(e.aliases || [])])];
      } else {
        nameMap[norm] = entities.length;
        entities.push({ ...e, scenes: gs });
        for (const a of (e.aliases || [])) nameMap[a.trim().toLowerCase()] = entities.length - 1;
      }
    }

    for (const r of (ext.relationships || [])) {
      const gs = (r.scenes || []).map(s => localToGlobal[s] || s);
      const key = `${r.from}-${r.type}-${r.to}`.toLowerCase();
      const ex = relationships.find(er => `${er.from}-${er.type}-${er.to}`.toLowerCase() === key);
      if (ex) { ex.scenes = [...new Set([...ex.scenes, ...gs])]; }
      else { relationships.push({ ...r, scenes: gs }); }
    }
  }
  return { entities, relationships, scenes, chapters };
}

// ─── LLM 병합 검토 ───
async function reviewMerges(entities: Entity[], mergePrompt: string) {
  if (entities.length <= 3) return [];
  const list = entities.map((e, i) => {
    const a = e.aliases?.length ? ` (별칭: ${e.aliases.join(', ')})` : '';
    return `${i + 1}. ${e.name} [${e.category}]${a}: ${(e.description || '').slice(0, 80)}`;
  }).join('\n');
  console.log('  LLM 병합 검토...');
  const raw = await callLLM(mergePrompt.replace('{{entityList}}', list));
  try { const s = JSON.parse(tryFixJson(raw)); return Array.isArray(s) ? s : []; }
  catch { return []; }
}

// ─── 테스트 실행 ───
async function runTest(testFile: string, prompts: ReturnType<typeof loadPrompts>, resultsDir: string) {
  const fileName = path.basename(testFile, '.txt');
  console.log(`\n${'='.repeat(50)}`);
  console.log(`테스트: ${fileName}`);
  console.log('='.repeat(50));

  const text = fs.readFileSync(testFile, 'utf-8');
  const chunks = splitIntoChunks(text, CHUNK_SIZE);
  console.log(`  ${text.length}자, ${chunks.length}청크`);

  const allExtracted: ChunkData[] = [];
  const known: KnownEntity[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`  [${i + 1}/${chunks.length}] 추출...`);
    const ext = await extractChunk(chunks[i], i + 1, known, prompts.USER_PROMPT);
    allExtracted.push(ext);
    for (const e of (ext.entities || [])) {
      const ex = known.find(k => k.name === e.name);
      if (ex) { if (e.description) ex.description = (ex.description + ' ' + e.description).slice(0, 200); }
      else { known.push({ name: e.name, description: (e.description || '').slice(0, 100), category: e.category || 'character', aliases: e.aliases || [] }); }
    }
    console.log(`    → 엔티티 ${(ext.entities || []).length}, 관계 ${(ext.relationships || []).length}`);
  }

  console.log('  병합...');
  const merged = mergeExtractions(allExtracted);

  const mergeSuggestions = await reviewMerges(merged.entities, prompts.ENTITY_MERGE_REVIEW_PROMPT);
  if (mergeSuggestions.length > 0) {
    console.log(`  병합 제안 ${mergeSuggestions.length}건:`);
    for (const s of mergeSuggestions) {
      console.log(`    "${s.keep}" ← "${s.merge}"`);
      const ki = merged.entities.findIndex(e => e.name === s.keep);
      const mi = merged.entities.findIndex(e => e.name === s.merge);
      if (ki >= 0 && mi >= 0 && merged.entities[ki].category === merged.entities[mi].category) {
        const k = merged.entities[ki], m = merged.entities[mi];
        k.aliases = [...new Set([...(k.aliases || []), m.name, ...(m.aliases || [])])];
        k.scenes = [...new Set([...k.scenes, ...m.scenes])];
        if (m.description && !k.description.includes(m.description)) k.description = (k.description + ' ' + m.description).trim();
        for (const r of merged.relationships) { if (r.from === s.merge) r.from = s.keep; if (r.to === s.merge) r.to = s.keep; }
        merged.entities.splice(mi, 1);
      }
    }
    merged.relationships = merged.relationships.filter(r => r.from !== r.to);
  }

  const result = {
    _test: { file: fileName, timestamp: new Date().toISOString(), model: MODEL, chunks: chunks.length },
    chapters: merged.chapters, scenes: merged.scenes, entities: merged.entities, relationships: merged.relationships,
    mergeSuggestions,
    summary: {
      entityCount: merged.entities.length,
      characterCount: merged.entities.filter(e => e.category === 'character').length,
      locationCount: merged.entities.filter(e => e.category === 'location').length,
      itemCount: merged.entities.filter(e => e.category === 'item').length,
      conceptCount: merged.entities.filter(e => e.category === 'concept').length,
      relationshipCount: merged.relationships.length,
      sceneCount: merged.scenes.length,
      chapterCount: merged.chapters.length,
    },
  };

  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${fileName}.json`), JSON.stringify(result, null, 2), 'utf-8');

  const chars = merged.entities.filter(e => e.category === 'character').map(e => e.name).join(', ');
  console.log(`  결과: 엔티티 ${result.summary.entityCount} (인물 ${result.summary.characterCount}), 관계 ${result.summary.relationshipCount}`);
  console.log(`  인물: ${chars}`);
  return result;
}

// ─── CLI ───
async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.log('사용법: npx tsx ../test/run-test.ts [번호|all] [--outdir 폴더]'); process.exit(1); }
  if (!API_KEY) { console.error('❌ OPENROUTER_API_KEY 없음'); process.exit(1); }

  // --outdir 파싱
  const outIdx = args.indexOf('--outdir');
  const outDir = outIdx >= 0 ? path.join(TEST_DIR, args[outIdx + 1]) : path.join(TEST_DIR, 'results');
  const fileArgs = args.filter((_, i) => i !== outIdx && i !== outIdx + 1);

  const prompts = loadPrompts();
  if (!prompts.USER_PROMPT) { console.error('❌ prompts.ts 로드 실패'); process.exit(1); }
  console.log('프롬프트 로드 완료, 출력: ' + path.basename(outDir));

  let testFiles: string[] = [];
  if (fileArgs.includes('all')) {
    testFiles = fs.readdirSync(TEST_DIR).filter(f => f.endsWith('.txt')).sort().map(f => path.join(TEST_DIR, f));
  } else {
    for (const a of fileArgs) {
      const p = a.padStart(2, '0');
      const f = fs.readdirSync(TEST_DIR).filter(f => f.startsWith(p) && f.endsWith('.txt'));
      if (f.length) testFiles.push(path.join(TEST_DIR, f[0]));
      else console.error(`❌ ${p}* 없음`);
    }
  }

  console.log(`\n${testFiles.length}개 테스트`);
  const results: Record<string, unknown> = {};
  for (const file of testFiles) {
    try { results[path.basename(file, '.txt')] = await runTest(file, prompts, outDir); }
    catch (err) { console.error(`❌ ${path.basename(file)} 실패:`, err); results[path.basename(file, '.txt')] = { error: String(err) }; }
  }

  console.log(`\n${'='.repeat(50)}\n전체 결과\n${'='.repeat(50)}`);
  for (const [n, r] of Object.entries(results)) {
    const s = (r as { summary?: { entityCount: number; characterCount: number; relationshipCount: number } }).summary;
    console.log(s ? `  ${n}: 엔티티 ${s.entityCount} (인물 ${s.characterCount}), 관계 ${s.relationshipCount}` : `  ${n}: ❌`);
  }
}

main().catch(err => { console.error('오류:', err); process.exit(1); });
