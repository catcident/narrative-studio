/**
 * 소설 채팅 서비스
 * 지식 그래프와 원본 텍스트를 기반으로 질문에 답변
 */

import type { NovelKnowledgeGraph, Entity, HyperEdge } from '../types';
import { DEFAULT_MODEL } from '../types';

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
function findMentionedEntityIds(
  query: string,
  entities: Record<string, Entity>
): string[] {
  const mentioned: string[] = [];
  const queryLower = query.toLowerCase();

  Object.entries(entities).forEach(([id, entity]) => {
    const nameLower = entity.name.toLowerCase();
    // 정확히 일치
    if (queryLower.includes(nameLower)) {
      mentioned.push(id);
      return;
    }
    // 별칭으로 검색
    if (entity.aliases?.some(alias => queryLower.includes(alias.toLowerCase()))) {
      mentioned.push(id);
      return;
    }
    // 설명에서 키워드 검색 (질문의 주요 단어가 설명에 있는지)
    if (entity.description) {
      const descLower = entity.description.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 2);
      if (queryWords.some(word => descLower.includes(word) && word.length >= 2)) {
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
  keywords: string[];
  expandedKeywords: string[];
} {
  const queryLower = query.toLowerCase();

  // 등장인물/캐릭터 관련 키워드
  const characterKeywords = ['등장인물', '인물', '캐릭터', '주인공', '누구', '사람'];
  const wantsCharacters = characterKeywords.some(k => queryLower.includes(k));

  // 관계 관련 키워드
  const relationshipKeywords = ['관계', '사이', '어떤', '어떻게', '왜'];
  const wantsRelationships = relationshipKeywords.some(k => queryLower.includes(k));

  // 아이템/사물 관련 키워드
  const itemKeywords = ['의미', '상징', '뭐야', '무엇', '물건', '아이템'];
  const wantsItems = itemKeywords.some(k => queryLower.includes(k));

  // 요약/전체 관련 키워드
  const summaryKeywords = ['요약', '줄거리', '내용', '전체', '설명'];
  const wantsSummary = summaryKeywords.some(k => queryLower.includes(k));

  // 질문에서 핵심 키워드 추출 (2글자 이상)
  const keywords = queryLower
    .replace(/[?!.,]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !['의미', '뭐야', '무엇', '어떤', '어떻게', '가', '이', '를', '의'].includes(w));

  // 유사어로 확장
  const expandedKeywords = expandKeywords(keywords);

  return { wantsCharacters, wantsRelationships, wantsItems, wantsSummary, keywords, expandedKeywords };
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
 */
function extractRelevantContext(
  query: string,
  knowledgeGraph: NovelKnowledgeGraph,
  originalText?: string
): string {
  const contexts: string[] = [];
  const queryLower = query.toLowerCase();

  // 0. 질문 의도 분석
  const intent = detectQueryIntent(query);

  // 1. 질문에서 언급된 엔티티 찾기
  let mentionedEntityIds = findMentionedEntityIds(query, knowledgeGraph.entities);

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

/**
 * 시스템 프롬프트 생성 (엔티티/관계 목록 포함)
 */
function buildSystemPrompt(context: ChatContext): string {
  const { knowledgeGraph, originalText } = context;
  const title = knowledgeGraph.metadata.title;

  // 엔티티를 카테고리별로 그룹화
  const entitiesByCategory: Record<string, string[]> = {};
  Object.values(knowledgeGraph.entities).forEach(entity => {
    if (!entitiesByCategory[entity.category]) {
      entitiesByCategory[entity.category] = [];
    }
    entitiesByCategory[entity.category].push(entity.name);
  });

  // 카테고리별 엔티티 목록 생성
  const entityListStr = Object.entries(entitiesByCategory)
    .map(([category, names]) => `- ${category}: ${names.slice(0, 20).join(', ')}${names.length > 20 ? ` 외 ${names.length - 20}개` : ''}`)
    .join('\n');

  // 주요 관계 목록 (강도 높은 순)
  const topRelations = Object.values(knowledgeGraph.hyperedges)
    .filter(e => e.strength && e.strength >= 6)
    .sort((a, b) => (b.strength || 0) - (a.strength || 0))
    .slice(0, 30)
    .map(edge => {
      const names = edge.entities.map(id => knowledgeGraph.entities[id]?.name || id).join(' ↔ ');
      return `- [${edge.type}] ${names}: ${edge.statement.slice(0, 80)}${edge.statement.length > 80 ? '...' : ''}`;
    })
    .join('\n');

  const entityCount = Object.keys(knowledgeGraph.entities).length;
  const characterCount = Object.values(knowledgeGraph.entities)
    .filter(e => e.category === 'character').length;
  const sceneCount = Object.keys(knowledgeGraph.snapshots).length;
  const edgeCount = Object.keys(knowledgeGraph.hyperedges).length;

  return `당신은 소설 "${title}"의 전문가입니다. 아래 지식 그래프 정보를 참고하여 질문에 답변하세요.

## 소설 정보
- 제목: ${title}
- 등장 인물: ${characterCount}명
- 총 엔티티: ${entityCount}개
- 관계: ${edgeCount}개
- 장면: ${sceneCount}개

## 엔티티 목록 (카테고리별)
${entityListStr}

## 주요 관계
${topRelations}

## 답변 규칙
1. **반드시 위 엔티티/관계 목록에서 관련 정보를 찾아 답변하세요**
2. 질문에 직접 언급되지 않아도, 관련된 엔티티가 있으면 함께 설명하세요
3. 예: "동전의 의미가 뭐야?" → 엔티티 목록에서 "돈", "은화", "오원" 등 관련 항목을 찾아 답변
4. 관련 장면이 있으면 언급해주세요
5. 위 목록에 없는 정보로 답변하지 마세요 (할루시네이션 금지)
6. 답변은 한국어로 해주세요

${originalText ? `원본 텍스트가 ${originalText.length.toLocaleString()}자 있습니다.` : '원본 텍스트는 제공되지 않았습니다.'}`;
}

/**
 * 채팅 메시지 전송 (스트리밍)
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  context: ChatContext,
  model: string = DEFAULT_MODEL,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const userApiKey = typeof window !== 'undefined'
    ? localStorage.getItem('OPENROUTER_API_KEY') || ''
    : '';

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const relevantContext = lastUserMessage
    ? extractRelevantContext(lastUserMessage.content, context.knowledgeGraph, context.originalText)
    : '';

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

  // 질문에서 찾은 엔티티
  const foundEntityIds = lastUserMessage
    ? findMentionedEntityIds(lastUserMessage.content, context.knowledgeGraph.entities)
    : [];
  const foundEntities = foundEntityIds.map(id => context.knowledgeGraph.entities[id]?.name).filter(Boolean);
  console.log('🔍 질문에서 찾은 엔티티:', foundEntities.length > 0 ? foundEntities : '(없음)');

  // 관련 관계
  const relatedEdges = findConnectedEdges(foundEntityIds, context.knowledgeGraph.hyperedges);
  console.log('🔗 관련 관계:', relatedEdges.length > 0
    ? relatedEdges.slice(0, 10).map(e => `[${e.type}] ${e.entities.map(id => context.knowledgeGraph.entities[id]?.name || id).join(' ↔ ')}`)
    : '(없음)');

  console.log('📄 생성된 컨텍스트 (LLM에 전달):\n', relevantContext || '(컨텍스트 없음)');
  console.groupEnd();

  const apiMessages = [
    { role: 'system', content: buildSystemPrompt(context) },
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
