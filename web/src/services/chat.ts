/**
 * 소설 채팅 서비스
 * 지식 그래프와 원본 텍스트를 기반으로 질문에 답변
 */

import type { NovelKnowledgeGraph, Entity, HyperEdge } from '../types';
import { DEFAULT_MODEL } from '../types';
import { searchSimilarEntities, searchSimilarChunks, type ChunkSearchResult } from './embedding';

/**
 * LLM을 사용하여 질문에서 검색 키워드 추출
 */
async function extractKeywordsWithLLM(
  query: string,
  apiKey?: string
): Promise<string[]> {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',  // 빠르고 저렴한 모델
        messages: [
          {
            role: 'system',
            content: `당신은 소설 검색을 위한 키워드 추출기입니다.
사용자 질문에서 검색에 필요한 핵심 키워드를 추출하세요.

규칙:
1. 인물 이름, 물건 이름, 장소 이름, 사건명 등 명사 위주로 추출
2. "뭐야", "알려줘", "어떻게" 같은 질문 표현은 제외
3. JSON 배열 형식으로만 응답: ["키워드1", "키워드2", ...]
4. 최대 5개까지만 추출
5. 질문에 고유명사가 없으면 핵심 개념어를 추출

예시:
- "주인공이 얻은 검이 뭐야?" → ["주인공", "검"]
- "천마신공이 뭐야?" → ["천마신공"]
- "무림맹과 사파의 관계는?" → ["무림맹", "사파", "관계"]`
          },
          { role: 'user', content: query }
        ],
        apiKey,
        stream: false,
      }),
    });

    if (!response.ok) {
      console.warn('[extractKeywords] API 오류, 폴백 사용');
      return fallbackExtractKeywords(query);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // JSON 파싱 시도
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      const keywords = JSON.parse(match[0]);
      if (Array.isArray(keywords)) {
        console.log('[extractKeywords] LLM 추출:', keywords);
        return keywords.slice(0, 5);
      }
    }

    return fallbackExtractKeywords(query);
  } catch (err) {
    console.warn('[extractKeywords] 오류, 폴백 사용:', err);
    return fallbackExtractKeywords(query);
  }
}

/**
 * 폴백: 단순 키워드 추출 (LLM 실패 시)
 */
function fallbackExtractKeywords(query: string): string[] {
  const stopWords = new Set([
    '이', '가', '을', '를', '의', '에', '에서', '로', '으로', '와', '과', '도', '만', '까지',
    '은', '는', '뭐', '뭘', '무엇', '어떤', '어떻게', '왜', '누구', '언제', '어디',
    '해줘', '해', '줘', '알려줘', '설명해', '말해', '보여', '찾아',
    '있어', '없어', '하는', '되는', '인가', '인지', '뭐야', '거야',
  ]);

  const words = query
    .replace(/[?!.,]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  return [...new Set(words)].slice(0, 5);
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface ChatContext {
  knowledgeGraph: NovelKnowledgeGraph;
  originalText?: string;
}

/**
 * 질문에서 엔티티 ID 추출 (개선: 부분 매칭 + 유사어 지원)
 */
// 비슷한 의미의 단어 매핑 (동의어/유사어)
const SYNONYM_MAP: Record<string, string[]> = {
  '박스': ['상자', '박스', '골판지'],
  '상자': ['박스', '상자', '골판지'],
  '집': ['집', '거처', '잠자리', '보금자리'],
  '칼': ['칼', '검', '도검', '무기'],
  '검': ['칼', '검', '도검', '무기'],
};

function findMentionedEntityIds(
  query: string,
  entities: Record<string, Entity>
): string[] {
  const mentioned: string[] = [];
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 2);

  // 키워드 확장 (동의어 추가)
  const expandedQueryWords = new Set(queryWords);
  queryWords.forEach(word => {
    const synonyms = SYNONYM_MAP[word];
    if (synonyms) {
      synonyms.forEach(syn => expandedQueryWords.add(syn));
    }
  });

  Object.entries(entities).forEach(([id, entity]) => {
    const nameLower = entity.name.toLowerCase();

    // 1. 질문에 엔티티 이름이 포함됨 (정확히 일치)
    if (queryLower.includes(nameLower)) {
      mentioned.push(id);
      return;
    }

    // 2. 엔티티 이름에 질문 키워드가 포함됨 (부분 일치 - "새 박스"에서 "박스" 검색)
    if ([...expandedQueryWords].some(word => nameLower.includes(word))) {
      mentioned.push(id);
      return;
    }

    // 3. 별칭으로 검색
    if (entity.aliases?.some(alias => {
      const aliasLower = alias.toLowerCase();
      return queryLower.includes(aliasLower) ||
             [...expandedQueryWords].some(word => aliasLower.includes(word));
    })) {
      mentioned.push(id);
      return;
    }

    // 4. 설명에서 키워드 검색 (질문의 주요 단어가 설명에 있는지)
    if (entity.description) {
      const descLower = entity.description.toLowerCase();
      if ([...expandedQueryWords].some(word => descLower.includes(word) && word.length >= 2)) {
        // 너무 많이 매칭되지 않도록 제한
        if (mentioned.length < 20) {
          mentioned.push(id);
        }
      }
    }
  });

  return mentioned;
}

/**
 * 키워드 확장 (단순화 - LLM이 엔티티 목록에서 직접 찾도록 함)
 */
function expandKeywords(keywords: string[]): string[] {
  // 이제 시스템 프롬프트에 전체 엔티티 목록이 포함되므로
  // 복잡한 유사어 매핑 없이 원본 키워드만 반환
  return keywords;
}

/**
 * 일반적인 질문 패턴 감지 및 관련 컨텍스트 생성
 */
function detectQueryIntent(query: string): {
  wantsCharacters: boolean;
  wantsRelationships: boolean;
  wantsItems: boolean;
  wantsSummary: boolean;
  wantsLocations: boolean;
  wantsOrganizations: boolean;
  wantsEvents: boolean;
  wantsConcepts: boolean;
  wantsCategoryList: boolean;  // 카테고리 전체 목록 요청
  targetCategory: string | null;  // 요청된 특정 카테고리
  keywords: string[];
  expandedKeywords: string[];
} {
  const queryLower = query.toLowerCase();

  // 전체 목록 요청 패턴 (뭐있어, 알려줘, 목록, 전부 등)
  const listPatterns = ['뭐있', '뭐가있', '뭐 있', '알려줘', '알려줄래', '목록', '전부', '모두', '다 알려', '뭐가 있'];
  const wantsList = listPatterns.some(p => queryLower.includes(p));

  // 카테고리별 키워드 매핑
  const categoryKeywords: Record<string, string[]> = {
    character: ['등장인물', '인물', '캐릭터', '주인공', '사람', '누구누구'],
    item: ['아이템', '물건', '물품', '도구', '무기', '장비', '비법', '비급', '책', '보물'],
    location: ['장소', '지역', '곳', '위치', '마을', '도시', '산', '문파', '어디'],
    organization: ['조직', '단체', '문파', '세력', '가문', '파벌', '종파'],
    event: ['사건', '이벤트', '일', '무슨일'],
    concept: ['개념', '설정', '세계관', '규칙', '법칙', '비법', '무공', '기술', '능력'],
  };

  // 각 카테고리 감지
  const wantsCharacters = categoryKeywords.character.some(k => queryLower.includes(k));
  const wantsItems = categoryKeywords.item.some(k => queryLower.includes(k));
  const wantsLocations = categoryKeywords.location.some(k => queryLower.includes(k));
  const wantsOrganizations = categoryKeywords.organization.some(k => queryLower.includes(k));
  const wantsEvents = categoryKeywords.event.some(k => queryLower.includes(k));
  const wantsConcepts = categoryKeywords.concept.some(k => queryLower.includes(k));

  // 관계 관련 키워드
  const relationshipKeywords = ['관계', '사이', '어떤 관계', '어떻게 연결'];
  const wantsRelationships = relationshipKeywords.some(k => queryLower.includes(k));

  // 요약/전체 관련 키워드
  const summaryKeywords = ['요약', '줄거리', '내용', '전체', '설명해줘'];
  const wantsSummary = summaryKeywords.some(k => queryLower.includes(k));

  // 카테고리 목록 요청 감지 (예: "아이템 뭐있어?", "장소 알려줘")
  let targetCategory: string | null = null;
  if (wantsList) {
    if (wantsCharacters) targetCategory = 'character';
    else if (wantsItems) targetCategory = 'item';
    else if (wantsLocations) targetCategory = 'location';
    else if (wantsOrganizations) targetCategory = 'organization';
    else if (wantsEvents) targetCategory = 'event';
    else if (wantsConcepts) targetCategory = 'concept';
  }

  const wantsCategoryList = wantsList && targetCategory !== null;

  // 질문에서 핵심 키워드 추출 (2글자 이상)
  const stopWords = ['의미', '뭐야', '무엇', '어떤', '어떻게', '가', '이', '를', '의', '뭐있', '알려줘', '있어', '뭐가'];
  const keywords = queryLower
    .replace(/[?!.,]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.includes(w));

  // 유사어로 확장
  const expandedKeywords = expandKeywords(keywords);

  return {
    wantsCharacters,
    wantsRelationships,
    wantsItems,
    wantsSummary,
    wantsLocations,
    wantsOrganizations,
    wantsEvents,
    wantsConcepts,
    wantsCategoryList,
    targetCategory,
    keywords,
    expandedKeywords
  };
}

/**
 * 엔티티와 연결된 모든 관계 찾기
 */
function findConnectedEdges(
  entityIds: string[],
  hyperedges: Record<string, HyperEdge>
): HyperEdge[] {
  const entityIdSet = new Set(entityIds);
  return Object.values(hyperedges).filter(edge =>
    edge.entities.some(id => entityIdSet.has(id))
  );
}

/**
 * 두 엔티티 간의 직접 관계 찾기
 */
function findDirectRelations(
  entityIds: string[],
  hyperedges: Record<string, HyperEdge>
): HyperEdge[] {
  if (entityIds.length < 2) return [];

  const entityIdSet = new Set(entityIds);
  return Object.values(hyperedges).filter(edge =>
    // 엣지의 모든 엔티티가 언급된 엔티티에 포함되어야 함
    edge.entities.every(id => entityIdSet.has(id))
  );
}

/**
 * 지식 그래프에서 관련 정보 추출 (개선된 버전)
 * @param additionalEntityIds 임베딩 검색으로 찾은 추가 엔티티 ID들
 */
function extractRelevantContext(
  query: string,
  knowledgeGraph: NovelKnowledgeGraph,
  originalText?: string,
  additionalEntityIds?: string[]
): string {
  const contexts: string[] = [];
  const queryLower = query.toLowerCase();

  // 0. 질문 의도 분석
  const intent = detectQueryIntent(query);

  // 1. 질문에서 언급된 엔티티 찾기
  let mentionedEntityIds = findMentionedEntityIds(query, knowledgeGraph.entities);

  // 임베딩 검색 결과 추가
  if (additionalEntityIds && additionalEntityIds.length > 0) {
    additionalEntityIds.forEach(id => {
      if (!mentionedEntityIds.includes(id)) {
        mentionedEntityIds.push(id);
      }
    });
  }

  // 1-1. 확장된 키워드로 엔티티 이름/설명에서 검색 (부분 매칭)
  if (mentionedEntityIds.length === 0 && intent.expandedKeywords.length > 0) {
    Object.entries(knowledgeGraph.entities).forEach(([id, entity]) => {
      const nameLower = entity.name.toLowerCase();
      const descLower = (entity.description || '').toLowerCase();

      for (const keyword of intent.expandedKeywords) {
        if (nameLower.includes(keyword) || descLower.includes(keyword)) {
          if (!mentionedEntityIds.includes(id)) {
            mentionedEntityIds.push(id);
          }
          break;
        }
      }
    });
  }

  // 1-1-2. 여전히 못 찾았으면 hyperedge statement에서도 검색
  if (mentionedEntityIds.length === 0 && intent.expandedKeywords.length > 0) {
    const relatedEntityIds = new Set<string>();
    Object.values(knowledgeGraph.hyperedges).forEach(edge => {
      const statementLower = edge.statement.toLowerCase();
      if (intent.expandedKeywords.some(kw => statementLower.includes(kw))) {
        edge.entities.forEach(id => relatedEntityIds.add(id));
      }
    });
    mentionedEntityIds.push(...Array.from(relatedEntityIds).slice(0, 15));
  }

  // 1-2. 아이템 관련 질문인데 아직 못 찾았으면 item 카테고리에서 키워드 매칭
  if (intent.wantsItems && mentionedEntityIds.length === 0) {
    // 키워드와 관련된 아이템만 가져오기
    const itemEntities = Object.entries(knowledgeGraph.entities)
      .filter(([, e]) => {
        if (e.category !== 'item') return false;
        const nameLower = e.name.toLowerCase();
        const descLower = (e.description || '').toLowerCase();
        return intent.expandedKeywords.some(kw => nameLower.includes(kw) || descLower.includes(kw));
      })
      .slice(0, 10);

    // 키워드 매칭된 아이템이 없으면 전체 아이템 중 일부
    if (itemEntities.length === 0) {
      const allItems = Object.entries(knowledgeGraph.entities)
        .filter(([, e]) => e.category === 'item')
        .slice(0, 5);
      mentionedEntityIds.push(...allItems.map(([id]) => id));
    } else {
      mentionedEntityIds.push(...itemEntities.map(([id]) => id));
    }
  }

  // 1-3. 캐릭터 관련 질문이면 character 카테고리 추가
  if (intent.wantsCharacters) {
    const characterEntities = Object.entries(knowledgeGraph.entities)
      .filter(([, e]) => e.category === 'character')
      .slice(0, 15);
    characterEntities.forEach(([id]) => {
      if (!mentionedEntityIds.includes(id)) {
        mentionedEntityIds.push(id);
      }
    });
  }

  const mentionedEntities = mentionedEntityIds
    .map(id => knowledgeGraph.entities[id])
    .filter(Boolean);

  // 2. 언급된 엔티티들 간의 직접 관계 찾기 (가장 중요!)
  const directRelations = findDirectRelations(mentionedEntityIds, knowledgeGraph.hyperedges);

  // 3. 언급된 엔티티와 연결된 모든 관계 찾기
  const connectedEdges = findConnectedEdges(mentionedEntityIds, knowledgeGraph.hyperedges);

  // 4. 키워드 기반 추가 관계 검색 (질문 키워드로 statement 검색)
  const keywordEdges = Object.values(knowledgeGraph.hyperedges).filter(edge => {
    const statementLower = edge.statement.toLowerCase();
    const typeLower = edge.type.toLowerCase();

    // 전체 질문 매칭
    if (statementLower.includes(queryLower) || typeLower.includes(queryLower)) {
      return true;
    }

    // 키워드별 매칭
    return intent.keywords.some(keyword =>
      statementLower.includes(keyword) || typeLower.includes(keyword)
    );
  });

  // 4-1. 관계 질문이면 주요 관계들 포함
  let importantEdges: HyperEdge[] = [];
  if (intent.wantsRelationships && connectedEdges.length === 0) {
    importantEdges = Object.values(knowledgeGraph.hyperedges)
      .filter(e => e.strength && e.strength >= 7)
      .slice(0, 20);
  }

  // === 컨텍스트 구성 ===

  // 언급된 엔티티 정보
  if (mentionedEntities.length > 0) {
    contexts.push('## 질문에서 언급된 인물/엔티티');
    mentionedEntities.forEach(entity => {
      contexts.push(`### ${entity.name} (${entity.category})`);
      if (entity.description) {
        contexts.push(`- 설명: ${entity.description}`);
      }
      if (entity.aliases?.length) {
        contexts.push(`- 별칭: ${entity.aliases.join(', ')}`);
      }
      if (entity.attributes) {
        const attrs = Object.entries(entity.attributes)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join(', ');
        if (attrs) contexts.push(`- 속성: ${attrs}`);
      }
    });
  }

  // 직접 관계 (가장 중요)
  if (directRelations.length > 0) {
    contexts.push('\n## 언급된 인물들 간의 직접 관계');
    directRelations.forEach(edge => {
      const entityNames = edge.entities
        .map(id => knowledgeGraph.entities[id]?.name || id)
        .join(' ↔ ');
      contexts.push(`### [${edge.type}] ${entityNames}`);
      contexts.push(`- 설명: ${edge.statement}`);
      if (edge.sentiment) {
        contexts.push(`- 감정: ${edge.sentiment}`);
      }
      if (edge.strength) {
        contexts.push(`- 강도: ${edge.strength}/10`);
      }
      if (edge.scenes?.length) {
        const sceneInfo = edge.scenes.slice(0, 3).map(sceneId => {
          const scene = knowledgeGraph.snapshots[sceneId];
          return scene ? `${sceneId}(${scene.location || '?'})` : sceneId;
        }).join(', ');
        contexts.push(`- 등장 장면: ${sceneInfo}`);
      }
    });
  }

  // 연결된 다른 관계들
  const otherEdges = connectedEdges.filter(e => !directRelations.includes(e));
  if (otherEdges.length > 0) {
    contexts.push('\n## 관련 인물들의 다른 관계');
    otherEdges.slice(0, 15).forEach(edge => {
      const entityNames = edge.entities
        .map(id => knowledgeGraph.entities[id]?.name || id)
        .join(' ↔ ');
      contexts.push(`- [${edge.type}] ${entityNames}: ${edge.statement}`);
    });
  }

  // 키워드로 찾은 추가 관계
  const additionalEdges = keywordEdges.filter(e =>
    !directRelations.includes(e) && !otherEdges.includes(e)
  );
  if (additionalEdges.length > 0) {
    contexts.push('\n## 키워드 관련 추가 정보');
    additionalEdges.slice(0, 15).forEach(edge => {
      const entityNames = edge.entities
        .map(id => knowledgeGraph.entities[id]?.name || id)
        .join(' ↔ ');
      contexts.push(`- [${edge.type}] ${entityNames}: ${edge.statement}`);
    });
  }

  // 중요 관계 (관계 질문용)
  if (importantEdges.length > 0) {
    contexts.push('\n## 주요 관계');
    importantEdges.forEach(edge => {
      const entityNames = edge.entities
        .map(id => knowledgeGraph.entities[id]?.name || id)
        .join(' ↔ ');
      contexts.push(`- [${edge.type}] ${entityNames}: ${edge.statement} (강도: ${edge.strength}/10)`);
    });
  }

  // 관련 장면 찾기 (언급된 엔티티가 등장하는 장면)
  if (mentionedEntityIds.length > 0) {
    const relevantScenes = Object.values(knowledgeGraph.snapshots).filter(scene =>
      scene.charactersPresent?.some(id => mentionedEntityIds.includes(id))
    );

    if (relevantScenes.length > 0) {
      contexts.push('\n## 관련 장면');
      relevantScenes.slice(0, 8).forEach(scene => {
        const chars = scene.charactersPresent
          .map(id => knowledgeGraph.entities[id]?.name || id)
          .join(', ');
        contexts.push(`### ${scene.sceneId} (${scene.location || '?'}, ${scene.time || '?'})`);
        contexts.push(`- 등장: ${chars}`);
        if (scene.summary) {
          contexts.push(`- 요약: ${scene.summary}`);
        }
      });
    }
  }

  // 장(Chapter) 정보
  if (knowledgeGraph.chapters && Object.keys(knowledgeGraph.chapters).length > 0) {
    contexts.push('\n## 장 목록');
    Object.values(knowledgeGraph.chapters).slice(0, 20).forEach(chapter => {
      contexts.push(`- ${chapter.number}화: ${chapter.title}`);
    });
  }

  // 원본 텍스트에서 관련 부분 찾기
  if (originalText && mentionedEntities.length > 0) {
    const keywords = mentionedEntities.map(e => e.name);
    const lines = originalText.split('\n');
    const matchedLines: string[] = [];

    lines.forEach((line, idx) => {
      const lineLower = line.toLowerCase();
      if (keywords.some(kw => lineLower.includes(kw.toLowerCase()))) {
        const start = Math.max(0, idx - 1);
        const end = Math.min(lines.length, idx + 2);
        const context = lines.slice(start, end).join('\n');
        if (context.length < 500 && !matchedLines.includes(context)) {
          matchedLines.push(context);
        }
      }
    });

    if (matchedLines.length > 0) {
      contexts.push('\n## 원본 텍스트 발췌');
      matchedLines.slice(0, 5).forEach((excerpt, i) => {
        contexts.push(`\n### 발췌 ${i + 1}`);
        contexts.push('```');
        contexts.push(excerpt);
        contexts.push('```');
      });
    }
  }

  return contexts.join('\n');
}

interface QueryIntent {
  wantsCharacters: boolean;
  wantsRelationships: boolean;
  wantsItems: boolean;
  wantsSummary: boolean;
  wantsLocations: boolean;
  wantsOrganizations: boolean;
  wantsEvents: boolean;
  wantsConcepts: boolean;
  wantsCategoryList: boolean;
  targetCategory: string | null;
  keywords: string[];
  expandedKeywords: string[];
}

/**
 * 시스템 프롬프트 생성 (관련 엔티티만 포함)
 * @param foundEntityIds 검색으로 찾은 엔티티 ID들 (임베딩 + 키워드 매칭)
 * @param intent 질문 의도 (전체 목록 요청인지 판단용)
 */
function buildSystemPrompt(
  context: ChatContext,
  foundEntityIds: string[] = [],
  intent?: QueryIntent
): string {
  const { knowledgeGraph, originalText } = context;
  const title = knowledgeGraph.metadata.title;

  const entityCount = Object.keys(knowledgeGraph.entities).length;
  const characterCount = Object.values(knowledgeGraph.entities)
    .filter(e => e.category === 'character').length;

  let entitySection = '';
  let relationSection = '';

  // 카테고리 이름 매핑 (영어 → 한글)
  const categoryNames: Record<string, string> = {
    character: '등장인물',
    item: '아이템/물건',
    location: '장소',
    organization: '조직/단체',
    event: '사건',
    concept: '개념/설정',
    creature: '생물',
    time_period: '시간',
    status: '상태',
    emotion: '감정',
  };

  // 카테고리별 엔티티 그룹화 (공통 사용)
  const entitiesByCategory: Record<string, Entity[]> = {};
  Object.values(knowledgeGraph.entities).forEach(entity => {
    if (!entitiesByCategory[entity.category]) {
      entitiesByCategory[entity.category] = [];
    }
    entitiesByCategory[entity.category].push(entity);
  });

  // 1. 특정 카테고리 목록 요청 ("아이템 뭐있어?", "장소 알려줘")
  if (intent?.wantsCategoryList && intent.targetCategory) {
    const targetEntities = entitiesByCategory[intent.targetCategory] || [];
    const categoryName = categoryNames[intent.targetCategory] || intent.targetCategory;

    if (targetEntities.length > 0) {
      entitySection = `## ${categoryName} 목록 (${targetEntities.length}개)\n\n` +
        targetEntities.slice(0, 40).map(entity => {
          const lines = [`### ${entity.name}`];
          if (entity.description) lines.push(`- ${entity.description}`);
          return lines.join('\n');
        }).join('\n\n');

      if (targetEntities.length > 40) {
        entitySection += `\n\n... 외 ${targetEntities.length - 40}개`;
      }
    } else {
      entitySection = `${categoryName} 카테고리에 해당하는 항목이 없습니다.`;
    }

    // 해당 카테고리 엔티티들의 관계
    const targetIds = new Set(targetEntities.map(e => e.id));
    const relatedEdges = Object.values(knowledgeGraph.hyperedges)
      .filter(edge => edge.entities.some(id => targetIds.has(id)))
      .slice(0, 20);

    relationSection = relatedEdges.length > 0
      ? relatedEdges.map(edge => {
          const names = edge.entities.map(id => knowledgeGraph.entities[id]?.name || id).join(' ↔ ');
          return `- [${edge.type}] ${names}: ${edge.statement.slice(0, 60)}...`;
        }).join('\n')
      : '(관련 관계 없음)';

  // 2. 전체 요약 요청
  } else if (intent?.wantsSummary && foundEntityIds.length === 0) {
    entitySection = Object.entries(entitiesByCategory)
      .map(([category, entities]) => {
        const catName = categoryNames[category] || category;
        const names = entities.slice(0, 15).map(e => e.name).join(', ');
        const more = entities.length > 15 ? ` 외 ${entities.length - 15}개` : '';
        return `### ${catName} (${entities.length}개)\n${names}${more}`;
      }).join('\n\n');

    // 주요 관계
    const topRelations = Object.values(knowledgeGraph.hyperedges)
      .filter(e => e.strength && e.strength >= 6)
      .sort((a, b) => (b.strength || 0) - (a.strength || 0))
      .slice(0, 20);

    relationSection = topRelations.map(edge => {
      const names = edge.entities.map(id => knowledgeGraph.entities[id]?.name || id).join(' ↔ ');
      return `- [${edge.type}] ${names}: ${edge.statement.slice(0, 60)}...`;
    }).join('\n');

  // 3. 특정 엔티티 검색 결과가 있음
  } else if (foundEntityIds.length > 0) {
    // 특정 엔티티 검색 결과가 있음
    const foundEntities = foundEntityIds
      .map(id => knowledgeGraph.entities[id])
      .filter(Boolean);

    entitySection = foundEntities.map(entity => {
      const lines = [`### ${entity.name} (${entity.category})`];
      if (entity.description) lines.push(`설명: ${entity.description}`);
      if (entity.aliases?.length) lines.push(`별칭: ${entity.aliases.join(', ')}`);
      return lines.join('\n');
    }).join('\n\n');

    // 찾은 엔티티들과 관련된 관계만
    const entityIdSet = new Set(foundEntityIds);
    const relatedEdges = Object.values(knowledgeGraph.hyperedges)
      .filter(edge => edge.entities.some(id => entityIdSet.has(id)))
      .slice(0, 30);

    relationSection = relatedEdges.map(edge => {
      const names = edge.entities.map(id => knowledgeGraph.entities[id]?.name || id).join(' ↔ ');
      return `- [${edge.type}] ${names}: ${edge.statement}`;
    }).join('\n');

  } else {
    // 찾은 엔티티 없고 전체 목록도 아님
    const mainCharacters = Object.values(knowledgeGraph.entities)
      .filter(e => e.category === 'character')
      .slice(0, 10)
      .map(e => e.name)
      .join(', ');
    entitySection = `주요 등장인물: ${mainCharacters}`;
    relationSection = '(질문과 관련된 정보를 찾지 못했습니다)';
  }

  return `당신은 소설 "${title}"의 전문가입니다.

## 소설 정보
- 제목: ${title}
- 등장 인물: ${characterCount}명
- 총 엔티티: ${entityCount}개

## 질문과 관련된 엔티티
${entitySection}

## 관련 관계
${relationSection}

## 답변 규칙
1. **위에 제공된 엔티티와 관계 정보만 사용하여 답변하세요**
2. 제공된 정보에 없는 내용은 "해당 정보가 없습니다"라고 답변하세요
3. 답변은 한국어로 해주세요

${originalText ? `원본 텍스트가 ${originalText.length.toLocaleString()}자 있습니다.` : ''}`;
}

/**
 * 채팅 메시지 전송 (스트리밍)
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  context: ChatContext,
  model: string = DEFAULT_MODEL,
  onChunk?: (chunk: string) => void,
  graphId?: string
): Promise<string> {
  const userApiKey = typeof window !== 'undefined'
    ? localStorage.getItem('OPENROUTER_API_KEY') || ''
    : '';

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');

  // 🔍 사고 과정 로깅 (개발자 도구에서 확인 가능)
  console.group('🧠 채팅 사고 과정');
  console.log('📝 사용자 질문:', lastUserMessage?.content);

  // 질문 의도 분석
  const logIntent = lastUserMessage ? detectQueryIntent(lastUserMessage.content) : null;
  console.log('🎯 질문 의도 분석:', logIntent ? {
    캐릭터질문: logIntent.wantsCharacters,
    관계질문: logIntent.wantsRelationships,
    아이템질문: logIntent.wantsItems,
    요약질문: logIntent.wantsSummary,
    추출키워드: logIntent.keywords,
    확장키워드: logIntent.expandedKeywords,
  } : '(없음)');

  console.log('📊 지식 그래프 정보:', {
    제목: context.knowledgeGraph.metadata.title,
    엔티티수: Object.keys(context.knowledgeGraph.entities).length,
    관계수: Object.keys(context.knowledgeGraph.hyperedges).length,
    장면수: Object.keys(context.knowledgeGraph.snapshots).length,
  });

  // 질문에서 찾은 엔티티 (기존 방식)
  let foundEntityIds = lastUserMessage
    ? findMentionedEntityIds(lastUserMessage.content, context.knowledgeGraph.entities)
    : [];

  // 임베딩 기반 유사 엔티티 검색 (graphId가 있고, 기존 방식으로 못 찾았으면)
  let embeddingResults: { entityId: string; entityName: string; similarity: number }[] = [];
  let chunkResults: ChunkSearchResult[] = [];

  if (graphId && lastUserMessage && foundEntityIds.length === 0) {
    // LLM으로 키워드 추출
    const keywords = await extractKeywordsWithLLM(lastUserMessage.content, userApiKey || undefined);
    console.log('🔎 LLM 추출 키워드:', keywords);

    if (keywords.length > 0) {
      // 엔티티 임베딩 검색 + 청크 임베딩 검색 병렬 실행
      const [entityResults, chunks] = await Promise.all([
        searchSimilarEntities(graphId, keywords, userApiKey || undefined, 10),
        searchSimilarChunks(graphId, lastUserMessage.content, userApiKey || undefined, 3),
      ]);

      embeddingResults = entityResults;
      chunkResults = chunks;

      console.log('🎯 임베딩 검색 결과:', embeddingResults.map(r => `${r.entityName} (${(r.similarity * 100).toFixed(1)}%)`));
      console.log('📄 청크 검색 결과:', chunkResults.map(c => `청크${c.chunkIndex} (${(c.similarity * 100).toFixed(1)}%)`));

      // 유사도 높은 엔티티 ID 추가
      embeddingResults.forEach(result => {
        if (!foundEntityIds.includes(result.entityId)) {
          foundEntityIds.push(result.entityId);
        }
      });
    }
  }

  const foundEntities = foundEntityIds.map(id => context.knowledgeGraph.entities[id]?.name).filter(Boolean);
  console.log('🔍 최종 찾은 엔티티:', foundEntities.length > 0 ? foundEntities : '(없음)');

  // 관련 관계
  const relatedEdges = findConnectedEdges(foundEntityIds, context.knowledgeGraph.hyperedges);
  console.log('🔗 관련 관계:', relatedEdges.length > 0
    ? relatedEdges.slice(0, 10).map(e => `[${e.type}] ${e.entities.map(id => context.knowledgeGraph.entities[id]?.name || id).join(' ↔ ')}`)
    : '(없음)');

  // 컨텍스트 생성 (임베딩으로 찾은 엔티티도 포함)
  let relevantContext = lastUserMessage
    ? extractRelevantContext(lastUserMessage.content, context.knowledgeGraph, context.originalText, foundEntityIds)
    : '';

  // 청크 검색 결과 추가
  if (chunkResults.length > 0) {
    relevantContext += '\n\n## 관련 원본 텍스트 (임베딩 검색)\n';
    chunkResults.forEach((chunk, i) => {
      const sourceInfo = chunk.sourceFile ? ` (${chunk.sourceFile})` : '';
      const chapterInfo = chunk.chapterTitle ? ` [${chunk.chapterTitle}]` : '';
      relevantContext += `\n### 발췌 ${i + 1}${sourceInfo}${chapterInfo}\n`;
      relevantContext += '```\n';
      // 청크 내용 (너무 길면 자름)
      relevantContext += chunk.content.slice(0, 1000);
      if (chunk.content.length > 1000) relevantContext += '\n... (생략)';
      relevantContext += '\n```\n';
    });
  }

  console.log('📄 생성된 컨텍스트 (LLM에 전달):\n', relevantContext || '(컨텍스트 없음)');
  console.groupEnd();

  const apiMessages = [
    { role: 'system', content: buildSystemPrompt(context, foundEntityIds, logIntent || undefined) },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.role === 'user' && m === lastUserMessage
        ? `${m.content}\n\n---\n[참고 컨텍스트]\n${relevantContext}`
        : m.content
    }))
  ];

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      apiKey: userApiKey,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API 오류: ${response.status}`);
  }

  if (onChunk && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              onChunk(content);
            }
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }
    }

    return fullContent;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 고유 ID 생성
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
