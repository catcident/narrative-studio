/**
 * 지식 그래프 추출 서비스 — 결과 병합 및 후처리
 */

import type {
  NovelKnowledgeGraph, Entity, HyperEdge,
  EntityCategory, RelationType, Chapter, SceneSnapshot, SourceFile,
  LoreEntry, Lorebook, LoreCategory,
} from '../../types';
import type {
  ChunkExtractedData, MergedExtraction, MergedEntity, MergedRelationship,
  MergedScene, MergedChapter, MergedTimelinePoint, ChunkBilling,
  RawLoreEntry,
} from './types';
import { getApiKey, stripMarkdownCodeBlock, fetchWithClientTimeout } from './types';
import { ENTITY_MERGE_REVIEW_PROMPT } from './prompts';

// --- ID 포맷 헬퍼 ---

function formatId(prefix: string, num: number): string {
  return `${prefix}${String(num).padStart(4, '0')}`;
}

// --- 이름 정규화 ---

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(씨|님|군|양|선생|사장|부장|과장|대리|사원)$/g, '');
}

// description 병합: 문장 단위로 중복 제거하여 합치기
function mergeDescriptions(existing: string, incoming: string): string {
  if (!existing) return incoming;
  if (!incoming) return existing;

  // 기존 description에 신규 전체가 포함되어 있으면 추가 불필요
  if (existing.includes(incoming)) return existing;

  // 문장 단위로 분리 (마침표/느낌표/물음표/공백 구분)
  const existingSentences = existing.split(/(?<=[.!?。])\s*/).map(s => s.trim()).filter(Boolean);
  const incomingSentences = incoming.split(/(?<=[.!?。])\s*/).map(s => s.trim()).filter(Boolean);

  // 새 문장 중 기존에 없는 것만 추가
  const newSentences = incomingSentences.filter(sentence => {
    // 정확히 같은 문장이 있으면 스킵
    if (existingSentences.some(es => es === sentence)) return false;
    // 기존 텍스트에 해당 문장이 부분문자열로 포함되어 있으면 스킵
    if (existing.includes(sentence)) return false;
    return true;
  });

  if (newSentences.length === 0) return existing;
  return (existing + ' ' + newSentences.join(' ')).trim();
}

// 대명사/지시어 등 매핑에 사용하면 안 되는 이름 (여러 엔티티에서 공유될 수 있음)
const AMBIGUOUS_NAMES = new Set([
  // 1인칭
  '나', '나는', '내가', '저', '제가', '우리',
  // 3인칭
  '그', '그녀', '그들', '그 남자', '그 여자', '그 사람', '그 아이',
  '이 남자', '이 여자', '이 사람', '이 아이',
  '저 남자', '저 여자', '저 사람', '저 아이',
  // 기타
  '화자', '주인공',
]);

function isAmbiguousName(name: string): boolean {
  return AMBIGUOUS_NAMES.has(name.trim());
}

// 이름 → ID 매핑에 정확/소문자/정규화 3가지 키를 등록
function registerNameMapping(nameToId: Record<string, string>, name: string, id: string): void {
  if (isAmbiguousName(name)) return;
  nameToId[name] = id;
  nameToId[name.toLowerCase()] = id;
  nameToId[normalizeName(name)] = id;
}

// nameToId 맵에서 유연한 이름 매칭으로 엔티티 ID를 찾기
function findEntityId(name: string, nameToId: Record<string, string>): string | undefined {
  if (!name) return undefined;

  // 1. 정확한 매칭
  if (nameToId[name]) return nameToId[name];
  if (nameToId[name.toLowerCase()]) return nameToId[name.toLowerCase()];

  // 2. 정규화된 이름으로 매칭
  const normalized = normalizeName(name);
  if (nameToId[normalized]) return nameToId[normalized];

  // 3. 부분 매칭: 짧은 쪽 3글자 이상 AND 비율 80% 이상
  // (성 생략, 경칭 차이 등만 매칭 — "고양이" vs "검은 고양이" 같은 수식어 차이는 매칭 안 함)
  if (name.length >= 3) {
    const nameLower = name.toLowerCase().replace(/\s+/g, '');
    for (const [entityName, id] of Object.entries(nameToId)) {
      if (entityName.length < 3) continue;
      const entityLower = entityName.toLowerCase().replace(/\s+/g, '');
      const shorter = Math.min(nameLower.length, entityLower.length);
      const longer = Math.max(nameLower.length, entityLower.length);
      if (shorter / longer < 0.8) continue;
      if (entityLower.includes(nameLower) || nameLower.includes(entityLower)) {
        return id;
      }
    }
  }

  return undefined;
}

// --- 비슷한 엔티티 찾기 (mergeExtractions 전용) ---

function findSimilarEntity(name: string, nameMap: Record<string, number>): number {
  // "나" 같은 모호한 이름은 정확 매칭만 수행 (퍼지/부분 매칭 스킵)
  // 단일 화자 소설에서 모든 "나"를 하나로 병합하면서,
  // 다른 이름의 엔티티와 잘못 매칭되는 것을 방지
  if (isAmbiguousName(name)) {
    if (nameMap[name] !== undefined) {
      return nameMap[name];
    }
    return -1;
  }

  // 정확히 일치
  if (nameMap[name] !== undefined) {
    return nameMap[name];
  }

  // 소문자 매칭
  const nameLower = name.toLowerCase();
  for (const [existingName, idx] of Object.entries(nameMap)) {
    if (existingName.toLowerCase() === nameLower) {
      return idx;
    }
  }

  // 정규화 매칭 (공백/경칭 제거)
  const nameNorm = normalizeName(name);
  for (const [existingName, idx] of Object.entries(nameMap)) {
    if (normalizeName(existingName) === nameNorm) {
      return idx;
    }
  }

  // 부분 매칭: 짧은 쪽 3글자 이상 AND 비율 80% 이상일 때만
  // (성 생략, 경칭 차이 등만 매칭 — "고양이" vs "검은 고양이" 같은 수식어 차이는 매칭 안 함)
  if (name.length >= 3) {
    for (const [existingName, idx] of Object.entries(nameMap)) {
      if (existingName.length < 3) continue;
      const shorter = Math.min(name.length, existingName.length);
      const longer = Math.max(name.length, existingName.length);
      if (shorter / longer < 0.8) continue;

      const nameLow = name.toLowerCase().replace(/\s+/g, '');
      const existLow = existingName.toLowerCase().replace(/\s+/g, '');
      if (existLow.includes(nameLow) || nameLow.includes(existLow)) {
        return idx;
      }
    }
  }

  return -1;
}

// --- 청크 결과 병합 ---

export function mergeExtractions(extractions: ChunkExtractedData[], chunkSourceFileIndices: number[] = []): MergedExtraction {
  const entities: MergedEntity[] = [];
  const relationships: MergedRelationship[] = [];
  const scenes: MergedScene[] = [];
  const chapters: MergedChapter[] = [];
  const chapterMap: Record<string, number> = {};
  const nameMap: Record<string, number> = {};
  // 청크별 로컬→글로벌 장면 매핑 (로어북 병합용)
  const chunkSceneOffsets: Array<Record<number, number>> = [];

  let globalSceneOffset = 0;

  console.log(`[extraction] 총 ${extractions.length}개 청크 결과 병합 시작`);

  for (let chunkIdx = 0; chunkIdx < extractions.length; chunkIdx++) {
    const ext = extractions[chunkIdx];
    const sourceFileIndex = chunkSourceFileIndices[chunkIdx] ?? 0;
    console.log(`[extraction] 청크 ${chunkIdx + 1}: entities=${(ext.entities || []).length}, relationships=${(ext.relationships || []).length}, scenes=${(ext.scenes || []).length}, 파일=${sourceFileIndex}`);

    // 장(chapter) 병합 (중복 제거)
    for (const chapter of (ext.chapters || [])) {
      const key = chapter.title || `제${chapter.id}장`;
      if (!chapterMap[key]) {
        const newId = chapters.length + 1;
        chapterMap[key] = newId;
        chapters.push({ ...chapter, id: newId });
      }
    }

    // 장면 병합 (글로벌 번호 부여)
    const localToGlobal: Record<number, number> = {};
    const chunkScenes = ext.scenes || [];

    for (let sceneIdx = 0; sceneIdx < chunkScenes.length; sceneIdx++) {
      const scene = chunkScenes[sceneIdx];
      const globalId = globalSceneOffset + sceneIdx + 1;
      localToGlobal[scene.id] = globalId;

      // 장면의 chapter를 실제 번호로 변환
      let actualChapterNumber = scene.chapter;
      if (scene.chapter && ext.chapters) {
        const chapterInfo = ext.chapters.find((c) => c.id === scene.chapter);
        if (chapterInfo?.title) {
          const numMatch = chapterInfo.title.match(/(\d+)/);
          if (numMatch) {
            actualChapterNumber = parseInt(numMatch[1], 10);
          }
        }
      }

      scenes.push({
        ...scene,
        id: globalId,
        chapter: actualChapterNumber,
        chunkNum: chunkIdx + 1,
        sourceFileIndex,
      });
    }
    chunkSceneOffsets.push(localToGlobal);
    globalSceneOffset += chunkScenes.length || 1;

    // 엔티티 병합
    for (const entity of (ext.entities || [])) {
      const normalizedName = normalizeName(entity.name);
      const existingIdx = findSimilarEntity(normalizedName, nameMap);
      const globalScenes = (entity.scenes || []).map((s: number) => localToGlobal[s] || s);

      if (existingIdx !== -1) {
        const existing = entities[existingIdx];
        if (entity.description) {
          existing.description = mergeDescriptions(existing.description || '', entity.description);
        }
        existing.scenes = [...new Set([...(existing.scenes || []), ...globalScenes])];
        if (entity.attributes) {
          existing.attributes = { ...(existing.attributes || {}), ...entity.attributes };
        }
        if (entity.aliases) {
          existing.aliases = [...new Set([...(existing.aliases || []), ...entity.aliases])];
        }
      } else {
        const idx = entities.length;
        entities.push({
          name: entity.name,
          category: entity.category || 'character',
          description: entity.description || '',
          aliases: entity.aliases || [],
          scenes: globalScenes,
          attributes: entity.attributes,
          importance: entity.importance,
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
        existingRel.scenes = [...new Set([...(existingRel.scenes || []), ...globalScenes])];
      } else {
        relationships.push({ ...rel, scenes: globalScenes });
      }
    }
  }

  console.log(`[extraction] 병합 완료: 최종 entities=${entities.length}, relationships=${relationships.length}, scenes=${scenes.length}, chapters=${chapters.length}`);
  console.log(`[extraction] 인물 목록: ${entities.filter(e => e.category === 'character').map(e => e.name).join(', ')}`);
  return { entities, relationships, scenes, chapters, chunkSceneOffsets };
}

// --- LLM 병합 검토 ---

interface MergeSuggestion {
  keep: string;
  merge: string;
  reason: string;
}

/**
 * LLM을 사용하여 엔티티 병합 후보를 검토
 * 같은 대상인데 다른 이름으로 추출된 것을 찾아 병합 제안
 */
export async function reviewEntityMerges(
  merged: MergedExtraction,
  model?: string,
  apiKeyOverride?: string,
): Promise<{ result: MergedExtraction; billing: ChunkBilling | null }> {
  const { entities } = merged;

  // 엔티티가 3개 이하면 검토 불필요
  if (entities.length <= 3) {
    console.log('[extraction] 엔티티 3개 이하, 병합 검토 스킵');
    return { result: merged, billing: null };
  }

  // 엔티티 목록을 텍스트로 변환
  const entityList = entities.map((e, i) => {
    const aliasText = e.aliases?.length ? ` (별칭: ${e.aliases.join(', ')})` : '';
    return `${i + 1}. ${e.name} [${e.category}]${aliasText}: ${(e.description || '').slice(0, 80)}`;
  }).join('\n');

  const prompt = ENTITY_MERGE_REVIEW_PROMPT.replace('{{entityList}}', entityList);

  try {
    const reviewModel = 'google/gemini-2.0-flash-001';
    const userApiKey = apiKeyOverride !== undefined ? apiKeyOverride : getApiKey();

    const response = await fetchWithClientTimeout('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        apiKey: userApiKey || undefined,
        model: reviewModel,
      }),
    }, 30000);

    if (!response.ok) {
      console.warn('[extraction] 병합 검토 API 오류, 스킵');
      return { result: merged, billing: null };
    }

    const data = await response.json();
    const mergerBilling: ChunkBilling | null = data._billing ? {
      prompt_tokens: data._billing.prompt_tokens ?? 0,
      completion_tokens: data._billing.completion_tokens ?? 0,
      model: data._billing.model ?? 'google/gemini-2.0-flash-001',
      byok: data._billing.byok,
    } : null;
    const content = data.choices?.[0]?.message?.content || '';

    let suggestions: MergeSuggestion[] = [];
    try {
      const jsonContent = stripMarkdownCodeBlock(content);
      suggestions = JSON.parse(jsonContent);
      if (!Array.isArray(suggestions)) {
        throw new Error('배열이 아님');
      }
    } catch {
      console.warn('[extraction] 병합 검토 JSON 파싱 실패, 스킵');
      return { result: merged, billing: mergerBilling };
    }

    if (suggestions.length === 0) {
      console.log('[extraction] LLM 병합 검토: 병합할 것 없음');
      return { result: merged, billing: mergerBilling };
    }

    // 병합 적용
    const newEntities = [...entities];
    const newRelationships = [...merged.relationships];

    for (const suggestion of suggestions) {
      const keepIdx = newEntities.findIndex(e => e.name === suggestion.keep);
      let mergeIdx = newEntities.findIndex(e => e.name === suggestion.merge);

      // 동일 이름 엔티티 병합 시 findIndex가 같은 인덱스를 반환하는 버그 방지
      if (mergeIdx === keepIdx) {
        mergeIdx = newEntities.findIndex((e, idx) => idx !== keepIdx && e.name === suggestion.merge);
      }

      if (keepIdx === -1 || mergeIdx === -1) {
        console.log(`[extraction] 병합 스킵 (이름 없음): "${suggestion.keep}" ← "${suggestion.merge}"`);
        continue;
      }

      const keepEntity = newEntities[keepIdx];
      const mergeEntity = newEntities[mergeIdx];

      // 카테고리가 다르면 병합하지 않음
      if (keepEntity.category !== mergeEntity.category) {
        console.log(`[extraction] 병합 스킵 (카테고리 다름): "${suggestion.keep}" (${keepEntity.category}) ← "${suggestion.merge}" (${mergeEntity.category})`);
        continue;
      }

      console.log(`[extraction] LLM 병합: "${suggestion.keep}" ← "${suggestion.merge}" (${suggestion.reason})`);

      // 엔티티 병합: keep에 merge 정보 흡수
      keepEntity.aliases = [...new Set([
        ...(keepEntity.aliases || []),
        mergeEntity.name,
        ...(mergeEntity.aliases || []),
      ])];
      if (mergeEntity.description) {
        keepEntity.description = mergeDescriptions(keepEntity.description || '', mergeEntity.description);
      }
      keepEntity.scenes = [...new Set([...(keepEntity.scenes || []), ...(mergeEntity.scenes || [])])];

      // 관계에서 merge 이름을 keep 이름으로 변경
      for (const rel of newRelationships) {
        if (rel.from === suggestion.merge) rel.from = suggestion.keep;
        if (rel.to === suggestion.merge) rel.to = suggestion.keep;
      }

      // 병합된 엔티티 제거
      newEntities.splice(mergeIdx, 1);
    }

    // 자기참조 관계 제거 (병합 후 발생 가능)
    const filteredRelationships = newRelationships.filter(r => r.from !== r.to);

    console.log(`[extraction] LLM 병합 검토 완료: ${entities.length} → ${newEntities.length}개 엔티티`);

    return {
      result: {
        ...merged,
        entities: newEntities,
        relationships: filteredRelationships,
      },
      billing: mergerBilling,
    };
  } catch (err: unknown) {
    console.warn('[extraction] 병합 검토 오류, 스킵:', err);
    return { result: merged, billing: null };
  }
}

// --- 관계 타입 정규화 ---

const VALID_RELATION_TYPES = ['가족', '연인', '친구', '적대', '동료', '소속', '위치', '소유', '포함', '관련'];

const RELATION_TYPE_MAPPING: Record<string, string> = {
  // 가족 관련
  '부모': '가족', '자녀': '가족', '형제': '가족', '자매': '가족', '친척': '가족',
  '아버지': '가족', '어머니': '가족', '아들': '가족', '딸': '가족', '할머니': '가족', '할아버지': '가족',
  // 연인 관련
  '사랑': '연인', '짝사랑': '연인', '애인': '연인', '전연인': '연인', '결혼': '연인',
  // 친구 관련
  '지인': '친구', '아는사이': '친구', '친한사이': '친구', '우정': '친구',
  '아친구이': '친구',
  // 적대 관련
  '원수': '적대', '라이벌': '적대', '갈등': '적대', '경쟁': '적대', '싸움': '적대',
  // 동료 관련
  '직장동료': '동료', '팀원': '동료', '동기': '동료', '선배': '동료', '후배': '동료',
  // 영어 타입 (하위호환)
  'family': '가족', 'romantic': '연인', 'friendship': '친구', 'rivalry': '적대',
  'mentor': '동료', 'subordinate': '동료', 'belongs_to': '소속', 'owns': '소유',
  'located_at': '위치', 'related_to': '관련', 'related': '관련',
};

function normalizeRelationType(type: string): string {
  if (!type) return '관련';

  const trimmed = type.trim();

  if (VALID_RELATION_TYPES.includes(trimmed)) {
    return trimmed;
  }

  // 정확한 매핑
  const mapped = RELATION_TYPE_MAPPING[trimmed] || RELATION_TYPE_MAPPING[trimmed.toLowerCase()];
  if (mapped) {
    console.log(`[extraction] 관계 타입 정규화: "${trimmed}" → "${mapped}"`);
    return mapped;
  }

  // 부분 매칭 시도
  for (const [key, value] of Object.entries(RELATION_TYPE_MAPPING)) {
    if (trimmed.includes(key) || key.includes(trimmed)) {
      console.log(`[extraction] 관계 타입 정규화 (부분매칭): "${trimmed}" → "${value}"`);
      return value;
    }
  }

  console.log(`[extraction] 관계 타입 정규화 실패: "${trimmed}" → "관련"`);
  return '관련';
}

function normalizeAllRelationTypes(extracted: MergedExtraction): MergedExtraction {
  const { relationships, ...rest } = extracted;
  const normalizedRelationships = (relationships || []).map((rel) => ({
    ...rel,
    type: normalizeRelationType(rel.type)
  }));
  return { ...rest, relationships: normalizedRelationships };
}

// --- 후처리: 누락된 관계 추론 ---

function normalizeOwnerName(name: string): string {
  return name.trim();
}

function hasRelationship(relationships: MergedRelationship[], from: string, to: string): boolean {
  const normFrom = from.toLowerCase();
  const normTo = to.toLowerCase();
  return relationships.some(r =>
    (r.from?.toLowerCase() === normFrom && r.to?.toLowerCase() === normTo) ||
    (r.from?.toLowerCase() === normTo && r.to?.toLowerCase() === normFrom)
  );
}

/**
 * 후처리: 엔티티 설명에서 누락된 관계 자동 생성
 * "화자가 피우는 담배" 같은 설명에서 소유 관계를 추출
 * "화자가 걷는 길" 같은 설명에서 위치 관계를 추출
 */
export function inferMissingRelationships(extracted: MergedExtraction): MergedExtraction {
  const normalized = normalizeAllRelationTypes(extracted);
  const { entities, relationships } = normalized;
  const newRelationships: MergedRelationship[] = [];

  const characterNames = entities
    .filter((e) => e.category === 'character')
    .map((e) => e.name);

  const ownerPatterns = [
    /^(.+?)(?:가|이|의)\s*(?:피우는|먹는|마시는|쓰는|타는|가진|입는|쓰던|읽는|보는|사용하는|운전하는|타고\s*다니는|가지고\s*있는)/,
    /^(.+?)의\s+/,
  ];

  const locationPatterns = [
    /^(.+?)(?:가|이)\s*(?:걷는|걸어가는|지나가는|다니는|있는|가는|오는|서\s*있는|앉아\s*있는|누워\s*있는)/,
    /^(.+?)(?:가|이)\s*(?:사는|거주하는|일하는|근무하는|다니는)/,
  ];

  for (const entity of entities) {
    if (entity.category === 'character') continue;

    const desc = entity.description || '';
    const attrOwner = (entity.attributes as Record<string, string> | undefined)?.owner;
    const isLocation = entity.category === 'location';

    // attributes.owner가 있으면 관계 생성 (owner가 실제 캐릭터인 경우만)
    if (attrOwner) {
      const ownerName = normalizeOwnerName(attrOwner);
      const ownerIsKnown = characterNames.some(cn => cn === ownerName || cn.includes(ownerName) || ownerName.includes(cn));
      if (ownerIsKnown &&
          !hasRelationship(relationships, ownerName, entity.name) &&
          !hasRelationship(newRelationships, ownerName, entity.name)) {
        newRelationships.push({
          from: ownerName,
          to: entity.name,
          type: isLocation ? '위치' : '소유',
          description: `${ownerName}의 ${entity.name}`,
          sentiment: 'neutral',
          strength: 5,
          scenes: entity.scenes || []
        });
      }
    }

    // location 엔티티면 위치 패턴 먼저 시도 (추출된 이름이 알려진 캐릭터인 경우만)
    if (isLocation) {
      let foundMatch = false;
      for (const pattern of locationPatterns) {
        const match = desc.match(pattern);
        if (match) {
          const personName = normalizeOwnerName(match[1].trim());
          const personIsKnown = characterNames.some(cn => cn === personName || cn.includes(personName) || personName.includes(cn));
          if (personIsKnown &&
              !hasRelationship(relationships, personName, entity.name) &&
              !hasRelationship(newRelationships, personName, entity.name)) {
            newRelationships.push({
              from: personName,
              to: entity.name,
              type: '위치',
              description: desc,
              sentiment: 'neutral',
              strength: 5,
              scenes: entity.scenes || []
            });
            console.log(`[extraction] 위치 관계 추론: "${personName}" -> "${entity.name}" (${desc})`);
          }
          foundMatch = true;
          break;
        }
      }
      if (foundMatch) continue;
    }

    // 설명에서 소유자 패턴 찾기 (추출된 이름이 알려진 캐릭터인 경우만)
    for (const pattern of ownerPatterns) {
      const match = desc.match(pattern);
      if (match) {
        const ownerName = normalizeOwnerName(match[1].trim());
        const ownerIsKnown = characterNames.some(cn => cn === ownerName || cn.includes(ownerName) || ownerName.includes(cn));
        if (ownerIsKnown &&
            !hasRelationship(relationships, ownerName, entity.name) &&
            !hasRelationship(newRelationships, ownerName, entity.name)) {
          newRelationships.push({
            from: ownerName,
            to: entity.name,
            type: isLocation ? '위치' : '소유',
            description: desc,
            sentiment: 'neutral',
            strength: 5,
            scenes: entity.scenes || []
          });
        }
        break;
      }
    }

    // 설명에서 인물 이름이 직접 언급되어 있으면 관계 생성
    // 단, 2글자 이상의 이름만 매칭 (1글자 이름은 오매칭 위험)
    for (const charName of characterNames) {
      if (charName.length < 2) continue;
      if (desc.includes(charName)) {
        if (!hasRelationship(relationships, charName, entity.name) &&
            !hasRelationship(newRelationships, charName, entity.name)) {
          newRelationships.push({
            from: charName,
            to: entity.name,
            type: isLocation ? '위치' : '관련',
            description: desc,
            sentiment: 'neutral',
            strength: 4,
            scenes: entity.scenes || []
          });
          console.log(`[extraction] 설명 기반 관계 추론: "${charName}" -> "${entity.name}"`);
        }
      }
    }
  }

  // --- scene 기반 location-character 위치 관계 자동 생성 ---
  // LLM이 위치 관계를 추출하지 않은 경우, 같은 scene에 등장하는 location과 character를 연결
  const locationEntities = entities.filter(e => e.category === 'location');
  const characterEntities = entities.filter(e => e.category === 'character');
  const allRels = [...relationships, ...newRelationships];

  for (const loc of locationEntities) {
    const locScenes = new Set(loc.scenes || []);
    if (locScenes.size === 0) continue;

    // 이 location이 이미 어떤 캐릭터와 위치 관계가 있는지 확인
    const hasAnyLocationRel = allRels.some(r =>
      r.type === '위치' && (r.to === loc.name || r.from === loc.name)
    );
    if (hasAnyLocationRel) continue;

    // 같은 scene에 등장하는 캐릭터들과 위치 관계 생성
    for (const char of characterEntities) {
      const charScenes = new Set(char.scenes || []);
      const commonScenes = [...locScenes].filter(s => charScenes.has(s));
      if (commonScenes.length === 0) continue;

      if (!hasRelationship(allRels, char.name, loc.name) &&
          !hasRelationship(newRelationships, char.name, loc.name)) {
        newRelationships.push({
          from: char.name,
          to: loc.name,
          type: '위치',
          description: `${loc.name}에서 활동`,
          sentiment: 'neutral',
          strength: 4,
          scenes: commonScenes
        });
      }
    }
  }

  console.log(`[extraction] 후처리: ${newRelationships.length}개의 누락된 관계 추가됨`);

  return {
    ...normalized,
    relationships: [...relationships, ...newRelationships]
  };
}

// --- 로어북 병합 ---

const VALID_LORE_CATEGORIES = new Set<string>([
  'appearance', 'outfit', 'personality', 'ability', 'background', 'motivation',
  'relationship_detail', 'quote', 'world_setting', 'location_detail',
  'organization_detail', 'item_detail', 'event',
]);

// LLM이 잘못 생성하는 엔티티 이름 패턴 정리
const INVALID_ENTITY_NAMES = new Set([
  'concept', 'character', 'location', 'item', 'creature', 'event', 'organization',
  '나', '그', '그녀', '그들', '화자', '주인공',
]);

function cleanEntityName(name: string): string {
  // 괄호 내용 제거: "고양이(나)" → "고양이", "서준(별칭: 나)" → "서준"
  let cleaned = name.replace(/\s*\([^)]*\)\s*/g, '').trim();
  // 대괄호 제거: "고양이[주인공]" → "고양이"
  cleaned = cleaned.replace(/\s*\[[^\]]*\]\s*/g, '').trim();
  return cleaned || name.trim();
}

/**
 * 청크별 raw 로어 엔트리를 병합하고 글로벌 장면 ID로 매핑
 * chunkSceneMappings: 청크별 로컬 장면 번호 → "S0001" 형식 매핑
 * entityNameMapping: 엔티티 병합(reviewEntityMerges) 후 "old name" → "keep name" 매핑
 * knownEntityNames: KG에 존재하는 엔티티 이름 목록 (이름 매칭용)
 */
export function mergeLoreEntries(
  allExtractedLore: RawLoreEntry[][],
  chunkSourceFileIndices: number[],
  chunkSceneMappings: Array<Record<number, string>>,
  entityNameMapping: Record<string, string>,
  fileNames?: string[],
  sourceFileIds?: string[],
  knownEntityNames?: string[],
): LoreEntry[] {
  const entries: LoreEntry[] = [];
  const seen = new Set<string>();  // 중복 제거: "entityName|category|sceneId|contentPrefix"
  let counter = 0;
  let skippedInvalid = 0;

  // 알려진 엔티티 이름으로 퍼지 매칭을 위한 맵
  const knownNamesLower = (knownEntityNames || []).map(n => ({ original: n, lower: n.toLowerCase() }));

  for (let chunkIdx = 0; chunkIdx < allExtractedLore.length; chunkIdx++) {
    const chunkLore = allExtractedLore[chunkIdx];
    if (!chunkLore?.length) continue;

    // 이 청크의 파일 인덱스 → sourceFileId
    const fileIndex = chunkSourceFileIndices[chunkIdx] ?? 0;
    const fileId = sourceFileIds?.[fileIndex] || undefined;

    for (const raw of chunkLore) {
      if (!raw.entity_name || !raw.content) continue;

      // 카테고리 검증
      const category = VALID_LORE_CATEGORIES.has(raw.category)
        ? raw.category as LoreCategory
        : 'event';

      // 1. 이름 정리: 괄호/별칭 제거
      let entityName = cleanEntityName(raw.entity_name);

      // 2. 병합 매핑 적용
      entityName = entityNameMapping[entityName] || entityNameMapping[raw.entity_name] || entityName;

      // 3. 무효한 이름 필터링 (카테고리명이나 대명사를 이름으로 쓴 경우)
      if (INVALID_ENTITY_NAMES.has(entityName.toLowerCase())) {
        skippedInvalid++;
        continue;
      }

      // 4. 알려진 엔티티 이름으로 매칭 시도 (LLM이 약간 다르게 쓴 경우 보정)
      if (knownNamesLower.length > 0) {
        const nameLower = entityName.toLowerCase();
        // 정확 매칭
        const exact = knownNamesLower.find(k => k.lower === nameLower);
        if (exact) {
          entityName = exact.original;
        } else {
          // 부분 매칭 (80% 이상 길이 비율)
          for (const known of knownNamesLower) {
            const shorter = Math.min(nameLower.length, known.lower.length);
            const longer = Math.max(nameLower.length, known.lower.length);
            if (shorter >= 2 && shorter / longer >= 0.8) {
              if (known.lower.includes(nameLower) || nameLower.includes(known.lower)) {
                entityName = known.original;
                break;
              }
            }
          }
        }
      }

      // 장면 ID: 청크별 로컬 → S-format 매핑
      // LLM B의 장면 번호는 청크 로컬이므로, LLM A의 같은 청크 매핑으로 근사
      const chunkMapping = chunkSceneMappings[chunkIdx] || {};
      let sceneId = chunkMapping[raw.scene];
      if (!sceneId) {
        // LLM B가 LLM A와 다른 장면 수를 뽑은 경우: 가장 가까운 장면에 매핑
        const availableScenes = Object.keys(chunkMapping).map(Number).sort((a, b) => a - b);
        if (availableScenes.length > 0) {
          // 비례 매핑: LLM B의 장면 번호를 LLM A의 장면 범위에 대응
          const maxLoreScene = raw.scene;
          const maxLlmAScene = availableScenes[availableScenes.length - 1];
          const mappedIdx = Math.min(
            Math.round((maxLoreScene - 1) / Math.max(maxLoreScene, 1) * availableScenes.length),
            availableScenes.length - 1
          );
          sceneId = chunkMapping[availableScenes[Math.max(0, mappedIdx)]];
        }
        if (!sceneId) sceneId = `S${String(raw.scene).padStart(4, '0')}`;
      }

      // 중복 제거 키: 같은 (엔티티, 카테고리, 장면, content 앞 30자)
      const dedupKey = `${entityName}|${category}|${sceneId}|${raw.content.slice(0, 30)}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      counter++;
      entries.push({
        id: `LR${String(counter).padStart(4, '0')}`,
        entityName,
        category,
        content: raw.content,
        quote: raw.quote || undefined,
        sceneId,
        sourceFileId: fileId,
      });
    }
  }

  if (skippedInvalid > 0) {
    console.log(`[lorebook] 무효한 엔티티 이름 ${skippedInvalid}개 건너뜀`);
  }
  console.log(`[lorebook] 병합 완료: ${entries.length}개 로어 엔트리`);
  return entries;
}

// --- 지식 그래프 구축 ---

// 두 엔티티 간 기존 관계가 존재하는지 확인
function hasEdgeBetween(hyperedges: Record<string, HyperEdge>, id1: string, id2: string): boolean {
  return Object.values(hyperedges).some((edge) =>
    edge.entities.includes(id1) && edge.entities.includes(id2)
  );
}

// 장면 ID에서 chapter 번호 추출 (S0003 → 해당 장면의 chapter를 snapshots에서 찾기)
function getChapterFromScenes(scenes: string[], sceneChapterMap: Record<string, number>): number {
  for (const s of scenes) {
    if (sceneChapterMap[s]) return sceneChapterMap[s];
  }
  return 1;
}

// 장면 ID 문자열에서 사람이 읽기 쉬운 번호 추출 ("S0003" -> "3")
function sceneIdToReadable(sceneId: string): string {
  return sceneId.replace('S', '').replace(/^0+/, '');
}

// description에서 다른 엔티티 언급을 찾아 자동 관계 생성
// newSceneIds: 이번에 새로 추가된 장면 ID들 (기존 그래프와 병합 시 새 장면만 전달)
function inferDescriptionBasedEdges(
  entities: Record<string, Entity>,
  hyperedges: Record<string, HyperEdge>,
  edgeCounter: { value: number },
  newSceneIds?: Set<string>
): void {
  for (const entity of Object.values(entities)) {
    if (!entity.description) continue;

    const descLower = entity.description.toLowerCase();

    for (const otherEntity of Object.values(entities)) {
      if (entity.id === otherEntity.id) continue;

      const namesToCheck = [otherEntity.name, ...(otherEntity.aliases || [])];
      const isMentioned = namesToCheck.some((name: string) =>
        descLower.includes(name.toLowerCase())
      );
      if (!isMentioned) continue;
      if (hasEdgeBetween(hyperedges, entity.id, otherEntity.id)) continue;

      // 두 엔티티의 공통 장면 계산
      let commonScenes: string[] = [];
      const entityScenes = entity.scenes || [];
      const otherScenes = otherEntity.scenes || [];

      if (newSceneIds && newSceneIds.size > 0) {
        // 기존 그래프에 추가하는 경우: 새 장면 중 공통인 것만 사용
        commonScenes = entityScenes.filter(s =>
          newSceneIds.has(s) && otherScenes.includes(s)
        );
        // 공통 장면이 없으면 각자의 새 장면만이라도 사용
        if (commonScenes.length === 0) {
          const entityNewScenes = entityScenes.filter(s => newSceneIds.has(s));
          const otherNewScenes = otherScenes.filter(s => newSceneIds.has(s));
          // 둘 다 새 장면이 있어야 관계 생성
          if (entityNewScenes.length === 0 || otherNewScenes.length === 0) {
            continue; // 기존 엔티티와 새 엔티티 간 관계는 새 장면 기준으로만
          }
          commonScenes = [...new Set([...entityNewScenes, ...otherNewScenes])];
        }
      } else {
        // 새로 생성하는 경우: 공통 장면 또는 entity의 장면 사용
        commonScenes = entityScenes.filter(s => otherScenes.includes(s));
        if (commonScenes.length === 0) {
          commonScenes = entityScenes;
        }
      }

      if (commonScenes.length === 0) continue;

      // 양쪽 다 character가 아닌 경우 스킵 (item-location 등 무의미한 관계 방지)
      if (entity.category !== 'character' && otherEntity.category !== 'character') continue;

      edgeCounter.value++;
      const id = formatId('H', edgeCounter.value);

      // description이 너무 길면 관련 문장만 추출
      let statementText = entity.description;
      if (statementText && statementText.length > 200) {
        const sentences = statementText.split(/[.!?。]/).filter((s: string) => s.trim());
        const relevantSentences = sentences.filter((s: string) =>
          namesToCheck.some((name: string) => s.toLowerCase().includes(name.toLowerCase()))
        );
        statementText = relevantSentences.length > 0
          ? relevantSentences.join('. ').trim()
          : statementText.slice(0, 200) + '...';
      }

      hyperedges[id] = {
        id,
        type: '관련',
        subtype: undefined,
        entities: [entity.id, otherEntity.id],
        statement: statementText || `${entity.name}의 설명에 ${otherEntity.name}이(가) 언급됨`,
        timeline: { start: undefined },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: true,
        scenes: commonScenes,
        sourceRef: {},
      };

      console.log(`[extraction] 자동 관계 생성: ${entity.name} - ${otherEntity.name} (description 기반, 장면: ${commonScenes.join(', ')})`);
    }
  }
}

// 같은 장면에 등장하는 엔티티 쌍에 대해 자동 관계 생성
// 캐릭터-캐릭터, 캐릭터-비캐릭터 모두 처리 (비캐릭터-비캐릭터는 스킵)
// newSceneIds: 이번에 새로 추가된 장면 ID들 (기존 그래프와 병합 시 새 장면만 전달)
function inferCoOccurrenceEdges(
  entities: Record<string, Entity>,
  hyperedges: Record<string, HyperEdge>,
  edgeCounter: { value: number },
  newSceneIds?: Set<string>
): void {
  const allEntities = Object.values(entities);

  // 캐릭터가 포함된 쌍만 처리 (비캐릭터-비캐릭터는 스킵)
  for (let i = 0; i < allEntities.length; i++) {
    const e1 = allEntities[i];
    if (!e1.scenes?.length) continue;

    for (let j = i + 1; j < allEntities.length; j++) {
      const e2 = allEntities[j];
      if (!e2.scenes?.length) continue;

      // 둘 다 비캐릭터면 스킵
      if (e1.category !== 'character' && e2.category !== 'character') continue;

      // 공통 장면 계산
      let commonScenes = e1.scenes.filter((s: string) => e2.scenes!.includes(s));

      // 기존 그래프에 추가하는 경우: 새 장면 중 공통인 것만 사용
      if (newSceneIds && newSceneIds.size > 0) {
        commonScenes = commonScenes.filter(s => newSceneIds.has(s));
      }

      if (commonScenes.length === 0) continue;
      if (hasEdgeBetween(hyperedges, e1.id, e2.id)) continue;

      edgeCounter.value++;
      const id = formatId('H', edgeCounter.value);
      const sceneNums = commonScenes.map(sceneIdToReadable).join(', ');

      hyperedges[id] = {
        id,
        type: '관련',
        subtype: undefined,
        entities: [e1.id, e2.id],
        statement: `${e1.name}과(와) ${e2.name}이(가) 동일 장면에 등장 (장면 ${sceneNums})`,
        timeline: { start: undefined },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: true,
        scenes: commonScenes,
        sourceRef: {},
      };
    }
  }
}

// 장면(Scene)을 snapshots로 변환, 추가 분석 시 번호 이어가기
function buildSnapshots(
  extracted: MergedExtraction,
  entities: Record<string, Entity>,
  hyperedges: Record<string, HyperEdge>,
  sceneIdMapping: Record<number, string>,
  existingGraph?: NovelKnowledgeGraph,
  fileNames?: string[],
): Record<string, SceneSnapshot> {
  const snapshots: Record<string, SceneSnapshot> = existingGraph ? { ...existingGraph.snapshots } : {};
  const sortedScenes = [...(extracted.scenes || [])].sort((a, b) => (a.id || 0) - (b.id || 0));
  const defaultChapterNumber = 0;

  // 기존 장면의 최대 order 추출
  let maxOrder = 0;
  if (existingGraph?.snapshots) {
    for (const scene of Object.values(existingGraph.snapshots)) {
      maxOrder = Math.max(maxOrder, scene.order || 0);
    }
  }

  for (let idx = 0; idx < sortedScenes.length; idx++) {
    const s = sortedScenes[idx];
    // sceneIdMapping에서 실제 장면 ID 가져오기
    const sceneId = sceneIdMapping[s.id];
    if (!sceneId) {
      console.warn(`[extraction] 장면 ID 매핑 없음: ${s.id}`);
      continue;
    }
    // order는 기존 최대 order + 1부터 시작
    const actualOrder = maxOrder + idx + 1;

    const actualChapterNum = s.chapter || defaultChapterNumber;
    const chapterId = actualChapterNum ? formatId('C', actualChapterNum) : null;

    // 이 장면에 등장하는 엔티티/관계 찾기 (이미 매핑된 sceneId 사용)
    const entitiesInScene = Object.values(entities)
      .filter((e) => e.scenes?.includes(sceneId))
      .map((e) => e.id);

    const activeEdges = Object.values(hyperedges)
      .filter((e) => e.scenes?.includes(sceneId))
      .map((e) => e.id);

    // 장면이 추출된 원본 파일명 결정
    const sceneSourceFile = (s.sourceFileIndex !== undefined && fileNames && fileNames[s.sourceFileIndex])
      ? fileNames[s.sourceFileIndex]
      : (fileNames?.[0] || undefined);

    snapshots[sceneId] = {
      sceneId,
      order: actualOrder,
      chapter: chapterId,
      chapterNumber: actualChapterNum,
      time: s.time || `장면 ${s.id}`,
      timeMarker: s.time_marker || null,
      location: s.location || '',
      summary: s.summary || '',
      events: s.events || [],
      mood: s.mood,
      charactersPresent: entitiesInScene,
      activeEdges,
      sourceFile: sceneSourceFile,
    };
  }

  return snapshots;
}

export function buildKnowledgeGraph(extracted: MergedExtraction, title: string, model?: string, fileNames?: string[], originalText?: string, existingGraph?: NovelKnowledgeGraph, loreEntries?: LoreEntry[]): NovelKnowledgeGraph {
  const now = new Date().toISOString();

  // 기존 그래프의 엔티티/관계를 유지 (새 파일 추가 시 기존 데이터 보존)
  // LLM 분석 시에는 기존 엔티티를 전달하지 않음 (orchestrator에서 처리)
  // 여기서는 기존 데이터를 복사하고, 새 파일 분석 결과를 병합
  let entities: Record<string, Entity> = {};
  let hyperedges: Record<string, HyperEdge> = {};
  const nameToId: Record<string, string> = {};

  // 기존 장면의 최대 번호 추출 (새 장면 ID 계산용)
  let maxSceneNum = 0;
  let entityCounter = 0;
  let edgeCounterValue = 0;

  if (existingGraph) {
    // 기존 그래프의 엔티티/관계 복사 (기존 파일 데이터 유지)
    for (const [id, entity] of Object.entries(existingGraph.entities)) {
      entities[id] = { ...entity };
    }
    for (const [id, edge] of Object.entries(existingGraph.hyperedges)) {
      hyperedges[id] = { ...edge };
    }

    // 기존 장면 최대 번호
    for (const sceneId of Object.keys(existingGraph.snapshots || {})) {
      const numMatch = sceneId.match(/S0*(\d+)/);
      if (numMatch) {
        maxSceneNum = Math.max(maxSceneNum, parseInt(numMatch[1], 10));
      }
    }

    // 기존 엔티티의 최대 번호 추출 (ID 충돌 방지용)
    for (const entityId of Object.keys(existingGraph.entities)) {
      const numMatch = entityId.match(/E0*(\d+)/);
      if (numMatch) {
        entityCounter = Math.max(entityCounter, parseInt(numMatch[1], 10));
      }
    }

    // 기존 관계의 최대 번호 추출 (ID 충돌 방지용)
    for (const edgeId of Object.keys(existingGraph.hyperedges)) {
      const numMatch = edgeId.match(/H0*(\d+)/);
      if (numMatch) {
        edgeCounterValue = Math.max(edgeCounterValue, parseInt(numMatch[1], 10));
      }
    }

    // 기존 엔티티의 이름 매핑 초기화 (같은 이름 → 같은 ID)
    for (const e of Object.values(existingGraph.entities)) {
      registerNameMapping(nameToId, e.name, e.id);
      for (const alias of (e.aliases || [])) {
        registerNameMapping(nameToId, alias, e.id);
      }
    }

    console.log(`[extraction] 기존 그래프 유지: 엔티티 ${Object.keys(entities).length}개, 관계 ${Object.keys(hyperedges).length}개, maxSceneNum=${maxSceneNum}`);
  }

  const edgeCounter = { value: edgeCounterValue };

  // 새로 추출된 장면 ID를 실제 ID로 매핑하는 맵 생성
  // 예: extracted.scenes의 id=1 → S0005 (maxSceneNum + 1)
  const sceneIdMapping: Record<number, string> = {};
  const sortedScenes = [...(extracted.scenes || [])].sort((a, b) => (a.id || 0) - (b.id || 0));
  for (let idx = 0; idx < sortedScenes.length; idx++) {
    const s = sortedScenes[idx];
    const actualSceneNum = maxSceneNum + idx + 1;
    sceneIdMapping[s.id] = formatId('S', actualSceneNum);
  }
  console.log('[extraction] 장면 ID 매핑:', sceneIdMapping);

  // 장면 ID → 챕터 번호 매핑 생성 (firstMention/timeline 계산용)
  const sceneChapterMap: Record<string, number> = {};
  for (const s of sortedScenes) {
    const globalSceneId = sceneIdMapping[s.id];
    if (!globalSceneId) continue;
    // 장면의 chapter → 실제 챕터 번호
    let chapterNum = s.chapter || 1;
    if (s.chapter && extracted.chapters) {
      const chapterInfo = extracted.chapters.find(c => c.id === s.chapter);
      if (chapterInfo?.title) {
        const numMatch = chapterInfo.title.match(/(\d+)/);
        if (numMatch) chapterNum = parseInt(numMatch[1], 10);
      }
    }
    sceneChapterMap[globalSceneId] = chapterNum;
  }

  // 엔티티 등록
  console.log(`[extraction] LLM 추출 엔티티 수: ${extracted.entities.length}개`);
  for (const e of extracted.entities) {
    const existingId = nameToId[e.name] || nameToId[e.name.toLowerCase()] || nameToId[normalizeName(e.name)];
    // 새 장면 ID로 변환 (sceneIdMapping 사용)
    const newSceneIds = (e.scenes || []).map((s: number) => sceneIdMapping[s] || formatId('S', s));

    if (entities[existingId]) {
      // 이미 이번 분석에서 생성된 엔티티에 정보 추가
      const existing = entities[existingId];
      existing.aliases = [...new Set([...(existing.aliases || []), ...(e.aliases || [])])];
      if (e.description) {
        existing.description = mergeDescriptions(existing.description || '', e.description).slice(0, 500);
      }
      // 기존 scenes에 새 장면 ID 추가 (중복 제거)
      const oldScenes = existing.scenes?.length || 0;
      existing.scenes = [...new Set([...(existing.scenes || []), ...newSceneIds])];
      console.log(`[extraction] 기존 엔티티 업데이트: ${e.name} (${existingId}), scenes: ${oldScenes}→${existing.scenes.length}`);
      continue;
    }

    // 기존 그래프에 같은 이름의 엔티티가 있으면 그 ID 재사용, 없으면 새 ID 생성
    const id = existingId || formatId('E', ++entityCounter);
    // 첫 등장 챕터 계산: 엔티티의 첫 번째 장면에서 챕터 번호 추출
    const firstChapter = newSceneIds.length > 0
      ? getChapterFromScenes(newSceneIds, sceneChapterMap)
      : 1;

    entities[id] = {
      id,
      name: e.name,
      category: (e.category || 'character') as EntityCategory,
      aliases: e.aliases || [],
      description: e.description || '',
      attributes: (e.attributes || {}) as Record<string, unknown>,
      scenes: newSceneIds,
      firstMention: { chapter: firstChapter },
      importance: e.importance || 5,
    };
    console.log(`[extraction] 새 엔티티 생성: ${e.name} (${id}), category: ${e.category}, scenes: ${newSceneIds.join(',')}${existingId ? ' (기존 ID 재사용)' : ''}`);
    registerNameMapping(nameToId, e.name, id);
    for (const alias of (e.aliases || [])) {
      registerNameMapping(nameToId, alias, id);
    }
  }

  // 관계 등록
  for (const r of extracted.relationships) {
    const fromId = findEntityId(r.from, nameToId);
    const toId = findEntityId(r.to, nameToId);
    if (!fromId || !toId) {
      console.log('[extraction] 관계 매핑 실패:', r.from, '->', r.to, '(엔티티를 찾을 수 없음)');
      continue;
    }

    if (fromId === toId) {
      console.log('[extraction] 자기참조 관계 무시:', r.from, '->', r.to);
      continue;
    }

    // 기존에 같은 관계가 있는지 확인
    const existingEdge = Object.values(hyperedges).find((e) =>
      e.type === r.type && e.entities.includes(fromId) && e.entities.includes(toId)
    );

    // 새 장면 ID로 변환 (sceneIdMapping 사용)
    const sceneIds = (r.scenes || []).map((s: number) => sceneIdMapping[s] || formatId('S', s));

    if (existingEdge) {
      existingEdge.scenes = [...new Set([...(existingEdge.scenes || []), ...sceneIds])];
      continue;
    }

    // 관계의 챕터 번호: 관계가 속한 장면에서 추출
    const edgeChapter = sceneIds.length > 0
      ? getChapterFromScenes(sceneIds, sceneChapterMap)
      : 1;

    edgeCounter.value++;
    const id = formatId('H', edgeCounter.value);
    hyperedges[id] = {
      id,
      type: r.type,
      subtype: r.subtype,
      entities: [fromId, toId],
      statement: r.description || '',
      quote: r.quote,
      timeline: { start: r.start_time, chapter: edgeChapter },
      sentiment: r.sentiment as HyperEdge['sentiment'],
      strength: r.strength,
      bidirectional: r.bidirectional,
      fromPerspective: r.from_perspective,
      toPerspective: r.to_perspective,
      scenes: sceneIds,
      sourceRef: { chapter: edgeChapter },
    };
  }

  // 자동 관계 생성: description 기반 + 장면 동시 등장
  // 기존 그래프가 있으면 새로 추가된 장면 ID만 전달 (기존 장면과의 관계 생성 방지)
  const newSceneIds = existingGraph
    ? new Set(Object.values(sceneIdMapping))
    : undefined;
  console.log('[extraction] 새 장면 ID:', newSceneIds ? [...newSceneIds].join(', ') : '(전체)');

  inferDescriptionBasedEdges(entities, hyperedges, edgeCounter, newSceneIds);
  inferCoOccurrenceEdges(entities, hyperedges, edgeCounter, newSceneIds);

  // 타임라인 등록
  const timeline = (extracted.timeline || []).map((t: MergedTimelinePoint) => {
    const timeEntities = (t.characters || []).map((name: string) => nameToId[name]).filter(Boolean);
    // 타임라인 챕터: 관련 엔티티의 장면에서 추출
    let timeChapter = 1;
    for (const entityId of timeEntities) {
      const entity = entities[entityId];
      if (entity?.scenes?.length) {
        timeChapter = getChapterFromScenes(entity.scenes, sceneChapterMap);
        break;
      }
    }
    return {
      id: t.time_id || '',
      name: t.events?.[0] || t.time_expression || '',
      description: (t.events || []).join(', '),
      storyTime: t.time_expression || '',
      order: t.order,
      chapter: timeChapter,
      entities: timeEntities,
      edges: [],
    };
  }).sort((a, b) => (a.order || 0) - (b.order || 0));

  // 장(Chapter) 정보 처리
  const chapters: Record<string, Chapter> = existingGraph ? { ...existingGraph.chapters } : {};
  for (const c of extracted.chapters) {
    let actualNumber = c.id;
    if (c.title) {
      const numMatch = c.title.match(/(\d+)/);
      if (numMatch) {
        actualNumber = parseInt(numMatch[1], 10);
      }
    }
    const chapterId = formatId('C', actualNumber);
    if (!chapters[chapterId]) {
      chapters[chapterId] = {
        id: chapterId,
        number: actualNumber,
        title: c.title || `제${actualNumber}장`,
        summary: c.summary || '',
      };
    }
  }

  // 장면(Scene)을 snapshots로 변환
  const snapshots = buildSnapshots(extracted, entities, hyperedges, sceneIdMapping, existingGraph, fileNames);

  // 통계
  const entitiesByCategory: Partial<Record<EntityCategory, number>> = {};
  const edgesByType: Partial<Record<RelationType, number>> = {};

  for (const e of Object.values(entities)) {
    entitiesByCategory[e.category] = (entitiesByCategory[e.category] || 0) + 1;
  }
  for (const e of Object.values(hyperedges)) {
    const t = e.type as RelationType;
    edgesByType[t] = (edgesByType[t] || 0) + 1;
  }

  // 소스 파일 정보 생성 - 기존 파일 목록에 새 파일 추가
  const existingSourceFiles = existingGraph?.metadata?.sourceFiles || [];
  const existingFileNameSet = new Set(existingSourceFiles.map((sf) => sf.fileName));
  const newSourceFiles: SourceFile[] = [];

  // 기존 파일 ID에서 최대 번호 추출 (삭제 후 재추가 시 충돌 방지)
  let maxFileNum = 0;
  for (const sf of existingSourceFiles) {
    const numMatch = sf.id.match(/F0*(\d+)/);
    if (numMatch) {
      maxFileNum = Math.max(maxFileNum, parseInt(numMatch[1], 10));
    }
  }

  if (fileNames && originalText) {
    for (const fileName of fileNames) {
      if (!existingFileNameSet.has(fileName)) {
        maxFileNum++;
        const newId = formatId('F', maxFileNum);
        newSourceFiles.push({
          id: newId,
          fileName,
          uploadedAt: now,
          text: originalText,
          charCount: originalText.length,
        });
      }
    }
  }

  const sourceFiles = [...existingSourceFiles, ...newSourceFiles];

  // sourceFileId 매핑: 파일명으로 ID 찾기
  const fileNameToId: Record<string, string> = {};
  for (const sf of sourceFiles) {
    fileNameToId[sf.fileName] = sf.id;
  }

  // 장면에 sourceFileId 추가 (fileNameToId 생성 이후에 실행)
  for (const snap of Object.values(snapshots)) {
    if (snap.sourceFile && !snap.sourceFileId) {
      snap.sourceFileId = fileNameToId[snap.sourceFile];
    }
  }

  // 기존 타임라인과 병합
  const mergedTimeline = existingGraph ? [...(existingGraph.timeline || []), ...timeline] : timeline;

  // 로어북 구성: 기존 lorebook + 새 lore entries
  let lorebook: Lorebook | undefined = undefined;
  const existingLorebook = existingGraph?.lorebook;
  if (loreEntries?.length || existingLorebook) {
    const allEntries: Record<string, LoreEntry> = {};

    // 기존 로어북 복사
    if (existingLorebook) {
      Object.entries(existingLorebook.entries).forEach(([id, entry]) => {
        allEntries[id] = entry;
      });
    }

    // 새 로어 엔트리의 sourceFileId 매핑 (fileNameToId 사용)
    if (loreEntries?.length) {
      // 기존 LR 번호 최대값 구하기 (ID 충돌 방지)
      let maxLoreNum = 0;
      for (const id of Object.keys(allEntries)) {
        const numMatch = id.match(/LR0*(\d+)/);
        if (numMatch) maxLoreNum = Math.max(maxLoreNum, parseInt(numMatch[1], 10));
      }

      for (const entry of loreEntries) {
        maxLoreNum++;
        const newId = `LR${String(maxLoreNum).padStart(4, '0')}`;

        // sourceFileId가 없으면 sceneId로 역추적
        let resolvedFileId = entry.sourceFileId;
        if (!resolvedFileId && entry.sceneId) {
          const snapshot = snapshots[entry.sceneId];
          if (snapshot?.sourceFileId) {
            resolvedFileId = snapshot.sourceFileId;
          }
        }

        allEntries[newId] = {
          ...entry,
          id: newId,
          sourceFileId: resolvedFileId,
        };
      }
    }

    lorebook = { entries: allEntries };
  }

  return {
    metadata: {
      ...(existingGraph?.metadata || {}),
      title: existingGraph?.metadata?.title || title,
      createdAt: existingGraph?.metadata?.createdAt || now,
      updatedAt: now,
      version: '1.0.0',
      model: existingGraph?.metadata?.model || model,
      sourceFiles,
    },
    entities,
    hyperedges,
    chapters,
    timeline: mergedTimeline,
    snapshots,
    lorebook,
    stats: {
      totalEntities: Object.keys(entities).length,
      totalEdges: Object.keys(hyperedges).length,
      totalChapters: Object.keys(chapters).length,
      entitiesByCategory: entitiesByCategory as Record<EntityCategory, number>,
      edgesByType: edgesByType as Record<RelationType, number>,
    },
  };
}
