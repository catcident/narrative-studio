/**
 * 온톨로지 추출 서비스 (개선된 버전)
 * 더 세부적인 정보 추출 + 시점별 관계
 */

import type { NovelOntology } from '../types';

const API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || '';
const MODEL = 'google/gemini-2.0-flash-lite-001';

const SYSTEM_PROMPT = `당신은 소설 분석 전문가입니다. 텍스트에서 인물, 장소, 관계를 빠짐없이 추출합니다.

규칙:
1. 텍스트에 명시된 정보만 추출 (추측 금지)
2. 인물의 모든 특성을 기록 (성별, 나이, 직업, 성격, 외모, 말투 등)
3. 인물 간 관계를 구체적으로 분석 (감정, 갈등, 신뢰 등)
4. 1인칭 화자("나")도 인물로 취급
5. JSON만 출력 (설명 없이)`;

const USER_PROMPT = `소설 "{{title}}" 청크 {{chunkNum}} 분석.

{{text}}

---
{{previousCharacters}}

## 핵심: 장면(scene) 단위로 분석
- 시간/장소가 바뀌면 새 장면
- 각 장면에 순서 번호 부여 (이 청크 내에서 1, 2, 3...)
- 모든 엔티티와 관계에 어떤 장면에서 등장했는지 기록

## JSON 형식
{
  "scenes": [
    {"id": 1, "time": "시간표현(있으면)", "location": "장소", "summary": "요약"}
  ],
  "entities": [
    {
      "name": "이름",
      "category": "character/location/item/event/concept",
      "description": "설명",
      "scenes": [1, 2],
      "attributes": {"gender": "", "age": "", "occupation": ""}
    }
  ],
  "relationships": [
    {
      "from": "A",
      "to": "B",
      "type": "가족/연인/친구/적대/동료/주인/위치/소유/관련",
      "description": "관계 설명",
      "sentiment": "positive/negative/neutral",
      "strength": 5,
      "scenes": [1]
    }
  ]
}

## 관계 타입 (한글로 작성)
- 가족: 부모, 자녀, 형제, 친척 등
- 연인: 연애, 짝사랑, 전 연인 등
- 친구: 친한 친구, 아는 사람 등
- 적대: 적, 라이벌, 갈등 관계 등
- 동료: 직장동료, 학교친구, 팀원 등
- 주인: 반려동물, 소유물의 주인
- 위치: 어딘가에 있음 (인물-장소)
- 소유: 무언가를 가지고 있음 (인물-물건)
- 관련: 기타 연관 관계

- 인물뿐 아니라 장소, 물건, 개념도 엔티티로
- 인물과 장소/물건 사이 관계도 추출`;

export async function extractOntology(
  text: string,
  title: string,
  onProgress?: (msg: string) => void
): Promise<NovelOntology> {
  // 텍스트를 청크로 분할 (5000자씩)
  const CHUNK_SIZE = 5000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  const totalChunks = chunks.length;
  console.log(`텍스트를 ${totalChunks}개 청크로 분할`);
  onProgress?.(`텍스트를 ${totalChunks}개 부분으로 분할...`);

  // 각 청크에서 추출 (이전 인물 정보를 다음 청크에 전달)
  const allExtracted: any[] = [];
  let knownCharacters: { name: string; description: string; aliases?: string[] }[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const msg = `AI 분석 중... (${i + 1}/${totalChunks})`;
    console.log(msg);
    onProgress?.(msg);

    const extracted = await extractFromChunk(chunks[i], title, i + 1, knownCharacters);
    if (extracted) {
      allExtracted.push(extracted);

      // 이 청크에서 발견된 인물들을 다음 청크를 위해 저장
      for (const entity of (extracted.entities || [])) {
        if (entity.category === 'character') {
          const existing = knownCharacters.find(c =>
            c.name === entity.name ||
            c.aliases?.includes(entity.name) ||
            entity.aliases?.includes(c.name)
          );
          if (existing) {
            // 설명 업데이트
            if (entity.description && !existing.description.includes(entity.description)) {
              existing.description = (existing.description + ' ' + entity.description).slice(0, 200);
            }
            // 별칭 병합
            if (entity.aliases) {
              existing.aliases = [...new Set([...(existing.aliases || []), ...entity.aliases])];
            }
          } else {
            knownCharacters.push({
              name: entity.name,
              description: (entity.description || '').slice(0, 100),
              aliases: entity.aliases || []
            });
          }
        }
      }
    }
  }

  onProgress?.('인물 정보 병합 중...');

  // 결과 병합
  const merged = mergeExtractions(allExtracted);
  return buildOntology(merged, title);
}

async function extractFromChunk(
  chunkText: string,
  title: string,
  chunkNum: number,
  knownCharacters: { name: string; description: string; aliases?: string[] }[] = []
): Promise<any> {
  // 이전에 발견된 인물 정보를 프롬프트에 추가
  let previousCharactersText = '';
  if (knownCharacters.length > 0) {
    previousCharactersText = `## 이전 청크에서 발견된 인물들 (동일 인물이면 같은 이름 사용)
${knownCharacters.map(c => {
  const aliasText = c.aliases?.length ? ` (별칭: ${c.aliases.join(', ')})` : '';
  return `- ${c.name}${aliasText}: ${c.description}`;
}).join('\n')}
`;
  }

  const prompt = USER_PROMPT
    .replace('{{title}}', title)
    .replace('{{chunkNum}}', String(chunkNum))
    .replace('{{text}}', chunkText)
    .replace('{{previousCharacters}}', previousCharactersText);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('API 응답 에러:', err);
    throw new Error(`API 오류: ${response.status} - ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  console.log('API 응답 데이터:', data);

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    console.error('응답 구조:', JSON.stringify(data, null, 2));
    throw new Error('LLM 응답이 비어있습니다. API 키를 확인해주세요.');
  }

  console.log('LLM 응답 내용:', content.slice(0, 500));

  let extracted;
  try {
    // 마크다운 코드블록 제거
    let jsonContent = content.trim();
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.slice(7);
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.slice(3);
    }
    if (jsonContent.endsWith('```')) {
      jsonContent = jsonContent.slice(0, -3);
    }
    jsonContent = jsonContent.trim();

    extracted = JSON.parse(jsonContent);
  } catch (parseErr) {
    console.error('JSON 파싱 에러, 원본:', content);
    // JSON이 잘린 경우 복구 시도
    const fixedContent = tryFixJson(content);
    if (fixedContent) {
      extracted = fixedContent;
    } else {
      throw new Error('LLM 응답 JSON 파싱 실패. 콘솔에서 원본 확인하세요.');
    }
  }

  return extracted;
}

// 여러 청크 결과를 병합 (같은 인물 판단 + 장면 번호 글로벌화)
function mergeExtractions(extractions: any[]): any {
  const entities: any[] = [];
  const relationships: any[] = [];
  const scenes: any[] = [];
  const nameMap: Record<string, number> = {}; // 이름 -> entities 인덱스

  let globalSceneOffset = 0;

  for (let chunkIdx = 0; chunkIdx < extractions.length; chunkIdx++) {
    const ext = extractions[chunkIdx];

    // 장면 병합 (글로벌 번호 부여)
    const localToGlobal: Record<number, number> = {};
    for (const scene of (ext.scenes || [])) {
      const globalId = globalSceneOffset + scene.id;
      localToGlobal[scene.id] = globalId;
      scenes.push({
        ...scene,
        id: globalId,
        chunkNum: chunkIdx + 1
      });
    }
    globalSceneOffset += (ext.scenes || []).length || 1;

    // 엔티티 병합
    for (const entity of (ext.entities || [])) {
      const normalizedName = normalizeName(entity.name);
      const existingIdx = findSimilarEntity(normalizedName, nameMap, entities);

      // 장면 번호를 글로벌로 변환
      const globalScenes = (entity.scenes || []).map((s: number) => localToGlobal[s] || s);

      if (existingIdx !== -1) {
        // 기존 엔티티에 정보 추가
        const existing = entities[existingIdx];
        if (entity.description && !existing.description?.includes(entity.description)) {
          existing.description = (existing.description || '') + ' ' + entity.description;
        }
        // 장면 병합
        existing.scenes = [...new Set([...(existing.scenes || []), ...globalScenes])];
        // 속성 병합
        if (entity.attributes) {
          existing.attributes = { ...(existing.attributes || {}), ...entity.attributes };
        }
        // aliases 병합
        if (entity.aliases) {
          existing.aliases = [...new Set([...(existing.aliases || []), ...entity.aliases])];
        }
      } else {
        // 새 엔티티
        const idx = entities.length;
        entities.push({
          ...entity,
          scenes: globalScenes,
          aliases: entity.aliases || []
        });
        nameMap[normalizedName] = idx;
        for (const alias of (entity.aliases || [])) {
          nameMap[normalizeName(alias)] = idx;
        }
      }
    }

    // 관계 병합 (중복 시 장면만 추가)
    for (const rel of (ext.relationships || [])) {
      const globalScenes = (rel.scenes || []).map((s: number) => localToGlobal[s] || s);
      const key = `${normalizeName(rel.from)}-${rel.type}-${normalizeName(rel.to)}`;
      const existingRel = relationships.find(r =>
        `${normalizeName(r.from)}-${r.type}-${normalizeName(r.to)}` === key
      );

      if (existingRel) {
        // 장면만 추가
        existingRel.scenes = [...new Set([...(existingRel.scenes || []), ...globalScenes])];
      } else {
        relationships.push({ ...rel, scenes: globalScenes });
      }
    }
  }

  return { entities, relationships, scenes };
}

// 이름 정규화 (공백, 호칭 제거)
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(씨|님|군|양|선생|사장|부장|과장|대리|사원)$/g, '');
}

// 비슷한 엔티티 찾기
function findSimilarEntity(name: string, nameMap: Record<string, number>, _entities: any[]): number {
  // 정확히 일치
  if (nameMap[name] !== undefined) {
    return nameMap[name];
  }

  // "나", "나는", "주인공" 같은 1인칭 표현 통합
  const firstPersonNames = ['나', '나는', '주인공', '화자'];
  if (firstPersonNames.includes(name)) {
    for (const fpName of firstPersonNames) {
      if (nameMap[fpName] !== undefined) {
        return nameMap[fpName];
      }
    }
  }

  // 부분 일치 (2글자 이상)
  if (name.length >= 2) {
    for (const [existingName, idx] of Object.entries(nameMap)) {
      if (existingName.includes(name) || name.includes(existingName)) {
        return idx;
      }
    }
  }

  return -1;
}

// 잘린 JSON 복구 시도
function tryFixJson(content: string): any {
  // 마크다운 코드블록 제거
  let fixed = content.trim();
  if (fixed.startsWith('```json')) {
    fixed = fixed.slice(7);
  } else if (fixed.startsWith('```')) {
    fixed = fixed.slice(3);
  }
  if (fixed.endsWith('```')) {
    fixed = fixed.slice(0, -3);
  }
  fixed = fixed.trim();

  // { 로 시작하는 JSON 찾기
  const jsonStart = fixed.indexOf('{');
  if (jsonStart > 0) {
    fixed = fixed.slice(jsonStart);
  }

  // 열린 괄호 수 세기
  let braceCount = 0;
  let bracketCount = 0;

  for (const char of fixed) {
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    if (char === '[') bracketCount++;
    if (char === ']') bracketCount--;
  }

  // 닫는 괄호 추가
  while (bracketCount > 0) {
    fixed += ']';
    bracketCount--;
  }
  while (braceCount > 0) {
    fixed += '}';
    braceCount--;
  }

  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

function buildOntology(extracted: any, title: string): NovelOntology {
  const now = new Date().toISOString();
  const entities: Record<string, any> = {};
  const hyperedges: Record<string, any> = {};
  const nameToId: Record<string, string> = {};

  // 엔티티 등록
  (extracted.entities || []).forEach((e: any, i: number) => {
    const id = `E${String(i + 1).padStart(4, '0')}`;
    // scenes를 숫자에서 문자열 ID로 변환
    const sceneIds = (e.scenes || []).map((s: number) => `S${String(s).padStart(4, '0')}`);
    entities[id] = {
      id,
      name: e.name,
      category: e.category || 'character',
      aliases: e.aliases || [],
      description: e.description || '',
      attributes: e.attributes || {},
      scenes: sceneIds,  // 등장 장면 ID들 (문자열)
      firstMention: { chapter: 1 },
    };
    nameToId[e.name] = id;
    // 소문자로도 매핑
    nameToId[e.name.toLowerCase()] = id;
    (e.aliases || []).forEach((alias: string) => {
      nameToId[alias] = id;
      nameToId[alias.toLowerCase()] = id;
    });
  });

  // 관계 등록
  (extracted.relationships || []).forEach((r: any, i: number) => {
    // 대소문자 무시하고 찾기
    const fromId = nameToId[r.from] || nameToId[r.from?.toLowerCase()];
    const toId = nameToId[r.to] || nameToId[r.to?.toLowerCase()];
    if (!fromId || !toId) {
      console.log('관계 매핑 실패:', r.from, '->', r.to);
      return;
    }

    const id = `H${String(i + 1).padStart(4, '0')}`;
    // scenes를 숫자에서 문자열 ID로 변환
    const sceneIds = (r.scenes || []).map((s: number) => `S${String(s).padStart(4, '0')}`);
    hyperedges[id] = {
      id,
      type: r.type,
      subtype: r.subtype,
      entities: [fromId, toId],
      statement: r.description,
      timeline: {
        start: r.start_time,
        chapter: 1,
      },
      sentiment: r.sentiment,
      strength: r.strength,
      bidirectional: r.bidirectional,
      fromPerspective: r.from_perspective,
      toPerspective: r.to_perspective,
      scenes: sceneIds,  // 등장 장면 ID들 (문자열)
      sourceRef: { chapter: 1 },
    };
  });

  // 타임라인 등록
  const timeline = (extracted.timeline || []).map((t: any) => ({
    id: t.time_id,
    name: t.events?.[0] || t.time_expression,
    description: (t.events || []).join(', '),
    storyTime: t.time_expression,
    order: t.order,
    chapter: 1,
    entities: (t.characters || []).map((name: string) => nameToId[name]).filter(Boolean),
    edges: [],
  })).sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

  // 장면(Scene)을 snapshots로
  const snapshots: Record<string, any> = {};
  (extracted.scenes || []).forEach((s: any) => {
    const sceneId = `S${String(s.id).padStart(4, '0')}`;

    // 이 장면에 등장하는 엔티티들 (scenes 배열에 sceneId가 포함된 것)
    const entitiesInScene = Object.values(entities)
      .filter((e: any) => e.scenes?.includes(sceneId))
      .map((e: any) => e.id);

    // 이 장면에 해당하는 관계들
    const activeEdges = Object.values(hyperedges)
      .filter((e: any) => e.scenes?.includes(sceneId))
      .map((e: any) => e.id);

    snapshots[sceneId] = {
      sceneId,
      order: s.id,
      time: s.time || `장면 ${s.id}`,
      location: s.location,
      summary: s.summary,
      events: s.events || [],
      mood: s.mood,
      charactersPresent: entitiesInScene,
      activeEdges,
    };
  });

  // 통계
  const entitiesByCategory: Record<string, number> = {};
  const edgesByType: Record<string, number> = {};

  Object.values(entities).forEach((e: any) => {
    entitiesByCategory[e.category] = (entitiesByCategory[e.category] || 0) + 1;
  });

  Object.values(hyperedges).forEach((e: any) => {
    edgesByType[e.type] = (edgesByType[e.type] || 0) + 1;
  });

  return {
    metadata: {
      title,
      createdAt: now,
      updatedAt: now,
      version: '1.0.0',
    },
    entities,
    hyperedges,
    timeline,
    snapshots,
    stats: {
      totalEntities: Object.keys(entities).length,
      totalEdges: Object.keys(hyperedges).length,
      entitiesByCategory: entitiesByCategory as any,
      edgesByType: edgesByType as any,
    },
  };
}
