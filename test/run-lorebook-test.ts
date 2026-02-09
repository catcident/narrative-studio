/**
 * 로어북 추출 파이프라인 테스트 스크립트
 *
 * LLM A (관계/엔티티) + LLM B (로어북) 병렬 추출 → merger 병합 → 결과 분석
 *
 * 사용법:
 *   cd web && npx tsx ../test/run-lorebook-test.ts [파일번호] [--outdir lore-results]
 *
 * 예시:
 *   npx tsx ../test/run-lorebook-test.ts 13        # 동물_의인화 테스트
 *   npx tsx ../test/run-lorebook-test.ts 02        # 시점변경_1인칭 테스트
 *   npx tsx ../test/run-lorebook-test.ts all       # 전체
 *
 * OpenRouter API 키를 web/.env.local에서 읽습니다.
 */

import fs from 'fs';
import path from 'path';
import { mergeExtractions, mergeLoreEntries } from '../web/src/services/extraction/merger';
import type { ChunkExtractedData, RawLoreEntry, MergedExtraction } from '../web/src/services/extraction/types';

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
  const lorebookMatch = content.match(/export const LOREBOOK_EXTRACTION_PROMPT = `([\s\S]*?)`;/);
  const mergeMatch = content.match(/export const ENTITY_MERGE_REVIEW_PROMPT = `([\s\S]*?)`;/);
  return {
    USER_PROMPT: userMatch?.[1] || '',
    LOREBOOK_EXTRACTION_PROMPT: lorebookMatch?.[1] || '',
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
      max_tokens: 16000,
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
interface KnownEntity { name: string; description: string; category: string; aliases: string[] }
interface MergeSuggestion { keep: string; merge: string; reason: string }

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

// ─── LLM A 추출 ───
async function extractChunkA(chunkText: string, chunkNum: number, knownEntities: KnownEntity[], userPrompt: string): Promise<ChunkExtractedData> {
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

  const raw = await callLLM(prompt);
  try {
    return JSON.parse(tryFixJson(raw));
  } catch {
    console.error(`    LLM A JSON 파싱 실패`);
    return { chapters: [], scenes: [], entities: [], relationships: [] };
  }
}

// ─── LLM B 추출 (로어북) ───
async function extractChunkB(chunkText: string, chunkNum: number, knownEntities: KnownEntity[], lorebookPrompt: string): Promise<{ scenes: Array<{id: number; summary: string}>; lore_entries: RawLoreEntry[] }> {
  let previousText = '';
  if (knownEntities.length > 0) {
    previousText = `## 이전 청크에서 발견된 인물들 (같은 이름 사용!)\n`;
    for (const e of knownEntities.filter(e => e.category === 'character' || e.category === 'creature')) {
      const alias = e.aliases?.length ? ` (별칭: ${e.aliases.slice(0, 3).join(', ')})` : '';
      previousText += `- ${e.name}${alias}\n`;
    }
  }

  const prompt = lorebookPrompt
    .replace('{{chunkNum}}', String(chunkNum))
    .replace('{{text}}', chunkText)
    .replace('{{previousEntities}}', previousText);

  const raw = await callLLM(prompt);
  try {
    const parsed = JSON.parse(tryFixJson(raw));
    return {
      scenes: parsed.scenes || [],
      lore_entries: parsed.lore_entries || [],
    };
  } catch {
    console.error(`    LLM B JSON 파싱 실패`);
    return { scenes: [], lore_entries: [] };
  }
}

// ─── LLM 병합 검토 ───
async function reviewMerges(merged: MergedExtraction, mergePrompt: string): Promise<MergeSuggestion[]> {
  const { entities } = merged;
  if (entities.length <= 3) return [];

  const list = entities.map((e, i) => {
    const a = e.aliases?.length ? ` (별칭: ${e.aliases.join(', ')})` : '';
    return `${i + 1}. ${e.name} [${e.category}]${a}: ${(e.description || '').slice(0, 80)}`;
  }).join('\n');

  const raw = await callLLM(mergePrompt.replace('{{entityList}}', list));
  try {
    const s = JSON.parse(tryFixJson(raw));
    return Array.isArray(s) ? s : [];
  } catch {
    return [];
  }
}

// ─── 병합 제안 적용 ───
function applyMergeSuggestions(merged: MergedExtraction, suggestions: MergeSuggestion[]): { merged: MergedExtraction; entityNameMapping: Record<string, string> } {
  const entityNameMapping: Record<string, string> = {};
  if (suggestions.length === 0) return { merged, entityNameMapping };

  const newEntities = [...merged.entities];
  const newRelationships = [...merged.relationships];

  for (const suggestion of suggestions) {
    const keepIdx = newEntities.findIndex(e => e.name === suggestion.keep);
    let mergeIdx = newEntities.findIndex(e => e.name === suggestion.merge);
    if (mergeIdx === keepIdx) {
      mergeIdx = newEntities.findIndex((e, idx) => idx !== keepIdx && e.name === suggestion.merge);
    }
    if (keepIdx === -1 || mergeIdx === -1) continue;

    const keepEntity = newEntities[keepIdx];
    const mergeEntity = newEntities[mergeIdx];
    if (keepEntity.category !== mergeEntity.category) continue;

    entityNameMapping[mergeEntity.name] = keepEntity.name;
    keepEntity.aliases = [...new Set([...(keepEntity.aliases || []), mergeEntity.name, ...(mergeEntity.aliases || [])])];
    if (mergeEntity.description) {
      keepEntity.description = (keepEntity.description + ' ' + mergeEntity.description).trim();
    }
    keepEntity.scenes = [...new Set([...(keepEntity.scenes || []), ...(mergeEntity.scenes || [])])];
    for (const rel of newRelationships) {
      if (rel.from === suggestion.merge) rel.from = suggestion.keep;
      if (rel.to === suggestion.merge) rel.to = suggestion.keep;
    }
    newEntities.splice(mergeIdx, 1);
  }

  // aliases → entityNameMapping
  for (const entity of newEntities) {
    for (const alias of (entity.aliases || [])) {
      if (alias !== entity.name) entityNameMapping[alias] = entity.name;
    }
  }

  return {
    merged: { ...merged, entities: newEntities, relationships: newRelationships.filter(r => r.from !== r.to) },
    entityNameMapping,
  };
}

// ─── 대명사 매핑 (orchestrator와 동일 로직) ───
function buildNarratorMapping(entities: MergedExtraction['entities'], entityNameMapping: Record<string, string>): void {
  const NARRATOR_PRONOUNS = ['나', '저', '우리', '화자', '주인공'];
  const characterEntities = entities.filter(e => e.category === 'character' || e.category === 'creature');

  for (const pronoun of NARRATOR_PRONOUNS) {
    if (entityNameMapping[pronoun]) continue;
    const narrator = characterEntities.find(e =>
      e.aliases?.some(a => a === pronoun || a.toLowerCase() === pronoun)
    );
    if (narrator) {
      entityNameMapping[pronoun] = narrator.name;
      console.log(`  [대명사 매핑] "${pronoun}" → "${narrator.name}"`);
    }
  }
  // 캐릭터 1명이면 모든 대명사 매핑
  if (!NARRATOR_PRONOUNS.some(p => entityNameMapping[p]) && characterEntities.length === 1) {
    for (const pronoun of NARRATOR_PRONOUNS) {
      entityNameMapping[pronoun] = characterEntities[0].name;
    }
    console.log(`  [대명사 매핑 (단일)] 모든 대명사 → "${characterEntities[0].name}"`);
  }
}

// ─── 테스트 실행 ───
async function runTest(testFile: string, prompts: ReturnType<typeof loadPrompts>, resultsDir: string) {
  const fileName = path.basename(testFile, '.txt');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`로어북 테스트: ${fileName}`);
  console.log('='.repeat(60));

  const text = fs.readFileSync(testFile, 'utf-8');
  const chunks = splitIntoChunks(text, CHUNK_SIZE);
  console.log(`  ${text.length}자, ${chunks.length}청크`);

  const allExtractedA: ChunkExtractedData[] = [];
  const allExtractedLore: RawLoreEntry[][] = [];
  const known: KnownEntity[] = [];

  // 청크별 LLM A + B 병렬 실행
  for (let i = 0; i < chunks.length; i++) {
    console.log(`  [${i + 1}/${chunks.length}] LLM A+B 병렬 호출...`);

    const [resultA, resultB] = await Promise.all([
      extractChunkA(chunks[i], i + 1, known, prompts.USER_PROMPT),
      extractChunkB(chunks[i], i + 1, known, prompts.LOREBOOK_EXTRACTION_PROMPT),
    ]);

    allExtractedA.push(resultA);
    allExtractedLore.push(resultB.lore_entries);

    // knownEntities 축적
    for (const e of (resultA.entities || [])) {
      const ex = known.find(k => k.name === e.name);
      if (ex) { if (e.description) ex.description = (ex.description + ' ' + e.description).slice(0, 200); }
      else { known.push({ name: e.name, description: (e.description || '').slice(0, 100), category: e.category || 'character', aliases: e.aliases || [] }); }
    }

    console.log(`    LLM A: 엔티티 ${(resultA.entities || []).length}, 관계 ${(resultA.relationships || []).length}, 장면 ${(resultA.scenes || []).length}`);
    console.log(`    LLM B: 로어 ${resultB.lore_entries.length}개, 장면 ${resultB.scenes.length}개`);
  }

  // 병합 (LLM A)
  console.log('  LLM A 병합...');
  let merged = mergeExtractions(allExtractedA);

  // LLM 병합 검토
  const mergeSuggestions = await reviewMerges(merged, prompts.ENTITY_MERGE_REVIEW_PROMPT);
  let entityNameMapping: Record<string, string> = {};
  if (mergeSuggestions.length > 0) {
    console.log(`  병합 제안 ${mergeSuggestions.length}건`);
    const result = applyMergeSuggestions(merged, mergeSuggestions);
    merged = result.merged;
    entityNameMapping = result.entityNameMapping;
  } else {
    // 기본 alias 매핑
    for (const entity of merged.entities) {
      for (const alias of (entity.aliases || [])) {
        if (alias !== entity.name) entityNameMapping[alias] = entity.name;
      }
    }
  }

  // 대명사 매핑 (orchestrator 로직)
  buildNarratorMapping(merged.entities, entityNameMapping);

  // 장면 ID 매핑 구축 (orchestrator 로직)
  const chunkSceneMappings: Array<Record<number, string>> = [];
  const chunkSceneOffsets = merged.chunkSceneOffsets || [];
  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const localToGlobal = chunkSceneOffsets[chunkIdx] || {};
    const mapping: Record<number, string> = {};
    for (const [local, global] of Object.entries(localToGlobal)) {
      mapping[Number(local)] = `S${String(global).padStart(4, '0')}`;
    }
    chunkSceneMappings.push(mapping);
  }

  // LLM B 로어 병합
  console.log('  로어북 병합...');
  const knownEntityNames = merged.entities.map(e => e.name);
  const loreEntries = mergeLoreEntries(
    allExtractedLore,
    new Array(chunks.length).fill(0),  // 단일 파일
    chunkSceneMappings,
    entityNameMapping,
    [fileName],
    ['F0001'],
    knownEntityNames,
  );

  // ─── 포괄적 결과 분석 + 점수 ───
  console.log(`\n${'─'.repeat(40)}`);
  console.log('결과 분석');
  console.log('─'.repeat(40));

  // 엔티티별 로어 엔트리 수
  const byEntity: Record<string, RawLoreEntry[]> = {};
  const byCat: Record<string, number> = {};
  for (const entry of loreEntries) {
    if (!byEntity[entry.entityName]) byEntity[entry.entityName] = [];
    byEntity[entry.entityName].push(entry as unknown as RawLoreEntry);
    byCat[entry.category] = (byCat[entry.category] || 0) + 1;
  }

  console.log(`\n  총 로어 엔트리: ${loreEntries.length}개`);
  console.log(`  엔티티별:`);
  for (const [name, ents] of Object.entries(byEntity).sort((a, b) => b[1].length - a[1].length)) {
    const cats = new Set(ents.map(e => e.category));
    console.log(`    ${name}: ${ents.length}개 (${[...cats].join(', ')})`);
  }
  console.log(`  카테고리별:`);
  for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count}개`);
  }

  // ─── 점수 평가 (100점 만점) ───
  const scores: { name: string; score: number; max: number; detail: string }[] = [];
  const characterEntities = merged.entities.filter(e => e.category === 'character' || e.category === 'creature');
  const nonCharEntities = merged.entities.filter(e => e.category !== 'character' && e.category !== 'creature');

  // 1. 주인공 커버리지 (20점) — 모든 캐릭터 엔티티에 로어가 있는지
  const charsWithLore = characterEntities.filter(c => byEntity[c.name]);
  const charCoverage = characterEntities.length > 0 ? charsWithLore.length / characterEntities.length : 1;
  const charCoverageScore = Math.round(charCoverage * 20);
  const missingChars = characterEntities.filter(c => !byEntity[c.name]).map(c => c.name);
  scores.push({
    name: '주인공/인물 커버리지',
    score: charCoverageScore, max: 20,
    detail: missingChars.length > 0
      ? `${charsWithLore.length}/${characterEntities.length} 커버 (누락: ${missingChars.join(', ')})`
      : `${charsWithLore.length}/${characterEntities.length} 전원 커버`,
  });

  // 2. 카테고리 다양성 (15점) — 인물 로어에 최소 3가지 카테고리가 있는지
  const charCategories = ['appearance', 'personality', 'background', 'ability', 'motivation', 'outfit', 'relationship_detail'];
  const charCategoriesUsed = new Set(loreEntries.filter(e => charCategories.includes(e.category)).map(e => e.category));
  const catDiversityRaw = Math.min(charCategoriesUsed.size / 3, 1);
  const catDiversityScore = Math.round(catDiversityRaw * 15);
  scores.push({
    name: '카테고리 다양성',
    score: catDiversityScore, max: 15,
    detail: `${charCategoriesUsed.size}종 사용 (${[...charCategoriesUsed].join(', ')})`,
  });

  // 3. 중복 없음 (15점)
  let dupCount = 0;
  for (const [, ents] of Object.entries(byEntity)) {
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        if (ents[i].category === ents[j].category) {
          const wordsI = new Set((ents[i].content.match(/[가-힣]{2,}/g) || []).map(w => w.toLowerCase()));
          const wordsJ = new Set((ents[j].content.match(/[가-힣]{2,}/g) || []).map(w => w.toLowerCase()));
          if (wordsI.size > 0 && wordsJ.size > 0) {
            let overlap = 0;
            for (const w of wordsI) { if (wordsJ.has(w)) overlap++; }
            if (overlap / Math.min(wordsI.size, wordsJ.size) >= 0.7) {
              dupCount++;
              console.log(`  ⚠ 유사 중복: [${ents[i].entity_name}/${ents[i].category}]`);
              console.log(`    A: "${ents[i].content.slice(0, 60)}"`);
              console.log(`    B: "${ents[j].content.slice(0, 60)}"`);
            }
          }
        }
      }
    }
  }
  const dupScore = dupCount === 0 ? 15 : Math.max(0, 15 - dupCount * 3);
  scores.push({ name: '중복 없음', score: dupScore, max: 15, detail: dupCount === 0 ? '✓ 중복 0건' : `⚠ ${dupCount}건 중복` });

  // 4. 장면 매핑 (10점)
  const orphanScenes = loreEntries.filter(e => !e.sceneId || e.sceneId === 'S0000');
  const sceneMappingRatio = loreEntries.length > 0 ? (loreEntries.length - orphanScenes.length) / loreEntries.length : 1;
  const sceneScore = Math.round(sceneMappingRatio * 10);
  scores.push({ name: '장면 매핑', score: sceneScore, max: 10, detail: orphanScenes.length > 0 ? `⚠ ${orphanScenes.length}개 미매핑` : '✓ 전체 매핑 성공' });

  // 5. 세계관/설정 lore (10점) — 장소/아이템/세계관 lore가 있는지
  const loreCat = byCat['lore'] || 0;
  const hasWorldBuilding = nonCharEntities.length > 0;  // 텍스트에 장소/아이템이 있는지
  let worldScore: number;
  if (!hasWorldBuilding) {
    worldScore = loreCat > 0 ? 10 : 7;  // 세계관 없는 텍스트면 감점 안 함
  } else {
    worldScore = loreCat >= 3 ? 10 : loreCat >= 1 ? 7 : 3;
  }
  scores.push({ name: '세계관/lore', score: worldScore, max: 10, detail: `lore ${loreCat}개, 비인물 엔티티 ${nonCharEntities.length}개` });

  // 6. 대명사 resolve (10점)
  const pronounEntries = loreEntries.filter(e => {
    const PRONOUNS = ['나', '저', '화자', '주인공', '그', '그녀'];
    // "나"가 실제 LLM A 엔티티 이름이면 대명사 미처리가 아님
    if (PRONOUNS.includes(e.entityName)) {
      const isActualEntity = characterEntities.some(c => c.name === e.entityName);
      return !isActualEntity;
    }
    return false;
  });
  const pronounScore = pronounEntries.length === 0 ? 10 : Math.max(0, 10 - pronounEntries.length * 3);
  scores.push({ name: '대명사 resolve', score: pronounScore, max: 10, detail: pronounEntries.length === 0 ? '✓ 전체 resolve' : `⚠ ${pronounEntries.length}개 미처리` });

  // 7. 엔트리-엔티티 연결성 (10점) — 로어 엔트리의 entityName이 LLM A 엔티티에 있는지
  const allEntityNames = new Set(merged.entities.map(e => e.name));
  const connectedEntries = loreEntries.filter(e => allEntityNames.has(e.entityName));
  const connectionRatio = loreEntries.length > 0 ? connectedEntries.length / loreEntries.length : 1;
  const connectionScore = Math.round(connectionRatio * 10);
  const disconnected = loreEntries.filter(e => !allEntityNames.has(e.entityName));
  const disconnectedNames = [...new Set(disconnected.map(e => e.entityName))];
  scores.push({
    name: '엔트리-엔티티 연결',
    score: connectionScore, max: 10,
    detail: disconnectedNames.length > 0
      ? `${connectedEntries.length}/${loreEntries.length} 연결 (미연결: ${disconnectedNames.join(', ')})`
      : `${connectedEntries.length}/${loreEntries.length} 전체 연결`,
  });

  // 8. 볼륨 (10점) — 엔트리 수가 적절한지 (너무 적으면 감점)
  const expectedMin = Math.max(characterEntities.length * 2, 5);
  const volumeRatio = Math.min(loreEntries.length / expectedMin, 1);
  const volumeScore = Math.round(volumeRatio * 10);
  scores.push({ name: '충분한 추출량', score: volumeScore, max: 10, detail: `${loreEntries.length}개 (최소 ${expectedMin}개 기대)` });

  // 총점
  const totalScore = scores.reduce((a, b) => a + b.score, 0);
  const totalMax = scores.reduce((a, b) => a + b.max, 0);

  console.log(`\n  ${'─'.repeat(40)}`);
  console.log(`  📊 점수 평가 (${totalScore}/${totalMax})`);
  console.log(`  ${'─'.repeat(40)}`);
  for (const s of scores) {
    const bar = s.score === s.max ? '✓' : s.score >= s.max * 0.7 ? '△' : '✗';
    console.log(`  ${bar} ${s.name}: ${s.score}/${s.max} — ${s.detail}`);
  }
  const grade = totalScore >= 90 ? 'A+' : totalScore >= 85 ? 'A' : totalScore >= 80 ? 'B+' : totalScore >= 70 ? 'B' : totalScore >= 60 ? 'C' : 'D';
  console.log(`\n  🏆 최종 등급: ${grade} (${totalScore}점)`);

  // 결과 저장
  const result = {
    _test: { file: fileName, timestamp: new Date().toISOString(), model: MODEL, chunks: chunks.length },
    llmA: {
      entities: merged.entities.map(e => ({ name: e.name, category: e.category, aliases: e.aliases, scenes: e.scenes })),
      relationships: merged.relationships.length,
      scenes: merged.scenes.length,
      mergeSuggestions,
    },
    llmB: {
      rawLoreCount: allExtractedLore.reduce((a, b) => a + b.length, 0),
      mergedLoreCount: loreEntries.length,
      deduped: allExtractedLore.reduce((a, b) => a + b.length, 0) - loreEntries.length,
    },
    entityNameMapping,
    loreEntries: loreEntries.map(e => ({
      entityName: e.entityName,
      category: e.category,
      content: e.content,
      quote: e.quote || null,
      sceneId: e.sceneId,
    })),
    scoring: {
      total: totalScore,
      max: totalMax,
      grade,
      items: scores.map(s => ({ name: s.name, score: s.score, max: s.max, detail: s.detail })),
    },
    summary: {
      entityCount: merged.entities.length,
      characterCount: characterEntities.length,
      loreEntryCount: loreEntries.length,
      byEntity: Object.fromEntries(Object.entries(byEntity).map(([k, v]) => [k, v.length])),
      byCategory: byCat,
      duplicateCount: dupCount,
      pronounUnresolved: pronounEntries.length,
    },
  };

  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${fileName}.json`), JSON.stringify(result, null, 2), 'utf-8');

  console.log(`\n  결과 저장: ${path.relative(TEST_DIR, path.join(resultsDir, `${fileName}.json`))}`);
  return result;
}

// ─── CLI ───
async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log('사용법: npx tsx ../test/run-lorebook-test.ts [번호|all] [--outdir 폴더]');
    console.log('예시:');
    console.log('  npx tsx ../test/run-lorebook-test.ts 13      # 동물_의인화');
    console.log('  npx tsx ../test/run-lorebook-test.ts 02      # 시점변경_1인칭');
    console.log('  npx tsx ../test/run-lorebook-test.ts all');
    process.exit(1);
  }
  if (!API_KEY) { console.error('❌ OPENROUTER_API_KEY 없음'); process.exit(1); }

  const outIdx = args.indexOf('--outdir');
  const outDir = outIdx >= 0 ? path.join(TEST_DIR, args[outIdx + 1]) : path.join(TEST_DIR, 'lore-results');
  const fileArgs = args.filter((_, i) => i !== outIdx && i !== outIdx + 1);

  const prompts = loadPrompts();
  if (!prompts.USER_PROMPT) { console.error('❌ USER_PROMPT 로드 실패'); process.exit(1); }
  if (!prompts.LOREBOOK_EXTRACTION_PROMPT) { console.error('❌ LOREBOOK_EXTRACTION_PROMPT 로드 실패'); process.exit(1); }
  console.log('프롬프트 로드 완료, 출력: ' + path.basename(outDir));

  let testFiles: string[] = [];
  if (fileArgs.includes('all')) {
    testFiles = fs.readdirSync(TEST_DIR).filter(f => f.endsWith('.txt')).sort().map(f => path.join(TEST_DIR, f));
  } else if (fileArgs.includes('data')) {
    // data/ 폴더의 실제 소설 데이터 (.md) 사용
    const dataDir = path.resolve(TEST_DIR, '../data');
    const mdFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.md') && !f.includes('test')).sort();
    // 모든 md 파일을 하나로 합쳐서 테스트
    const combined = mdFiles.map(f => fs.readFileSync(path.join(dataDir, f), 'utf-8')).join('\n\n');
    const tmpFile = path.join(TEST_DIR, '_DATA_실제소설.txt');
    fs.writeFileSync(tmpFile, combined, 'utf-8');
    testFiles.push(tmpFile);
    console.log(`  실제 데이터 결합: ${mdFiles.join(', ')} → ${combined.length}자`);
  } else {
    for (const a of fileArgs) {
      // 직접 파일 경로도 지원
      if (fs.existsSync(a)) {
        testFiles.push(path.resolve(a));
        continue;
      }
      const p = a.padStart(2, '0');
      const f = fs.readdirSync(TEST_DIR).filter(f => f.startsWith(p) && f.endsWith('.txt'));
      if (f.length) testFiles.push(path.join(TEST_DIR, f[0]));
      else console.error(`❌ ${p}* 없음`);
    }
  }

  console.log(`\n${testFiles.length}개 테스트`);
  const results: Record<string, { summary: Record<string, unknown> } | { error: string }> = {};
  for (const file of testFiles) {
    try {
      results[path.basename(file, '.txt')] = await runTest(file, prompts, outDir);
    } catch (err) {
      console.error(`❌ ${path.basename(file)} 실패:`, err);
      results[path.basename(file, '.txt')] = { error: String(err) };
    }
  }

  // 전체 요약 + 점수
  console.log(`\n${'='.repeat(60)}\n전체 결과\n${'='.repeat(60)}`);
  let totalAll = 0, countAll = 0;
  for (const [n, r] of Object.entries(results)) {
    if ('error' in r) { console.log(`  ${n}: ❌ ${r.error}`); continue; }
    const sc = (r as Record<string, unknown>).scoring as { total: number; grade: string } | undefined;
    const grade = sc ? `${sc.grade} (${sc.total}점)` : '?';
    const s = r.summary as Record<string, unknown>;
    console.log(`  ${n}: ${grade} | 엔티티 ${s.entityCount}, 로어 ${s.loreEntryCount}개, 중복 ${s.duplicateCount}`);
    if (sc) { totalAll += sc.total; countAll++; }
  }
  if (countAll > 0) {
    const avg = Math.round(totalAll / countAll);
    const avgGrade = avg >= 90 ? 'A+' : avg >= 85 ? 'A' : avg >= 80 ? 'B+' : avg >= 70 ? 'B' : avg >= 60 ? 'C' : 'D';
    console.log(`\n  📊 전체 평균: ${avgGrade} (${avg}점/${countAll}개 테스트)`);
  }
}

main().catch(err => { console.error('오류:', err); process.exit(1); });
