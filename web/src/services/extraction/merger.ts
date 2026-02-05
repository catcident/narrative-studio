/**
 * 지식 그래프 추출 서비스 — 결과 병합 및 후처리
 */

import type { NovelKnowledgeGraph } from '../../types';
import { CATEGORY_NAMES } from './types';

// 이름 정규화 (공백, 호칭 제거)
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(씨|님|군|양|선생|사장|부장|과장|대리|사원)$/g, '');
}

// 비슷한 엔티티 찾기
export function findSimilarEntity(name: string, nameMap: Record<string, number>, _entities: any[]): number {
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

// 여러 청크 결과를 병합 (같은 인물 판단 + 장면 번호 글로벌화)
export function mergeExtractions(extractions: any[]): any {
  const entities: any[] = [];
  const relationships: any[] = [];
  const scenes: any[] = [];
  const chapters: any[] = [];
  const chapterMap: Record<string, number> = {}; // 장 제목 -> id 매핑
  const nameMap: Record<string, number> = {}; // 이름 -> entities 인덱스

  let globalSceneOffset = 0;

  console.log(`[병합] 총 ${extractions.length}개 청크 결과 병합 시작`);

  for (let chunkIdx = 0; chunkIdx < extractions.length; chunkIdx++) {
    const ext = extractions[chunkIdx];
    console.log(`[병합] 청크 ${chunkIdx + 1}: entities=${(ext.entities || []).length}, relationships=${(ext.relationships || []).length}, scenes=${(ext.scenes || []).length}`);

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

  console.log(`[병합 완료] 최종 entities=${entities.length}, relationships=${relationships.length}, scenes=${scenes.length}, chapters=${chapters.length}`);
  console.log(`[병합 완료] 인물 목록: ${entities.filter(e => e.category === 'character').map(e => e.name).join(', ')}`);
  return { entities, relationships, scenes, chapters };
}

// 허용된 관계 타입
const VALID_RELATION_TYPES = ['가족', '연인', '친구', '적대', '동료', '소속', '위치', '소유', '포함', '관련'];

// 잘못된 관계 타입을 올바른 타입으로 매핑
const RELATION_TYPE_MAPPING: Record<string, string> = {
  // 가족 관련
  '부모': '가족', '자녀': '가족', '형제': '가족', '자매': '가족', '친척': '가족',
  '아버지': '가족', '어머니': '가족', '아들': '가족', '딸': '가족', '할머니': '가족', '할아버지': '가족',
  // 연인 관련
  '사랑': '연인', '짝사랑': '연인', '애인': '연인', '전연인': '연인', '결혼': '연인',
  // 친구 관련
  '지인': '친구', '아는사이': '친구', '친한사이': '친구', '우정': '친구',
  '아친구이': '친구', // 잘못 생성된 예시
  // 적대 관련
  '원수': '적대', '라이벌': '적대', '갈등': '적대', '경쟁': '적대', '싸움': '적대',
  // 동료 관련
  '직장동료': '동료', '팀원': '동료', '동기': '동료', '선배': '동료', '후배': '동료',
  // 영어 타입 (하위호환)
  'family': '가족', 'romantic': '연인', 'friendship': '친구', 'rivalry': '적대',
  'mentor': '동료', 'subordinate': '동료', 'belongs_to': '소속', 'owns': '소유',
  'located_at': '위치', 'related_to': '관련', 'related': '관련',
};

/**
 * 관계 타입 정규화 - 잘못된 타입을 올바른 타입으로 변환
 */
function normalizeRelationType(type: string): string {
  if (!type) return '관련';

  const trimmed = type.trim();

  // 이미 유효한 타입이면 그대로 반환
  if (VALID_RELATION_TYPES.includes(trimmed)) {
    return trimmed;
  }

  // 매핑에서 찾기
  const mapped = RELATION_TYPE_MAPPING[trimmed] || RELATION_TYPE_MAPPING[trimmed.toLowerCase()];
  if (mapped) {
    console.log(`관계 타입 정규화: "${trimmed}" → "${mapped}"`);
    return mapped;
  }

  // 부분 매칭 시도
  for (const [key, value] of Object.entries(RELATION_TYPE_MAPPING)) {
    if (trimmed.includes(key) || key.includes(trimmed)) {
      console.log(`관계 타입 정규화 (부분매칭): "${trimmed}" → "${value}"`);
      return value;
    }
  }

  // 매핑 실패 시 기본값
  console.log(`관계 타입 정규화 실패: "${trimmed}" → "관련"`);
  return '관련';
}

/**
 * 모든 관계의 타입을 정규화
 */
function normalizeAllRelationTypes(extracted: any): any {
  const { relationships, ...rest } = extracted;

  const normalizedRelationships = (relationships || []).map((rel: any) => ({
    ...rel,
    type: normalizeRelationType(rel.type)
  }));

  return { ...rest, relationships: normalizedRelationships };
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

/**
 * 후처리: 엔티티 설명에서 누락된 관계 자동 생성
 * "화자가 피우는 담배" 같은 설명에서 소유 관계를 추출
 * "화자가 걷는 길" 같은 설명에서 위치 관계를 추출
 */
export function inferMissingRelationships(extracted: any): any {
  // 먼저 관계 타입 정규화
  const normalized = normalizeAllRelationTypes(extracted);
  const { entities, relationships } = normalized;
  const newRelationships: any[] = [];

  // 엔티티 이름 목록 (인물만)
  const characterNames = entities
    .filter((e: any) => e.category === 'character')
    .map((e: any) => e.name);

  // 소유자/사용자 패턴 (소유 관계)
  const ownerPatterns = [
    /^(.+?)(?:가|이|의)\s*(?:피우는|먹는|마시는|쓰는|타는|가진|입는|쓰던|읽는|보는|사용하는|운전하는|타고\s*다니는|가지고\s*있는)/,
    /^(.+?)의\s+/,  // "~의 물건" 패턴
  ];

  // 위치 패턴 (위치 관계) - location 엔티티용
  const locationPatterns = [
    /^(.+?)(?:가|이)\s*(?:걷는|걸어가는|지나가는|다니는|있는|가는|오는|서\s*있는|앉아\s*있는|누워\s*있는)/,
    /^(.+?)(?:가|이)\s*(?:사는|거주하는|일하는|근무하는|다니는)/,
  ];

  for (const entity of entities) {
    if (entity.category === 'character') continue; // 인물은 스킵

    const desc = entity.description || '';
    const attrOwner = entity.attributes?.owner;
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
          let personName = match[1].trim();
          personName = normalizeOwnerName(personName);

          // 이미 관계가 있는지 확인
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
            console.log(`위치 관계 추론: "${personName}" -> "${entity.name}" (${desc})`);
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
        let ownerName = match[1].trim();
        ownerName = normalizeOwnerName(ownerName);

        // 이미 관계가 있는지 확인
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
        break; // 첫 번째 매칭만 사용
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
          console.log(`설명 기반 관계 추론: "${charName}" -> "${entity.name}"`);
        }
      }
    }
  }

  console.log(`후처리: ${newRelationships.length}개의 누락된 관계 추가됨`);

  return {
    ...normalized,
    relationships: [...relationships, ...newRelationships]
  };
}

export function buildKnowledgeGraph(extracted: any, title: string, model?: string, fileName?: string, originalText?: string, existingGraph?: NovelKnowledgeGraph): NovelKnowledgeGraph {
  const now = new Date().toISOString();

  // 기존 그래프가 있으면 거기서 시작, 없으면 빈 값으로 시작
  const entities: Record<string, any> = existingGraph ? { ...existingGraph.entities } : {};
  const hyperedges: Record<string, any> = existingGraph ? { ...existingGraph.hyperedges } : {};
  const nameToId: Record<string, string> = {};

  // 기존 엔티티의 이름 매핑 초기화
  Object.values(entities).forEach((e: any) => {
    nameToId[e.name] = e.id;
    nameToId[e.name.toLowerCase()] = e.id;
    nameToId[normalizeName(e.name)] = e.id;
    (e.aliases || []).forEach((alias: string) => {
      nameToId[alias] = e.id;
      nameToId[alias.toLowerCase()] = e.id;
      nameToId[normalizeName(alias)] = e.id;
    });
  });

  // 기존 카운터 (기존 데이터가 있으면 이어서)
  let entityCounter = Object.keys(entities).length;
  let edgeCounter = Object.keys(hyperedges).length;
  let chapterCounter = existingGraph ? Object.keys(existingGraph.chapters || {}).length : 0;
  let sceneCounter = existingGraph ? Object.keys(existingGraph.snapshots || {}).length : 0;

  // 엔티티 등록
  (extracted.entities || []).forEach((e: any) => {
    // 기존에 같은 이름의 엔티티가 있는지 확인
    const existingId = nameToId[e.name] || nameToId[e.name.toLowerCase()] || nameToId[normalizeName(e.name)];

    if (existingId && entities[existingId]) {
      // 기존 엔티티에 정보 추가
      const existing = entities[existingId];
      // 별칭 병합
      existing.aliases = [...new Set([...(existing.aliases || []), ...(e.aliases || [])])];
      // 설명 추가
      if (e.description && !existing.description?.includes(e.description)) {
        existing.description = (existing.description + ' ' + e.description).slice(0, 500);
      }
      // 장면 병합 (새 장면 번호는 나중에 처리)
      return; // 새 엔티티 생성 안함
    }

    entityCounter++;
    const id = `E${String(entityCounter).padStart(4, '0')}`;
    // scenes를 숫자에서 문자열 ID로 변환 (기존 장면 수에 더해서)
    const sceneIds = (e.scenes || []).map((s: number) => `S${String(s + sceneCounter).padStart(4, '0')}`);
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
  (extracted.relationships || []).forEach((r: any) => {
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

    // 기존에 같은 관계가 있는지 확인
    const existingEdge = Object.values(hyperedges).find((e: any) =>
      e.type === r.type &&
      e.entities.includes(fromId) &&
      e.entities.includes(toId)
    );

    // scenes를 숫자에서 문자열 ID로 변환 (기존 장면 수에 더해서)
    const sceneIds = (r.scenes || []).map((s: number) => `S${String(s + sceneCounter).padStart(4, '0')}`);

    if (existingEdge) {
      // 기존 관계에 장면만 추가
      existingEdge.scenes = [...new Set([...(existingEdge.scenes || []), ...sceneIds])];
      return;
    }

    edgeCounter++;
    const id = `H${String(edgeCounter).padStart(4, '0')}`;
    hyperedges[id] = {
      id,
      type: r.type,
      subtype: r.subtype,
      entities: [fromId, toId],
      statement: r.description,
      quote: r.quote,  // 원문 인용
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

  // description에서 다른 엔티티 언급을 찾아 자동 관계 생성
  // edgeCounter는 이미 위에서 관계 등록 시 업데이트됨
  Object.values(entities).forEach((entity: any) => {
    if (!entity.description) return;

    const descLower = entity.description.toLowerCase();

    // 다른 모든 엔티티를 검사해서 description에 언급되어 있는지 확인
    Object.values(entities).forEach((otherEntity: any) => {
      if (entity.id === otherEntity.id) return;

      // 이름이나 별칭이 description에 포함되어 있는지 확인
      const namesToCheck = [otherEntity.name, ...(otherEntity.aliases || [])];
      const isMentioned = namesToCheck.some((name: string) =>
        descLower.includes(name.toLowerCase())
      );

      if (!isMentioned) return;

      // 이미 관계가 존재하는지 확인
      const existingEdge = Object.values(hyperedges).find((edge: any) =>
        (edge.entities.includes(entity.id) && edge.entities.includes(otherEntity.id))
      );

      if (existingEdge) return; // 이미 관계 있음

      // 새 관계 생성
      edgeCounter++;
      const id = `H${String(edgeCounter).padStart(4, '0')}`;

      // 관계 타입 추정
      let relationType = 'related';
      if (entity.category === 'location' || otherEntity.category === 'location') {
        relationType = 'location';
      } else if (entity.category === 'object' || otherEntity.category === 'object') {
        relationType = 'ownership';
      }

      // statement에 실제 description 내용을 포함
      // description에서 해당 인물/엔티티가 언급된 부분을 추출
      let statementText = entity.description;
      // description이 너무 길면 축약
      if (statementText && statementText.length > 200) {
        // 다른 엔티티 이름이 포함된 문장만 추출 시도
        const sentences = statementText.split(/[.!?。]/).filter((s: string) => s.trim());
        const relevantSentences = sentences.filter((s: string) =>
          namesToCheck.some((name: string) => s.toLowerCase().includes(name.toLowerCase()))
        );
        if (relevantSentences.length > 0) {
          statementText = relevantSentences.join('. ').trim();
        } else {
          statementText = statementText.slice(0, 200) + '...';
        }
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
        scenes: entity.scenes || [],
        sourceRef: { chapter: 1 },
      };

      console.log(`자동 관계 생성: ${entity.name} - ${otherEntity.name} (description 기반)`);
    });
  });

  // 같은 장면에 등장하는 캐릭터-캐릭터 간 자동 관계 생성 (2번 후처리)
  // LLM이 관계를 추출하지 못한 경우, 같은 장면에 등장하면 "관련" 관계 자동 생성
  const characterEntities = Object.values(entities).filter((e: any) => e.category === 'character');

  for (let i = 0; i < characterEntities.length; i++) {
    const char1 = characterEntities[i] as any;
    if (!char1.scenes || char1.scenes.length === 0) continue;

    for (let j = i + 1; j < characterEntities.length; j++) {
      const char2 = characterEntities[j] as any;
      if (!char2.scenes || char2.scenes.length === 0) continue;

      // 공통 장면 찾기
      const commonScenes = char1.scenes.filter((s: string) => char2.scenes.includes(s));
      if (commonScenes.length === 0) continue;

      // 이미 관계가 존재하는지 확인
      const existingEdge = Object.values(hyperedges).find((edge: any) =>
        edge.entities.includes(char1.id) && edge.entities.includes(char2.id)
      );

      if (existingEdge) continue; // 이미 관계 있음

      // 새 관계 생성
      edgeCounter++;
      const id = `H${String(edgeCounter).padStart(4, '0')}`;

      hyperedges[id] = {
        id,
        type: '관련',
        subtype: undefined,
        entities: [char1.id, char2.id],
        statement: `${char1.name}과(와) ${char2.name}이(가) 동일 장면에 등장 (장면 ${commonScenes.map((s: string) => s.replace('S', '').replace(/^0+/, '')).join(', ')})`,
        timeline: { start: undefined, chapter: 1 },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: true,
        scenes: commonScenes,
        sourceRef: { chapter: 1 },
      };

      console.log(`캐릭터 동시 등장 관계 생성: ${char1.name} ↔ ${char2.name} (장면: ${commonScenes.join(', ')})`);
    }
  }

  // 같은 장면에 등장하는 캐릭터-비캐릭터 엔티티 간 자동 관계 생성
  // 예: "콘크리트"와 "나"가 둘 다 장면 2에 등장하면 위치 관계 생성
  const nonCharacterEntities = Object.values(entities).filter((e: any) => e.category !== 'character');

  nonCharacterEntities.forEach((entity: any) => {
    if (!entity.scenes || entity.scenes.length === 0) return;

    // 이 엔티티와 같은 장면에 등장하는 캐릭터들 찾기
    characterEntities.forEach((char: any) => {
      if (!char.scenes || char.scenes.length === 0) return;

      // 공통 장면이 있는지 확인
      const commonScenes = entity.scenes.filter((s: string) => char.scenes.includes(s));
      if (commonScenes.length === 0) return;

      // 이미 관계가 존재하는지 확인
      const existingEdge = Object.values(hyperedges).find((edge: any) =>
        edge.entities.includes(entity.id) && edge.entities.includes(char.id)
      );

      if (existingEdge) return; // 이미 관계 있음

      // 새 관계 생성
      edgeCounter++;
      const id = `H${String(edgeCounter).padStart(4, '0')}`;

      // 관계 타입 추정
      let relationType = '관련';
      if (entity.category === 'location') {
        relationType = '위치';
      } else if (entity.category === 'item' || entity.category === 'object') {
        relationType = '소유';
      }

      hyperedges[id] = {
        id,
        type: relationType,
        subtype: undefined,
        entities: [char.id, entity.id],
        statement: `${char.name}이(가) ${entity.name}에서/과 함께 등장 (장면 ${commonScenes.map((s: string) => s.replace('S', '').replace(/^0+/, '')).join(', ')})`,
        timeline: { start: undefined, chapter: 1 },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: false,
        scenes: commonScenes,
        sourceRef: { chapter: 1 },
      };

      console.log(`장면 공동 등장 관계 생성: ${char.name} -> ${entity.name} (${relationType}, 장면: ${commonScenes.join(', ')})`);
    });
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

  // 장(Chapter) 정보 처리 - 기존 그래프가 있으면 포함
  const chapters: Record<string, any> = existingGraph ? { ...existingGraph.chapters } : {};

  // 새 장 정보 추가 (번호 이어서)
  (extracted.chapters || []).forEach((c: any) => {
    chapterCounter++;
    const chapterId = `C${String(chapterCounter).padStart(4, '0')}`;
    chapters[chapterId] = {
      id: chapterId,
      number: chapterCounter,
      title: c.title || `제${chapterCounter}장`,
      summary: c.summary || '',
    };
  });

  // 새 장 정보를 위한 번호 매핑 (extracted의 장 번호 -> 실제 장 번호)
  let newChapterNumber = chapterCounter;

  // 장이 없고 파일명이 있으면 파일명에서 장 정보 추출
  if ((extracted.chapters || []).length === 0 && fileName) {
    // 새 장 생성 (기존 장 개수 + 1)
    chapterCounter++;
    newChapterNumber = chapterCounter;

    // 파일명에서 확장자 제거한 것을 제목으로 사용
    const chapterTitle = fileName.replace(/\.[^/.]+$/, '');
    const chapterId = `C${String(chapterCounter).padStart(4, '0')}`;
    chapters[chapterId] = {
      id: chapterId,
      number: chapterCounter,
      title: chapterTitle,
      summary: '',
    };

    // 모든 장면에 이 장 번호 할당
    (extracted.scenes || []).forEach((s: any) => {
      s.chapter = chapterCounter;
    });
  }

  // 장면(Scene)을 snapshots로 - 기존 그래프가 있으면 포함
  const snapshots: Record<string, any> = existingGraph ? { ...existingGraph.snapshots } : {};

  (extracted.scenes || []).forEach((s: any) => {
    // 장면 번호를 기존 것에 이어서
    const actualSceneNum = s.id + sceneCounter;
    const sceneId = `S${String(actualSceneNum).padStart(4, '0')}`;

    // 장 번호도 기존 것에 이어서
    const actualChapterNum = s.chapter ? (s.chapter + (existingGraph ? Object.keys(existingGraph.chapters || {}).length : 0)) : newChapterNumber;
    const chapterId = actualChapterNum ? `C${String(actualChapterNum).padStart(4, '0')}` : null;

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
      order: actualSceneNum,
      chapter: chapterId,
      chapterNumber: actualChapterNum,
      time: s.time || `장면 ${actualSceneNum}`,
      timeElapsed: s.time_elapsed || null,  // 이전 장면으로부터 경과 시간
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

  // 소스 파일 정보 생성 - 기존 파일 목록에 추가
  const existingSourceFiles = existingGraph?.metadata?.sourceFiles || [];
  const newSourceFile = (fileName && originalText) ? {
    id: `F${String(existingSourceFiles.length + 1).padStart(4, '0')}`,
    fileName,
    uploadedAt: now,
    text: originalText,
    charCount: originalText.length,
  } : null;
  const sourceFiles = newSourceFile ? [...existingSourceFiles, newSourceFile] : existingSourceFiles;

  // 기존 타임라인과 병합
  const mergedTimeline = existingGraph ? [...(existingGraph.timeline || []), ...timeline] : timeline;

  return {
    metadata: {
      // 기존 메타데이터 유지 (제목, 작가 등)
      ...(existingGraph?.metadata || {}),
      title: existingGraph?.metadata?.title || title,  // 기존 제목 유지
      createdAt: existingGraph?.metadata?.createdAt || now,
      updatedAt: now,
      version: '1.0.0',
      model: existingGraph?.metadata?.model || model,  // 기존 모델 유지
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
      entitiesByCategory: entitiesByCategory as any,
      edgesByType: edgesByType as any,
    },
  };
}
