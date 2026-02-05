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
 * 질문에서 엔티티 ID 추출
 */
function findMentionedEntityIds(
  query: string,
  entities: Record<string, Entity>
): string[] {
  const mentioned: string[] = [];
  const queryLower = query.toLowerCase();

  Object.entries(entities).forEach(([id, entity]) => {
    const nameLower = entity.name.toLowerCase();
    // 이름으로 검색
    if (queryLower.includes(nameLower)) {
      mentioned.push(id);
      return;
    }
    // 별칭으로 검색
    if (entity.aliases?.some(alias => queryLower.includes(alias.toLowerCase()))) {
      mentioned.push(id);
    }
  });

  return mentioned;
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

  // 1. 질문에서 언급된 엔티티 찾기
  const mentionedEntityIds = findMentionedEntityIds(query, knowledgeGraph.entities);
  const mentionedEntities = mentionedEntityIds
    .map(id => knowledgeGraph.entities[id])
    .filter(Boolean);

  // 2. 언급된 엔티티들 간의 직접 관계 찾기 (가장 중요!)
  const directRelations = findDirectRelations(mentionedEntityIds, knowledgeGraph.hyperedges);

  // 3. 언급된 엔티티와 연결된 모든 관계 찾기
  const connectedEdges = findConnectedEdges(mentionedEntityIds, knowledgeGraph.hyperedges);

  // 4. 키워드 기반 추가 관계 검색
  const keywordEdges = Object.values(knowledgeGraph.hyperedges).filter(edge => {
    const statementLower = edge.statement.toLowerCase();
    return statementLower.includes(queryLower) ||
           edge.type.toLowerCase().includes(queryLower);
  });

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
    additionalEdges.slice(0, 10).forEach(edge => {
      const entityNames = edge.entities
        .map(id => knowledgeGraph.entities[id]?.name || id)
        .join(' ↔ ');
      contexts.push(`- [${edge.type}] ${entityNames}: ${edge.statement}`);
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
 * 시스템 프롬프트 생성
 */
function buildSystemPrompt(context: ChatContext): string {
  const { knowledgeGraph, originalText } = context;
  const title = knowledgeGraph.metadata.title;

  const entityCount = Object.keys(knowledgeGraph.entities).length;
  const characterCount = Object.values(knowledgeGraph.entities)
    .filter(e => e.category === 'character').length;
  const sceneCount = Object.keys(knowledgeGraph.snapshots).length;
  const edgeCount = Object.keys(knowledgeGraph.hyperedges).length;

  return `당신은 소설 "${title}"의 전문가입니다. 이 소설에 대한 질문에 상세하게 답변해주세요.

## 소설 정보
- 제목: ${title}
- 등장 인물: ${characterCount}명
- 총 엔티티: ${entityCount}개
- 관계: ${edgeCount}개
- 장면: ${sceneCount}개

## 답변 규칙
1. 소설 내용에 기반해서 구체적으로 답변하세요
2. 인물 관계를 물으면 관계의 종류, 감정, 구체적 내용을 설명하세요
3. 관련 장면이 있으면 언급해주세요
4. 확실하지 않은 내용은 추측임을 명시하세요
5. 답변은 한국어로 해주세요

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
