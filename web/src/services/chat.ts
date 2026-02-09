/**
 * 소설 채팅 서비스
 * 지식 그래프와 원본 텍스트를 기반으로 질문에 답변
 */

import type { NovelKnowledgeGraph, Entity, HyperEdge, ModelInfo, ChunkUsage } from '../types';
import { DEFAULT_MODEL, DEFAULT_CREDITS_PER_CHAT } from '../types';
import { searchSimilarEntities, searchSimilarChunks, type ChunkSearchResult } from './embedding';
import { CHUNK_SIZE } from '@/lib/modelCosts';
import { getApiKey } from './extraction/types';
import { findModel } from './billing';

// ==================== Billing 타입 ====================

/** 개별 LLM 호출의 billing 정보 (서버 _billing 필드 — 토큰 정보만) */
interface CallBilling {
  prompt_tokens: number;
  completion_tokens: number;
  model: string;
  byok?: boolean;
}

/** 채팅 메시지 전체의 합산 billing (토큰 사용량 집계) */
export interface ChatMessageBilling {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  byok: boolean;
}

/** sendChatMessage 반환 타입 */
export interface ChatResult {
  content: string;
  billing: ChatMessageBilling | null;
  /** settle에 사용할 청크별 토큰 사용량 (hold/settle 패턴용) */
  chunkUsages: ChunkUsage[];
}

/** 대화 이력 토큰 제한 (약 30K tokens) */
const MAX_HISTORY_CHARS = 45000;

/** LLM 응답에서 content 텍스트 추출 */
function extractLlmContent(data: Record<string, unknown>): string {
  return (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ?? '';
}

/** LLM 응답 content에서 JSON 객체 추출 (실패 시 null) */
function parseJsonFromLlmContent(content: string): Record<string, unknown> | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * LLM 의도 분석 결과 타입
 */
interface LLMQueryAnalysis {
  keywords: string[];           // 검색 키워드
  wantsCategoryList: boolean;   // 카테고리 전체 목록 요청 여부
  targetCategory: string | null; // 요청된 카테고리 (character/item/location/organization/event/concept)
}

/**
 * LLM을 사용하여 질문 의도 분석 (키워드 추출 + 카테고리 요청 판단)
 */
async function analyzeQueryWithLLM(
  query: string,
  apiKey?: string
): Promise<{ analysis: LLMQueryAnalysis; billing: CallBilling | null }> {
  const defaultResult: LLMQueryAnalysis = {
    keywords: fallbackExtractKeywords(query),
    wantsCategoryList: false,
    targetCategory: null,
  };

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'system',
            content: `당신은 소설 Q&A 시스템의 질문 분석기입니다.
사용자 질문을 분석하여 JSON으로 응답하세요.

분석 항목:
1. keywords: 검색에 필요한 핵심 키워드 (인물명, 물건명, 장소명, 사건명 등). 최대 5개. 질문 표현("뭐야", "알려줘" 등)은 제외.
2. wantsCategoryList: 특정 카테고리의 전체 목록을 요청하는지 (true/false)
3. targetCategory: 요청된 카테고리. 다음 중 하나만: character(인물), item(물건/아이템), location(장소), organization(조직/단체), event(사건), concept(개념/설정/무공/기술). 목록 요청이 아니면 null.

응답 형식 (JSON만):
{"keywords": ["키워드1"], "wantsCategoryList": false, "targetCategory": null}

예시:
- "장소는 뭐뭐가 있어?" → {"keywords": [], "wantsCategoryList": true, "targetCategory": "location"}
- "김철수가 누구야?" → {"keywords": ["김철수"], "wantsCategoryList": false, "targetCategory": null}
- "주인공과 검은 고양이 관계" → {"keywords": ["주인공", "검은 고양이"], "wantsCategoryList": false, "targetCategory": null}
- "등장인물 이름만 나열해줘" → {"keywords": [], "wantsCategoryList": true, "targetCategory": "character"}`
          },
          { role: 'user', content: query }
        ],
        apiKey,
        stream: false,
        idempotency_key: crypto.randomUUID(),
      }),
    });

    if (!response.ok) {
      console.warn('[analyzeQuery] API 오류, 폴백 사용');
      return { analysis: defaultResult, billing: null };
    }

    const data = await response.json();
    const callBilling: CallBilling | null = data._billing ?? null;
    const content = extractLlmContent(data);
    const parsed = parseJsonFromLlmContent(content);

    if (parsed) {
      const result: LLMQueryAnalysis = {
        keywords: Array.isArray(parsed.keywords) ? (parsed.keywords as string[]).slice(0, 5) : [],
        wantsCategoryList: !!parsed.wantsCategoryList,
        targetCategory: (parsed.targetCategory as string) ?? null,
      };
      console.log('[analyzeQuery] LLM 분석 결과:', result);
      return { analysis: result, billing: callBilling };
    }

    return { analysis: defaultResult, billing: callBilling };
  } catch (err: unknown) {
    console.warn('[analyzeQuery] 오류, 폴백 사용:', err);
    return { analysis: defaultResult, billing: null };
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

/**
 * LLM 선별 결과 타입
 */
interface SelectionResult {
  selectedEntityIds: string[];
  selectedChunkIndices: number[];
}

/**
 * LLM을 사용하여 질문에 필요한 노드/청크 선별
 */
async function selectRelevantData(
  query: string,
  entities: { id: string; name: string; category: string; description?: string }[],
  chunks: { index: number; preview: string }[],
  apiKey?: string
): Promise<{ selection: SelectionResult; billing: CallBilling | null }> {
  // 선별할 데이터가 적으면 그냥 전부 반환 (LLM 호출 스킵 → billing 없음)
  if (entities.length <= 10 && chunks.length <= 3) {
    return {
      selection: {
        selectedEntityIds: entities.map(e => e.id),
        selectedChunkIndices: chunks.map(c => c.index),
      },
      billing: null,
    };
  }

  try {
    // 엔티티 목록 문자열 생성
    const entityList = entities.slice(0, 50).map(e =>
      `- [${e.id}] ${e.name} (${e.category})${e.description ? ': ' + e.description.slice(0, 50) : ''}`
    ).join('\n');

    // 청크 목록 문자열 생성
    const chunkList = chunks.map(c =>
      `- [청크${c.index}] ${c.preview.slice(0, 100)}...`
    ).join('\n');

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'system',
            content: `당신은 소설 Q&A를 위한 데이터 선별기입니다.
사용자 질문에 답변하기 위해 필요한 엔티티와 텍스트 청크만 선택하세요.

## 선택 기준
1. 질문에 직접 언급된 인물/물건/장소
2. 질문에 답변하는 데 필요한 관련 정보
3. 불필요한 것은 선택하지 마세요

## 응답 형식 (JSON만)
{"entityIds": ["E0001", "E0002"], "chunkIndices": [0, 2]}

- entityIds: 필요한 엔티티 ID 배열 (최대 15개)
- chunkIndices: 필요한 청크 인덱스 배열 (최대 3개)`
          },
          {
            role: 'user',
            content: `## 질문
${query}

## 후보 엔티티
${entityList || '(없음)'}

## 후보 텍스트 청크
${chunkList || '(없음)'}`
          }
        ],
        apiKey,
        stream: false,
        idempotency_key: crypto.randomUUID(),
      }),
    });

    if (!response.ok) {
      console.warn('[selectData] API 오류, 전체 반환');
      return {
        selection: {
          selectedEntityIds: entities.slice(0, 15).map(e => e.id),
          selectedChunkIndices: chunks.slice(0, 3).map(c => c.index),
        },
        billing: null,
      };
    }

    const data = await response.json();
    const callBilling: CallBilling | null = data._billing ?? null;
    const content = extractLlmContent(data);
    const parsed = parseJsonFromLlmContent(content);

    if (parsed) {
      const result: SelectionResult = {
        selectedEntityIds: Array.isArray(parsed.entityIds) ? (parsed.entityIds as string[]).slice(0, 15) : [],
        selectedChunkIndices: Array.isArray(parsed.chunkIndices) ? (parsed.chunkIndices as number[]).slice(0, 3) : [],
      };
      console.log('[selectData] LLM 선별 결과:', result);
      return { selection: result, billing: callBilling };
    }

    return {
      selection: {
        selectedEntityIds: entities.slice(0, 15).map(e => e.id),
        selectedChunkIndices: chunks.slice(0, 3).map(c => c.index),
      },
      billing: callBilling,
    };
  } catch (err: unknown) {
    console.warn('[selectData] 오류, 전체 반환:', err);
    return {
      selection: {
        selectedEntityIds: entities.slice(0, 15).map(e => e.id),
        selectedChunkIndices: chunks.slice(0, 3).map(c => c.index),
      },
      billing: null,
    };
  }
}

/**
 * [4단계] 연결 노드 필요 여부 판단 (LLM이 그래프 구조 보고 결정)
 */
interface ConnectedNodeDecision {
  needsConnectedNodes: boolean;
  selectedNodeIds: string[];
}

async function decideConnectedNodes(
  query: string,
  foundEntityIds: string[],
  relatedEdges: HyperEdge[],
  entities: Record<string, Entity>,
  apiKey?: string
): Promise<{ decision: ConnectedNodeDecision; billing: CallBilling | null }> {
  // 연결된 노드 후보 추출
  const connectedCandidates = new Map<string, { name: string; relations: string[] }>();

  relatedEdges.forEach(edge => {
    edge.entities.forEach(entityId => {
      if (!foundEntityIds.includes(entityId)) {
        const entity = entities[entityId];
        if (entity) {
          if (!connectedCandidates.has(entityId)) {
            connectedCandidates.set(entityId, { name: entity.name, relations: [] });
          }
          const candidate = connectedCandidates.get(entityId);
          if (candidate) {
            candidate.relations.push(edge.statement.slice(0, 50));
          }
        }
      }
    });
  });

  // 연결 노드가 없으면 바로 반환
  if (connectedCandidates.size === 0) {
    return { decision: { needsConnectedNodes: false, selectedNodeIds: [] }, billing: null };
  }

  // 선택된 노드 이름들
  const foundNames = foundEntityIds.map(id => entities[id]?.name || id).join(', ');

  // 연결 노드 목록 생성
  const connectedList = Array.from(connectedCandidates.entries())
    .slice(0, 30)
    .map(([id, info]) => `- [${id}] ${info.name}: ${info.relations[0] || ''}`)
    .join('\n');

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'system',
            content: `당신은 소설 Q&A 시스템의 연결 노드 선별기입니다.

## 상황
사용자가 "${foundNames}"에 대해 질문했습니다.
이 노드들과 연결된 다른 노드들이 있습니다.

## 질문에 답하려면 연결된 노드 정보도 필요한가요?

연결된 노드들:
${connectedList}

## 판단 기준
- 관계, 상호작용, 맥락 파악에 필요하면 → 필요
- 단순 속성(외모, 이름 등)만 물으면 → 불필요
- "자세히", "관계", "누구와" 등 → 필요

## 응답 형식 (JSON만)
{"needsConnectedNodes": true/false, "selectedNodeIds": ["필요한ID1", "필요한ID2"]}`
          },
          { role: 'user', content: query }
        ],
        apiKey,
        stream: false,
        idempotency_key: crypto.randomUUID(),
      }),
    });

    if (!response.ok) {
      console.warn('[decideConnected] API 오류, 기본값 사용');
      return { decision: { needsConnectedNodes: true, selectedNodeIds: Array.from(connectedCandidates.keys()).slice(0, 10) }, billing: null };
    }

    const data = await response.json();
    const callBilling: CallBilling | null = data._billing ?? null;
    const content = extractLlmContent(data);
    const parsed = parseJsonFromLlmContent(content);

    if (parsed) {
      const result: ConnectedNodeDecision = {
        needsConnectedNodes: !!parsed.needsConnectedNodes,
        selectedNodeIds: Array.isArray(parsed.selectedNodeIds) ? parsed.selectedNodeIds as string[] : [],
      };
      console.log('[decideConnected] LLM 판단:', result);
      return { decision: result, billing: callBilling };
    }

    return { decision: { needsConnectedNodes: true, selectedNodeIds: Array.from(connectedCandidates.keys()).slice(0, 10) }, billing: callBilling };
  } catch (err: unknown) {
    console.warn('[decideConnected] 오류, 기본값 사용:', err);
    return { decision: { needsConnectedNodes: true, selectedNodeIds: Array.from(connectedCandidates.keys()).slice(0, 10) }, billing: null };
  }
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  /** settle 후 실제 차감 크레딧 (assistant 메시지에만, BYOK 시 null) */
  creditsUsed?: number | null;
  /** BYOK 사용 여부 */
  byok?: boolean;
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
  // 띄어쓰기 제거한 버전도 준비
  const queryNoSpace = queryLower.replace(/\s+/g, '');
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
    // 띄어쓰기 제거한 엔티티 이름
    const nameNoSpace = nameLower.replace(/\s+/g, '');

    // 1. 질문에 엔티티 이름이 포함됨 (정확히 일치)
    if (queryLower.includes(nameLower)) {
      mentioned.push(id);
      return;
    }

    // 1-1. 띄어쓰기 무시 매칭 (예: "얼룩고양이" vs "얼룩 고양이")
    if (queryNoSpace.includes(nameNoSpace) || nameNoSpace.includes(queryNoSpace.slice(0, 10))) {
      mentioned.push(id);
      return;
    }

    // 2. 엔티티 이름에 질문 키워드가 포함됨 (부분 일치 - "새 박스"에서 "박스" 검색)
    if ([...expandedQueryWords].some(word => nameLower.includes(word) || nameNoSpace.includes(word))) {
      mentioned.push(id);
      return;
    }

    // 3. 별칭으로 검색
    if (entity.aliases?.some(alias => {
      const aliasLower = alias.toLowerCase();
      const aliasNoSpace = aliasLower.replace(/\s+/g, '');
      return queryLower.includes(aliasLower) ||
             queryNoSpace.includes(aliasNoSpace) ||
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
  if (mentionedEntityIds.length === 0 && intent.keywords.length > 0) {
    Object.entries(knowledgeGraph.entities).forEach(([id, entity]) => {
      const nameLower = entity.name.toLowerCase();
      const descLower = (entity.description || '').toLowerCase();

      for (const keyword of intent.keywords) {
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
  if (mentionedEntityIds.length === 0 && intent.keywords.length > 0) {
    const relatedEntityIds = new Set<string>();
    Object.values(knowledgeGraph.hyperedges).forEach(edge => {
      const statementLower = edge.statement.toLowerCase();
      if (intent.keywords.some(kw => statementLower.includes(kw))) {
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
        return intent.keywords.some(kw => nameLower.includes(kw) || descLower.includes(kw));
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
          // order 필드 사용 (파일 순서 변경 시 업데이트됨)
          const sceneNum = scene?.order || sceneId.replace('S', '').replace(/^0+/, '');
          return scene ? `장면 ${sceneNum} (${scene.location || '?'})` : `장면 ${sceneNum}`;
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
        // order 필드 사용 (파일 순서 변경 시 업데이트됨)
        const sceneNum = scene.order || scene.sceneId.replace('S', '').replace(/^0+/, '');
        contexts.push(`### 장면 ${sceneNum} (${scene.location || '?'}, ${scene.time || '?'})`);
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

/** detectQueryIntent 반환 타입 (buildSystemPrompt에서도 사용) */
type QueryIntent = ReturnType<typeof detectQueryIntent>;

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

  // 장면 정보 생성 (시간대, 등장인물 첫 등장 파악용)
  const scenes = Object.values(knowledgeGraph.snapshots)
    .sort((a, b) => a.order - b.order);

  let sceneSection = '';
  if (scenes.length > 0) {
    sceneSection = scenes.slice(0, 30).map(scene => {
      const chars = scene.charactersPresent?.slice(0, 5).join(', ') || '';
      const timeInfo = scene.timeMarker ? ` [${scene.timeMarker}]` : '';
      return `- 장면 ${scene.order}: ${scene.location || '?'}, ${scene.time || '?'}${timeInfo} - ${scene.summary?.slice(0, 50) || ''}... (등장: ${chars})`;
    }).join('\n');

    if (scenes.length > 30) {
      sceneSection += `\n... 외 ${scenes.length - 30}개 장면`;
    }
  }

  return `당신은 소설 "${title}"의 전문가입니다.

## 소설 정보
- 제목: ${title}
- 등장 인물: ${characterCount}명
- 총 엔티티: ${entityCount}개
- 총 장면: ${scenes.length}개

## 질문과 관련된 엔티티
${entitySection}

## 관련 관계
${relationSection}

## 장면 목록 (시간순)
${sceneSection || '(장면 정보 없음)'}

## 답변 지침 (필수)

### 1. 상세하게 답변
- 짧은 답변 금지. 최소 5문장 이상으로 풍부하게 설명
- 캐릭터 질문: 외모, 성격, 등장 장면, 다른 캐릭터와의 관계 모두 설명
- "자세히", "더 알려줘" 요청 시: 이전에 말한 내용 + 추가 정보 제공

### 2. 대화 맥락 유지 (멀티턴)
- 이전 대화에서 언급된 대상을 기억하고 이어서 답변
- "그거", "그 캐릭터", "더 자세히" 등은 이전 맥락 참조
- 예: "얼룩고양이 알려줘" → (답변) → "더 자세히" → 얼룩고양이에 대해 추가 설명

### 3. 마크다운 형식
- 제목: ### 사용
- 강조: **굵게**
- 목록: - 또는 1. 2. 3.
- 인용: > 사용

### 4. 정보 부족 시
- "해당 정보를 찾을 수 없습니다"로 끝내지 말 것
- 대신 **구체적으로 질문**: "어떤 장면에서의 얼룩고양이를 말씀하시나요?" 또는 "혹시 다른 이름으로 불리는 캐릭터인가요?"
- 비슷한 정보가 있으면 제안: "혹시 OOO를 찾으시나요?"

### 5. 한국어로 답변

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
): Promise<ChatResult> {
  const userApiKey = getApiKey();

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');

  // billing 수집 배열
  const billings: CallBilling[] = [];

  // 이전 대화에서 언급된 엔티티도 추출 (멀티턴 맥락 유지)
  const recentMessages = messages.slice(-6); // 최근 3턴 (user+assistant 쌍)
  const previousContext = recentMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => m.content)
    .join(' ');

  // [1단계] LLM 의도 분석 (키워드 + 카테고리 요청 판단)
  // 현재 질문 + 이전 맥락을 함께 분석
  const queryForAnalysis = lastUserMessage
    ? `${lastUserMessage.content} (이전 맥락: ${previousContext.slice(0, 500)})`
    : '';
  const { analysis: queryAnalysis, billing: analysisBilling } = lastUserMessage
    ? await analyzeQueryWithLLM(queryForAnalysis, userApiKey || undefined)
    : { analysis: { keywords: [] as string[], wantsCategoryList: false, targetCategory: null }, billing: null };
  if (analysisBilling) billings.push(analysisBilling);

  // [2단계] 데이터 수집
  let foundEntityIds: string[] = [];
  let chunkResults: ChunkSearchResult[] = [];

  // (A) 카테고리 전체 목록 요청인 경우
  if (queryAnalysis.wantsCategoryList && queryAnalysis.targetCategory) {
    const categoryEntities = Object.entries(context.knowledgeGraph.entities)
      .filter(([, e]) => e.category === queryAnalysis.targetCategory)
      .map(([id]) => id);
    foundEntityIds = categoryEntities;
  }

  // (B) 키워드 기반 검색 + 원본 질문으로도 검색
  if (lastUserMessage) {
    // 원본 질문으로 직접 매칭 (띄어쓰기 무시 검색 포함)
    const directFromQuery = findMentionedEntityIds(
      lastUserMessage.content,
      context.knowledgeGraph.entities
    );
    directFromQuery.forEach(id => {
      if (!foundEntityIds.includes(id)) foundEntityIds.push(id);
    });

    // 이전 대화 맥락에서도 엔티티 검색 (멀티턴 지원)
    const contextEntityIds = findMentionedEntityIds(
      previousContext,
      context.knowledgeGraph.entities
    );
    contextEntityIds.forEach(id => {
      if (!foundEntityIds.includes(id)) foundEntityIds.push(id);
    });

    // LLM 키워드로도 추가 검색
    if (queryAnalysis.keywords.length > 0) {
      const directFromKeywords = findMentionedEntityIds(
        queryAnalysis.keywords.join(' '),
        context.knowledgeGraph.entities
      );
      directFromKeywords.forEach(id => {
        if (!foundEntityIds.includes(id)) foundEntityIds.push(id);
      });
    }

    // graphId가 있으면 임베딩 검색도 수행
    if (graphId) {
      const [entityResults, chunks] = await Promise.all([
        searchSimilarEntities(graphId, queryAnalysis.keywords, userApiKey || undefined, 10),
        searchSimilarChunks(graphId, lastUserMessage.content, userApiKey || undefined, 3),
      ]);

      entityResults.forEach(result => {
        if (!foundEntityIds.includes(result.entityId)) {
          foundEntityIds.push(result.entityId);
        }
      });
      chunkResults = chunks;
    }
  }

  // (C) 키워드도 없고 카테고리 요청도 아닌 경우: 청크 임베딩만 검색
  if (foundEntityIds.length === 0 && graphId && lastUserMessage) {
    chunkResults = await searchSimilarChunks(graphId, lastUserMessage.content, userApiKey || undefined, 3);
  }

  // [3단계] LLM 선별 - 수집된 데이터 중 필요한 것만 선택
  if (lastUserMessage && (foundEntityIds.length > 10 || chunkResults.length > 3)) {
    // 후보 엔티티 목록 생성
    const candidateEntities = foundEntityIds.map(id => {
      const entity = context.knowledgeGraph.entities[id];
      return entity ? {
        id,
        name: entity.name,
        category: entity.category,
        description: entity.description?.slice(0, 100),
      } : null;
    }).filter(Boolean) as { id: string; name: string; category: string; description?: string }[];

    // 후보 청크 목록 생성
    const candidateChunks = chunkResults.map(chunk => ({
      index: chunk.chunkIndex,
      preview: chunk.content.slice(0, 150),
    }));

    const { selection: selectionResult, billing: selectionBilling } = await selectRelevantData(
      lastUserMessage.content,
      candidateEntities,
      candidateChunks,
      userApiKey || undefined
    );
    if (selectionBilling) billings.push(selectionBilling);

    // 선별된 결과로 필터링
    const selectedEntitySet = new Set(selectionResult.selectedEntityIds);
    const selectedChunkSet = new Set(selectionResult.selectedChunkIndices);

    foundEntityIds = foundEntityIds.filter(id => selectedEntitySet.has(id));
    chunkResults = chunkResults.filter(chunk => selectedChunkSet.has(chunk.chunkIndex));
  }

  // 관련 관계
  const relatedEdges = findConnectedEdges(foundEntityIds, context.knowledgeGraph.hyperedges);

  // [4단계] 연결 노드 필요 여부 판단 (LLM이 그래프 구조 보고 결정)
  let connectedArray: string[] = [];
  if (relatedEdges.length > 0 && lastUserMessage) {
    const { decision: connectedNodeDecision, billing: connectedBilling } = await decideConnectedNodes(
      lastUserMessage.content,
      foundEntityIds,
      relatedEdges,
      context.knowledgeGraph.entities,
      userApiKey || undefined
    );
    if (connectedBilling) billings.push(connectedBilling);

    if (connectedNodeDecision.needsConnectedNodes) {
      const connectedEntityIds = new Set<string>();
      // 필요하다고 판단된 연결 노드만 추가
      connectedNodeDecision.selectedNodeIds.forEach((id: string) => {
        if (!foundEntityIds.includes(id)) {
          connectedEntityIds.add(id);
        }
      });
      connectedArray = Array.from(connectedEntityIds).slice(0, 20);
      connectedArray.forEach(id => foundEntityIds.push(id));
      console.log(`[chat] 연결 노드 추가: ${connectedArray.length}개 (LLM 선택)`);
    } else {
      console.log(`[chat] 연결 노드 불필요 (LLM 판단)`);
    }
  }

  console.log(`[chat] 최종 엔티티: ${foundEntityIds.length}개 (직접: ${foundEntityIds.length - connectedArray.length}, 연결: ${connectedArray.length})`);

  // [4단계] 컨텍스트 생성 - LLM 분석 결과를 intent로 변환
  const intentForContext: QueryIntent = {
    wantsCharacters: queryAnalysis.targetCategory === 'character',
    wantsRelationships: false,
    wantsItems: queryAnalysis.targetCategory === 'item',
    wantsSummary: false,
    wantsLocations: queryAnalysis.targetCategory === 'location',
    wantsOrganizations: queryAnalysis.targetCategory === 'organization',
    wantsEvents: queryAnalysis.targetCategory === 'event',
    wantsConcepts: queryAnalysis.targetCategory === 'concept',
    wantsCategoryList: queryAnalysis.wantsCategoryList,
    targetCategory: queryAnalysis.targetCategory,
    keywords: queryAnalysis.keywords,
  };

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

  // 대화 이력 토큰 제한: 최신 메시지부터 역순으로 추가, MAX_HISTORY_CHARS 초과 시 중단
  const systemPrompt = buildSystemPrompt(context, foundEntityIds, intentForContext);
  const historyMessages: { role: string; content: string }[] = [];
  let historyChars = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const msgContent = m.role === 'user' && m === lastUserMessage
      ? `${m.content}\n\n---\n[참고 컨텍스트]\n${relevantContext}`
      : m.content;
    const msgLength = msgContent.length;

    if (historyChars + msgLength > MAX_HISTORY_CHARS) break;
    historyChars += msgLength;
    historyMessages.unshift({ role: m.role as 'user' | 'assistant', content: msgContent });
  }

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
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
      idempotency_key: crypto.randomUUID(),
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const errObj = new Error(errBody.error?.message || errBody.error || `API 오류: ${response.status}`);
    (errObj as Error & { status?: number }).status = response.status;
    throw errObj;
  }

  /** billing 합산 + ChunkUsage 변환 헬퍼 */
  const aggregateBilling = (): { billing: ChatMessageBilling | null; chunkUsages: ChunkUsage[] } => {
    if (billings.length === 0) return { billing: null, chunkUsages: [] };
    let totalPrompt = 0;
    let totalCompletion = 0;
    let isByok = false;
    const chunkUsages: ChunkUsage[] = [];
    for (let i = 0; i < billings.length; i++) {
      const b = billings[i];
      totalPrompt += b.prompt_tokens;
      totalCompletion += b.completion_tokens;
      if (b.byok) isByok = true;
      chunkUsages.push({
        chunkIndex: i,
        promptTokens: b.prompt_tokens,
        completionTokens: b.completion_tokens,
        model: b.model,
      });
    }
    return {
      billing: {
        totalPromptTokens: totalPrompt,
        totalCompletionTokens: totalCompletion,
        byok: isByok,
      },
      chunkUsages,
    };
  };

  if (onChunk && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let nextEventType: string | null = null;
    // SSE 라인 버퍼: TCP 세그먼트 경계에서 잘린 불완전한 행 처리
    let lineBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const rawText = lineBuffer + decoder.decode(value, { stream: true });
      const splitLines = rawText.split('\n');
      // 마지막 요소는 불완전할 수 있으므로 버퍼에 보관
      lineBuffer = splitLines.pop() || '';
      const lines = splitLines.filter(line => line.trim() !== '');

      for (const line of lines) {
        // SSE event type 감지
        if (line.startsWith('event: ')) {
          nextEventType = line.slice(7).trim();
          continue;
        }

        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            nextEventType = null;
            continue;
          }

          // billing SSE 이벤트 처리
          if (nextEventType === 'billing') {
            try {
              const billingData: CallBilling = JSON.parse(data);
              billings.push(billingData);
            } catch {
              // billing 파싱 실패 무시
            }
            nextEventType = null;
            continue;
          }

          nextEventType = null;

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

    const { billing, chunkUsages } = aggregateBilling();
    return { content: fullContent, billing, chunkUsages };
  }

  const data = await response.json();
  // 비스트리밍 응답에서 billing 추출
  if (data._billing) {
    billings.push(data._billing);
  }
  const { billing: finalBilling, chunkUsages: finalChunkUsages } = aggregateBilling();
  return { content: extractLlmContent(data), billing: finalBilling, chunkUsages: finalChunkUsages };
}

/**
 * 채팅 메시지 전송 비용 사전 추정 (크레딧 단위)
 *
 * 호출 구조: ①의도분석(Flash) + ②데이터선별(Flash, 조건부) + ③최종답변(사용자 모델) + ④연결노드판단(Flash, 조건부)
 * creditsPerChat 기반 근사 + 대화 이력/컨텍스트 길이 스케일링.
 */
export function estimateChatCost(
  messages: ChatMessage[],
  contextChars: number,
  model: string,
  dynamicModels?: ModelInfo[],
): number {
  const modelInfo = findModel(model, dynamicModels);
  const baseCredits = modelInfo?.creditsPerChat ?? DEFAULT_CREDITS_PER_CHAT;

  // 대화 이력 길이에 따른 스케일링
  let historyChars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    historyChars += messages[i].content.length;
    if (historyChars > MAX_HISTORY_CHARS) {
      historyChars = MAX_HISTORY_CHARS;
      break;
    }
  }
  const contextScale = Math.max(1, (contextChars + historyChars) / CHUNK_SIZE);
  return Math.max(1, Math.ceil(baseCredits * contextScale));
}

/**
 * 고유 ID 생성
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
