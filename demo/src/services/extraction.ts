/**
 * 온톨로지 추출 서비스 (개선된 버전)
 * 더 세부적인 정보 추출 + 시점별 관계
 */

import type { NovelOntology } from '../types';

const API_KEY = import.meta.env.OPENROUTER_API_KEY || '';
const MODEL = 'google/gemini-2.0-flash-lite-001';

const SYSTEM_PROMPT = `당신은 소설 세계관 분석 전문가입니다. 텍스트에서 인물, 장소, 물건, 세계관, 배경 정보를 빠짐없이 추출하여 "설정집"을 만듭니다.

규칙:
1. 텍스트에 명시된 정보만 추출 (추측 금지)
2. 인물의 모든 특성을 기록 (성별, 나이, 직업, 성격, 외모, 말투 등)
3. 인물 간 관계를 구체적으로 분석 (감정, 갈등, 신뢰 등)
4. 1인칭 화자("나")도 인물로 취급
5. 장소/건물/지역은 반드시 location 카테고리로 추출
   예: 학교, 집, 카페, 거리, 공원, 사무실, 병원 등
6. 물건/아이템은 반드시 item 카테고리로 추출하고, 소유자/사용자 관계 필수
   예: "화자가 피우는 담배" → "나"와 "담배" 사이에 "소유" 관계
7. 세계관/시대배경/사회적 맥락은 concept 카테고리로 추출
8. JSON만 출력 (설명 없이)`;

const USER_PROMPT = `소설 "{{title}}" 청크 {{chunkNum}} 분석하여 설정집을 만드세요.

{{text}}

---
{{previousCharacters}}

## 핵심: 장(chapter)과 장면(scene) 단위로 분석

### ⚠️ 장(chapter) 추출 - 매우 중요!
텍스트에서 "제1장", "제2장", "제1편", "제2편" 같은 **명시적 장 구분**을 찾아서 chapters 배열에 추가하세요.

**춘향전 예시:**
텍스트에 "제1장 춘향의 탄생", "제2장 이몽룡과의 만남" 등이 있으면:
"chapters": [{"id": 1, "title": "제1장 춘향의 탄생"}, {"id": 2, "title": "제2장 이몽룡과의 만남"}]

**규칙:**
- 텍스트를 스캔하여 "제N장", "제N편", "N장" 패턴을 모두 찾으세요
- 각 장의 제목 전체를 title에 기록하세요
- 장 구분이 없는 텍스트만 chapters를 빈 배열로 두세요

### 장면(scene) 추출 규칙
- 시간/장소가 바뀌면 새 장면
- 각 장면에 순서 번호 부여 (이 청크 내에서 1, 2, 3...)
- **장면이 어느 장에 속하는지 chapter 필드에 반드시 기록** (예: chapter: 1, chapter: 2)
- 모든 엔티티와 관계에 어떤 장면에서 등장했는지 기록

## JSON 형식
{
  "chapters": [
    {"id": 1, "title": "제1장 춘향의 탄생", "summary": "요약(선택)"}
  ],
  "scenes": [
    {"id": 1, "chapter": 1, "time": "시간표현(있으면)", "location": "장소명", "summary": "요약"}
  ],
  "entities": [
    {
      "name": "이름",
      "category": "character/location/item/event/concept/organization",
      "description": "설명 (소유자/위치 정보 포함)",
      "scenes": [1, 2],
      "attributes": {"gender": "", "age": "", "occupation": "", "owner": "소유자명(있으면)"},
      "aliases": ["별칭1"],
      "importance": 5
    }
  ],
  "relationships": [
    {
      "from": "A",
      "to": "B",
      "type": "관계타입",
      "description": "관계 설명",
      "sentiment": "positive/negative/neutral",
      "strength": 5,
      "scenes": [1]
    }
  ]
}

## 엔티티 카테고리 (필수 구분)
- **character**: 인물 (이름 있는 사람, 화자 "나" 포함)
- **location**: 장소/건물/지역 (학교, 집, 카페, 거리, 공원, 사무실, 병원, 방, 골목 등)
- **item**: 물건/도구 (담배, 책, 휴대폰, 자동차, 음식, 옷 등)
- **organization**: 조직/단체 (회사, 학교 기관, 동아리, 가게 등)
- **event**: 사건/행사 (축제, 사고, 모임 등)
- **concept**: 추상적 개념/세계관 설정 (시대, 규칙, 전통, 감정 등)

## 관계 타입 (한글로 작성)
- 가족: 부모, 자녀, 형제, 친척 등
- 연인: 연애, 짝사랑, 전 연인 등
- 친구: 친한 친구, 아는 사람 등
- 적대: 적, 라이벌, 갈등 관계 등
- 동료: 직장동료, 학교친구, 팀원 등
- 소속: 인물이 조직/장소에 소속됨 (예: 학생-학교)
- 위치: 인물/물건이 장소에 있음
- 소유: 인물이 물건을 가지고 있음/사용함
- 포함: 장소가 다른 장소를 포함 (예: 학교-교실)
- 관련: 기타 연관 관계

## ⚠️ 중요: 관계의 from/to는 반드시 entities의 name과 정확히 일치해야 함
- relationships의 from, to 값은 entities에 등록된 name과 **동일한 문자열**이어야 함
- 예: entities에 "춘향"으로 등록했으면, relationships에서도 "춘향" 사용 ("춘향이" X)
- 예: entities에 "이도령"으로 등록했으면, relationships에서도 "이도령" 사용 ("이몽룡" X)
- 같은 인물의 다른 이름은 aliases에 등록하고, 관계에서는 대표 name만 사용

## ⚠️ 필수 추출 규칙

### 1. 장소는 반드시 추출
- 장면에 등장하는 모든 장소를 location으로 추출
- 예: "학교 앞 카페에서" → "학교"(location), "카페"(location) 둘 다 추출
- 장소 간 포함 관계도 추출 (학교 안에 교실이 있으면 "포함" 관계)

### 2. 물건-인물 관계 필수
- 물건의 description에 소유자가 언급되면 반드시 관계 추출
- "화자가 피우는 담배" → entities에 담배 추가 + relationships에 "나"-"담배" 소유관계 추가
- "그녀의 가방" → entities에 가방 추가 + relationships에 "그녀"-"가방" 소유관계 추가
- attributes의 owner 필드에 소유자 이름도 기록

### 3. 인물-장소 관계 필수
- 인물이 어떤 장소에 있으면/방문하면 "위치" 관계 추출
- "그는 학교에 갔다" → "그"-"학교" 위치 관계

### 4. 조직/기관 추출
- 학교, 회사, 동아리, 가게 등은 organization으로 추출
- 인물과의 소속 관계도 추출

### 5. 중요도(importance) 평가 (1~10)
각 엔티티의 스토리 중요도를 1~10으로 평가:
- **10**: 주인공, 핵심 인물
- **8-9**: 주요 조연, 중요 장소 (집, 학교 등 반복 등장)
- **6-7**: 일반 조연, 주요 아이템 (스토리에 영향을 주는 물건)
- **4-5**: 배경 인물, 일반 장소
- **1-3**: 단순 언급, 일회성 소품 (커피, 담배 등 디테일용)`;

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

  // 후처리: 누락된 관계 자동 생성
  onProgress?.('관계 검증 및 보완 중...');
  const validated = inferMissingRelationships(merged);

  return buildOntology(validated, title);
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
  const chapters: any[] = [];
  const chapterMap: Record<string, number> = {}; // 장 제목 -> id 매핑
  const nameMap: Record<string, number> = {}; // 이름 -> entities 인덱스

  let globalSceneOffset = 0;

  for (let chunkIdx = 0; chunkIdx < extractions.length; chunkIdx++) {
    const ext = extractions[chunkIdx];

    // 장(chapter) 병합 (중복 제거)
    for (const chapter of (ext.chapters || [])) {
      const key = chapter.title || `제${chapter.id}장`;
      if (!chapterMap[key]) {
        const newId = chapters.length + 1;
        chapterMap[key] = newId;
        chapters.push({
          ...chapter,
          id: newId,
        });
      }
    }

    // 장면 병합 (글로벌 번호 부여)
    const localToGlobal: Record<number, number> = {};
    for (const scene of (ext.scenes || [])) {
      const globalId = globalSceneOffset + scene.id;
      localToGlobal[scene.id] = globalId;

      // 장면의 chapter를 글로벌 chapter id로 변환
      let globalChapter = scene.chapter;
      if (scene.chapter && ext.chapters) {
        const chapterInfo = ext.chapters.find((c: any) => c.id === scene.chapter);
        if (chapterInfo) {
          const key = chapterInfo.title || `제${chapterInfo.id}장`;
          globalChapter = chapterMap[key] || scene.chapter;
        }
      }

      scenes.push({
        ...scene,
        id: globalId,
        chapter: globalChapter,
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

  return { entities, relationships, scenes, chapters };
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

/**
 * 후처리: 엔티티 설명에서 누락된 관계 자동 생성
 * "화자가 피우는 담배" 같은 설명에서 소유 관계를 추출
 */
function inferMissingRelationships(extracted: any): any {
  const { entities, relationships } = extracted;
  const newRelationships: any[] = [];

  // 소유자/사용자 패턴
  const ownerPatterns = [
    /^(.+?)(?:가|이|의)\s*(?:피우는|먹는|마시는|쓰는|타는|가진|입는|쓰던|읽는|보는|사용하는|운전하는|타고\s*다니는|가지고\s*있는)/,
    /^(.+?)(?:가|이)\s*(?:사는|있는|거주하는|다니는|일하는|근무하는)\s*/,
    /^(.+?)의\s+/,  // "~의 물건" 패턴
  ];

  for (const entity of entities) {
    if (entity.category === 'character') continue; // 인물은 스킵

    const desc = entity.description || '';
    const attrOwner = entity.attributes?.owner;

    // attributes.owner가 있으면 관계 생성
    if (attrOwner) {
      const ownerName = normalizeOwnerName(attrOwner);
      if (!hasRelationship(relationships, ownerName, entity.name) &&
          !hasRelationship(newRelationships, ownerName, entity.name)) {
        newRelationships.push({
          from: ownerName,
          to: entity.name,
          type: '소유',
          description: `${ownerName}의 ${entity.name}`,
          sentiment: 'neutral',
          strength: 5,
          scenes: entity.scenes || []
        });
      }
    }

    // 설명에서 소유자 패턴 찾기
    for (const pattern of ownerPatterns) {
      const match = desc.match(pattern);
      if (match) {
        let ownerName = match[1].trim();
        ownerName = normalizeOwnerName(ownerName);

        // 이미 관계가 있는지 확인
        if (!hasRelationship(relationships, ownerName, entity.name) &&
            !hasRelationship(newRelationships, ownerName, entity.name)) {
          newRelationships.push({
            from: ownerName,
            to: entity.name,
            type: '소유',
            description: desc,
            sentiment: 'neutral',
            strength: 5,
            scenes: entity.scenes || []
          });
        }
        break; // 첫 번째 매칭만 사용
      }
    }
  }

  console.log(`후처리: ${newRelationships.length}개의 누락된 관계 추가됨`);

  return {
    ...extracted,
    relationships: [...relationships, ...newRelationships]
  };
}

// 소유자 이름 정규화
function normalizeOwnerName(name: string): string {
  const firstPersonAliases = ['화자', '주인공', '나는', '내'];
  if (firstPersonAliases.includes(name.toLowerCase())) {
    return '나';
  }
  return name;
}

// 관계 존재 여부 확인
function hasRelationship(relationships: any[], from: string, to: string): boolean {
  const normFrom = from.toLowerCase();
  const normTo = to.toLowerCase();
  return relationships.some(r =>
    (r.from?.toLowerCase() === normFrom && r.to?.toLowerCase() === normTo) ||
    (r.from?.toLowerCase() === normTo && r.to?.toLowerCase() === normFrom)
  );
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
      importance: e.importance || 5,  // 기본 중요도 5
    };
    nameToId[e.name] = id;
    // 소문자로도 매핑
    nameToId[e.name.toLowerCase()] = id;
    // 정규화된 이름으로도 매핑
    nameToId[normalizeName(e.name)] = id;
    (e.aliases || []).forEach((alias: string) => {
      nameToId[alias] = id;
      nameToId[alias.toLowerCase()] = id;
      nameToId[normalizeName(alias)] = id;
    });
  });

  // 유연한 이름 매칭 함수
  const findEntityId = (name: string): string | undefined => {
    if (!name) return undefined;

    // 1. 정확한 매칭
    if (nameToId[name]) return nameToId[name];
    if (nameToId[name.toLowerCase()]) return nameToId[name.toLowerCase()];

    // 2. 정규화된 이름으로 매칭
    const normalized = normalizeName(name);
    if (nameToId[normalized]) return nameToId[normalized];

    // 3. 부분 매칭 (이름이 포함되거나 포함하는 경우)
    const nameLower = name.toLowerCase();
    for (const [entityName, id] of Object.entries(nameToId)) {
      const entityNameLower = entityName.toLowerCase();
      // "춘향" ↔ "춘향이", "이도령" ↔ "이몽룡 이도령"
      if (entityNameLower.includes(nameLower) || nameLower.includes(entityNameLower)) {
        return id;
      }
    }

    // 4. 2글자 이상 공통 부분 매칭
    if (name.length >= 2) {
      for (const [entityName, id] of Object.entries(nameToId)) {
        // 한글 이름에서 겹치는 부분이 2글자 이상이면 매칭
        const overlap = findOverlap(name, entityName);
        if (overlap.length >= 2) {
          return id;
        }
      }
    }

    return undefined;
  };

  // 두 문자열의 최대 겹치는 부분 찾기
  const findOverlap = (a: string, b: string): string => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    let maxOverlap = '';

    for (let i = 0; i < aLower.length; i++) {
      for (let j = i + 1; j <= aLower.length; j++) {
        const sub = aLower.slice(i, j);
        if (bLower.includes(sub) && sub.length > maxOverlap.length) {
          maxOverlap = sub;
        }
      }
    }
    return maxOverlap;
  };

  // 관계 등록
  (extracted.relationships || []).forEach((r: any, i: number) => {
    // 유연한 이름 매칭
    const fromId = findEntityId(r.from);
    const toId = findEntityId(r.to);
    if (!fromId || !toId) {
      console.log('관계 매핑 실패:', r.from, '->', r.to, '(엔티티를 찾을 수 없음)');
      return;
    }

    // 같은 엔티티 간의 관계는 무시
    if (fromId === toId) {
      console.log('자기참조 관계 무시:', r.from, '->', r.to);
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

  // 장(Chapter) 정보 처리
  const chapters: Record<string, any> = {};
  (extracted.chapters || []).forEach((c: any) => {
    const chapterId = `C${String(c.id).padStart(4, '0')}`;
    chapters[chapterId] = {
      id: chapterId,
      number: c.id,
      title: c.title || `제${c.id}장`,
      summary: c.summary || '',
    };
  });

  // 장면(Scene)을 snapshots로
  const snapshots: Record<string, any> = {};
  (extracted.scenes || []).forEach((s: any) => {
    const sceneId = `S${String(s.id).padStart(4, '0')}`;
    const chapterId = s.chapter ? `C${String(s.chapter).padStart(4, '0')}` : null;

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
      chapter: chapterId,
      chapterNumber: s.chapter || null,
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
    chapters,
    timeline,
    snapshots,
    stats: {
      totalEntities: Object.keys(entities).length,
      totalEdges: Object.keys(hyperedges).length,
      totalChapters: Object.keys(chapters).length,
      entitiesByCategory: entitiesByCategory as any,
      edgesByType: edgesByType as any,
    },
  };
}
