/**
 * 지식 그래프 추출 서비스 — 결과 병합 및 후처리
 */

import type {
  NovelKnowledgeGraph, Entity, HyperEdge,
  EntityCategory, RelationType, Chapter, SceneSnapshot, SourceFile,
} from '../../types';
import type {
  ChunkExtractedData, MergedExtraction, MergedEntity, MergedRelationship,
  MergedScene, MergedChapter, MergedTimelinePoint,
} from './types';

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

// 두 문자열의 최대 공통 부분 문자열 찾기
function findOverlap(a: string, b: string): string {
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
}

// 이름 → ID 매핑에 정확/소문자/정규화 3가지 키를 등록
function registerNameMapping(nameToId: Record<string, string>, name: string, id: string): void {
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

  // 3. 부분 매칭 (이름이 포함되거나 포함하는 경우)
  const nameLower = name.toLowerCase();
  for (const [entityName, id] of Object.entries(nameToId)) {
    const entityNameLower = entityName.toLowerCase();
    if (entityNameLower.includes(nameLower) || nameLower.includes(entityNameLower)) {
      return id;
    }
  }

  // 4. 2글자 이상 공통 부분 매칭
  if (name.length >= 2) {
    for (const [entityName, id] of Object.entries(nameToId)) {
      if (findOverlap(name, entityName).length >= 2) {
        return id;
      }
    }
  }

  return undefined;
}

// --- 비슷한 엔티티 찾기 (mergeExtractions 전용) ---

function findSimilarEntity(name: string, nameMap: Record<string, number>): number {
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

// --- 청크 결과 병합 ---

export function mergeExtractions(extractions: ChunkExtractedData[], chunkSourceFileIndices: number[] = []): MergedExtraction {
  const entities: MergedEntity[] = [];
  const relationships: MergedRelationship[] = [];
  const scenes: MergedScene[] = [];
  const chapters: MergedChapter[] = [];
  const chapterMap: Record<string, number> = {};
  const nameMap: Record<string, number> = {};

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
    globalSceneOffset += chunkScenes.length || 1;

    // 엔티티 병합
    for (const entity of (ext.entities || [])) {
      const normalizedName = normalizeName(entity.name);
      const existingIdx = findSimilarEntity(normalizedName, nameMap);
      const globalScenes = (entity.scenes || []).map((s: number) => localToGlobal[s] || s);

      if (existingIdx !== -1) {
        const existing = entities[existingIdx];
        if (entity.description && !existing.description?.includes(entity.description)) {
          existing.description = (existing.description || '') + ' ' + entity.description;
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
  return { entities, relationships, scenes, chapters };
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
  const firstPersonAliases = ['화자', '주인공', '나는', '내'];
  if (firstPersonAliases.includes(name.toLowerCase())) {
    return '나';
  }
  return name;
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

    // attributes.owner가 있으면 관계 생성
    if (attrOwner) {
      const ownerName = normalizeOwnerName(attrOwner);
      if (!hasRelationship(relationships, ownerName, entity.name) &&
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

    // location 엔티티면 위치 패턴 먼저 시도
    if (isLocation) {
      let foundMatch = false;
      for (const pattern of locationPatterns) {
        const match = desc.match(pattern);
        if (match) {
          const personName = normalizeOwnerName(match[1].trim());
          if (!hasRelationship(relationships, personName, entity.name) &&
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

    // 설명에서 소유자 패턴 찾기
    for (const pattern of ownerPatterns) {
      const match = desc.match(pattern);
      if (match) {
        const ownerName = normalizeOwnerName(match[1].trim());
        if (!hasRelationship(relationships, ownerName, entity.name) &&
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
    for (const charName of characterNames) {
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

  console.log(`[extraction] 후처리: ${newRelationships.length}개의 누락된 관계 추가됨`);

  return {
    ...normalized,
    relationships: [...relationships, ...newRelationships]
  };
}

// --- 지식 그래프 구축 ---

// 두 엔티티 간 기존 관계가 존재하는지 확인
function hasEdgeBetween(hyperedges: Record<string, HyperEdge>, id1: string, id2: string): boolean {
  return Object.values(hyperedges).some((edge) =>
    edge.entities.includes(id1) && edge.entities.includes(id2)
  );
}

// 카테고리 기반 관계 타입 추정
function inferRelationType(category: string): string {
  if (category === 'location') return '위치';
  if (category === 'item' || category === 'object') return '소유';
  return '관련';
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

      edgeCounter.value++;
      const id = formatId('H', edgeCounter.value);

      // 관계 타입 추정
      let relationType = '관련';
      if (entity.category === 'location' || otherEntity.category === 'location') {
        relationType = '위치';
      } else if (entity.category === 'item' || otherEntity.category === 'item') {
        relationType = '소유';
      }

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
        type: relationType,
        subtype: undefined,
        entities: [entity.id, otherEntity.id],
        statement: statementText || `${entity.name}의 설명에 ${otherEntity.name}이(가) 언급됨`,
        timeline: { start: undefined, chapter: 1 },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: true,
        scenes: commonScenes,
        sourceRef: { chapter: 1 },
      };

      console.log(`[extraction] 자동 관계 생성: ${entity.name} - ${otherEntity.name} (description 기반, 장면: ${commonScenes.join(', ')})`);
    }
  }
}

// 같은 장면에 등장하는 엔티티 쌍에 대해 자동 관계 생성
// newSceneIds: 이번에 새로 추가된 장면 ID들 (기존 그래프와 병합 시 새 장면만 전달)
function inferCoOccurrenceEdges(
  entities: Record<string, Entity>,
  hyperedges: Record<string, HyperEdge>,
  edgeCounter: { value: number },
  newSceneIds?: Set<string>
): void {
  const allEntities = Object.values(entities);
  const characterEntities = allEntities.filter(e => e.category === 'character');
  const nonCharacterEntities = allEntities.filter(e => e.category !== 'character');

  // 캐릭터-캐릭터 동시 등장
  for (let i = 0; i < characterEntities.length; i++) {
    const char1 = characterEntities[i];
    if (!char1.scenes?.length) continue;

    for (let j = i + 1; j < characterEntities.length; j++) {
      const char2 = characterEntities[j];
      if (!char2.scenes?.length) continue;

      // 공통 장면 계산
      let commonScenes = char1.scenes.filter((s: string) => char2.scenes!.includes(s));

      // 기존 그래프에 추가하는 경우: 새 장면 중 공통인 것만 사용
      if (newSceneIds && newSceneIds.size > 0) {
        commonScenes = commonScenes.filter(s => newSceneIds.has(s));
      }

      if (commonScenes.length === 0) continue;
      if (hasEdgeBetween(hyperedges, char1.id, char2.id)) continue;

      edgeCounter.value++;
      const id = formatId('H', edgeCounter.value);
      const sceneNums = commonScenes.map(sceneIdToReadable).join(', ');

      hyperedges[id] = {
        id,
        type: '관련',
        subtype: undefined,
        entities: [char1.id, char2.id],
        statement: `${char1.name}과(와) ${char2.name}이(가) 동일 장면에 등장 (장면 ${sceneNums})`,
        timeline: { start: undefined, chapter: 1 },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: true,
        scenes: commonScenes,
        sourceRef: { chapter: 1 },
      };

      console.log(`[extraction] 캐릭터 동시 등장 관계 생성: ${char1.name} ↔ ${char2.name} (장면: ${commonScenes.join(', ')})`);
    }
  }

  // 캐릭터-비캐릭터 동시 등장
  for (const entity of nonCharacterEntities) {
    if (!entity.scenes?.length) continue;

    for (const char of characterEntities) {
      if (!char.scenes?.length) continue;

      // 공통 장면 계산
      let commonScenes = entity.scenes.filter((s: string) => char.scenes!.includes(s));

      // 기존 그래프에 추가하는 경우: 새 장면 중 공통인 것만 사용
      if (newSceneIds && newSceneIds.size > 0) {
        commonScenes = commonScenes.filter(s => newSceneIds.has(s));
      }

      if (commonScenes.length === 0) continue;
      if (hasEdgeBetween(hyperedges, entity.id, char.id)) continue;

      edgeCounter.value++;
      const id = formatId('H', edgeCounter.value);
      const relationType = inferRelationType(entity.category);
      const sceneNums = commonScenes.map(sceneIdToReadable).join(', ');

      hyperedges[id] = {
        id,
        type: relationType,
        subtype: undefined,
        entities: [char.id, entity.id],
        statement: `${char.name}이(가) ${entity.name}에서/과 함께 등장 (장면 ${sceneNums})`,
        timeline: { start: undefined, chapter: 1 },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: false,
        scenes: commonScenes,
        sourceRef: { chapter: 1 },
      };

      console.log(`[extraction] 장면 공동 등장 관계 생성: ${char.name} -> ${entity.name} (${relationType}, 장면: ${commonScenes.join(', ')})`);
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

export function buildKnowledgeGraph(extracted: MergedExtraction, title: string, model?: string, fileNames?: string[], originalText?: string, existingGraph?: NovelKnowledgeGraph): NovelKnowledgeGraph {
  const now = new Date().toISOString();

  // 기존 그래프가 있으면 거기서 시작, 없으면 빈 값으로 시작
  const entities: Record<string, Entity> = existingGraph ? { ...existingGraph.entities } : {};
  const hyperedges: Record<string, HyperEdge> = existingGraph ? { ...existingGraph.hyperedges } : {};
  const nameToId: Record<string, string> = {};

  // 기존 장면의 최대 번호 추출 (새 장면 ID 계산용)
  let maxSceneNum = 0;
  if (existingGraph?.snapshots) {
    for (const sceneId of Object.keys(existingGraph.snapshots)) {
      const numMatch = sceneId.match(/S0*(\d+)/);
      if (numMatch) {
        maxSceneNum = Math.max(maxSceneNum, parseInt(numMatch[1], 10));
      }
    }
  }

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

  // 기존 엔티티의 이름 매핑 초기화
  for (const e of Object.values(entities)) {
    registerNameMapping(nameToId, e.name, e.id);
    for (const alias of (e.aliases || [])) {
      registerNameMapping(nameToId, alias, e.id);
    }
  }

  let entityCounter = Object.keys(entities).length;
  const edgeCounter = { value: Object.keys(hyperedges).length };

  // 엔티티 등록
  console.log(`[extraction] LLM 추출 엔티티 수: ${extracted.entities.length}개`);
  for (const e of extracted.entities) {
    const existingId = nameToId[e.name] || nameToId[e.name.toLowerCase()] || nameToId[normalizeName(e.name)];
    // 새 장면 ID로 변환 (sceneIdMapping 사용)
    const newSceneIds = (e.scenes || []).map((s: number) => sceneIdMapping[s] || formatId('S', s));

    if (existingId && entities[existingId]) {
      // 기존 엔티티에 정보 추가 - 새 장면 ID만 추가
      const existing = entities[existingId];
      existing.aliases = [...new Set([...(existing.aliases || []), ...(e.aliases || [])])];
      if (e.description && !existing.description?.includes(e.description)) {
        existing.description = ((existing.description || '') + ' ' + e.description).slice(0, 500);
      }
      // 기존 scenes에 새 장면 ID 추가 (중복 제거)
      const oldScenes = existing.scenes?.length || 0;
      existing.scenes = [...new Set([...(existing.scenes || []), ...newSceneIds])];
      console.log(`[extraction] 기존 엔티티 업데이트: ${e.name} (${existingId}), scenes: ${oldScenes}→${existing.scenes.length}`);
      continue;
    }

    entityCounter++;
    const id = formatId('E', entityCounter);
    entities[id] = {
      id,
      name: e.name,
      category: (e.category || 'character') as EntityCategory,
      aliases: e.aliases || [],
      description: e.description || '',
      attributes: (e.attributes || {}) as Record<string, unknown>,
      scenes: newSceneIds,
      firstMention: { chapter: 1 },
      importance: e.importance || 5,
    };
    console.log(`[extraction] 새 엔티티 생성: ${e.name} (${id}), category: ${e.category}, scenes: ${newSceneIds.join(',')}`);
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

    edgeCounter.value++;
    const id = formatId('H', edgeCounter.value);
    hyperedges[id] = {
      id,
      type: r.type,
      subtype: r.subtype,
      entities: [fromId, toId],
      statement: r.description || '',
      quote: r.quote,
      timeline: { start: r.start_time, chapter: 1 },
      sentiment: r.sentiment as HyperEdge['sentiment'],
      strength: r.strength,
      bidirectional: r.bidirectional,
      fromPerspective: r.from_perspective,
      toPerspective: r.to_perspective,
      scenes: sceneIds,
      sourceRef: { chapter: 1 },
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
  const timeline = (extracted.timeline || []).map((t: MergedTimelinePoint) => ({
    id: t.time_id || '',
    name: t.events?.[0] || t.time_expression || '',
    description: (t.events || []).join(', '),
    storyTime: t.time_expression || '',
    order: t.order,
    chapter: 1,
    entities: (t.characters || []).map((name: string) => nameToId[name]).filter(Boolean),
    edges: [],
  })).sort((a, b) => (a.order || 0) - (b.order || 0));

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
    stats: {
      totalEntities: Object.keys(entities).length,
      totalEdges: Object.keys(hyperedges).length,
      totalChapters: Object.keys(chapters).length,
      entitiesByCategory: entitiesByCategory as Record<EntityCategory, number>,
      edgesByType: edgesByType as Record<RelationType, number>,
    },
  };
}
