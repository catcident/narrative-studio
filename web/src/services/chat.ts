/**
 * 소설 채팅 서비스
 * 지식 그래프와 원본 텍스트를 기반으로 질문에 답변
 */

import type { NovelKnowledgeGraph } from '../types';
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
 * 지식 그래프에서 관련 정보 추출
 */
function extractRelevantContext(
  query: string,
  knowledgeGraph: NovelKnowledgeGraph,
  originalText?: string
): string {
  const contexts: string[] = [];
  const queryLower = query.toLowerCase();

  // 1. 관련 엔티티 찾기
  const relevantEntities = Object.values(knowledgeGraph.entities).filter(entity => {
    const nameLower = entity.name.toLowerCase();
    const descLower = (entity.description || '').toLowerCase();
    const aliasesMatch = entity.aliases?.some(a => queryLower.includes(a.toLowerCase()));
    return queryLower.includes(nameLower) || nameLower.includes(queryLower) ||
           descLower.includes(queryLower) || aliasesMatch;
  });

  if (relevantEntities.length > 0) {
    contexts.push('## 관련 등장인물/엔티티');
    relevantEntities.slice(0, 10).forEach(entity => {
      contexts.push(`- **${entity.name}** (${entity.category}): ${entity.description || '설명 없음'}`);
      if (entity.aliases?.length) {
        contexts.push(`  - 별칭: ${entity.aliases.join(', ')}`);
      }
    });
  }

  // 2. 관련 관계 찾기
  const relevantEdges = Object.values(knowledgeGraph.hyperedges).filter(edge => {
    const statementLower = edge.statement.toLowerCase();
    const entityNames = edge.entities.map(id =>
      knowledgeGraph.entities[id]?.name?.toLowerCase() || ''
    );
    return statementLower.includes(queryLower) ||
           entityNames.some(name => queryLower.includes(name));
  });

  if (relevantEdges.length > 0) {
    contexts.push('\n## 관련 관계');
    relevantEdges.slice(0, 15).forEach(edge => {
      const entityNames = edge.entities
        .map(id => knowledgeGraph.entities[id]?.name || id)
        .join(' ↔ ');
      contexts.push(`- [${edge.type}] ${entityNames}: ${edge.statement}`);
    });
  }

  // 3. 관련 장면 찾기
  const relevantScenes = Object.values(knowledgeGraph.snapshots).filter(scene => {
    const summaryLower = (scene.summary || '').toLowerCase();
    const eventsLower = scene.events.join(' ').toLowerCase();
    return summaryLower.includes(queryLower) || eventsLower.includes(queryLower);
  });

  if (relevantScenes.length > 0) {
    contexts.push('\n## 관련 장면');
    relevantScenes.slice(0, 10).forEach(scene => {
      const chars = scene.charactersPresent
        .map(id => knowledgeGraph.entities[id]?.name || id)
        .join(', ');
      contexts.push(`- **${scene.sceneId}** (${scene.location}, ${scene.time})`);
      contexts.push(`  - 등장: ${chars}`);
      contexts.push(`  - 요약: ${scene.summary}`);
    });
  }

  // 4. 장(Chapter) 정보
  if (knowledgeGraph.chapters && Object.keys(knowledgeGraph.chapters).length > 0) {
    contexts.push('\n## 장 목록');
    Object.values(knowledgeGraph.chapters).slice(0, 20).forEach(chapter => {
      contexts.push(`- ${chapter.number}화: ${chapter.title}`);
    });
  }

  // 5. 원본 텍스트에서 관련 부분 찾기 (키워드 검색)
  if (originalText && query.length >= 2) {
    const keywords = query.split(/\s+/).filter(k => k.length >= 2);
    const lines = originalText.split('\n');
    const matchedLines: string[] = [];

    lines.forEach((line, idx) => {
      const lineLower = line.toLowerCase();
      if (keywords.some(kw => lineLower.includes(kw.toLowerCase()))) {
        // 앞뒤 문맥 포함
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

  // 전체 세계관 요약
  const entityCount = Object.keys(knowledgeGraph.entities).length;
  const characterCount = Object.values(knowledgeGraph.entities)
    .filter(e => e.category === 'character').length;
  const sceneCount = Object.keys(knowledgeGraph.snapshots).length;

  return `당신은 소설 "${title}"의 전문가입니다. 이 소설에 대한 질문에 답변해주세요.

## 소설 정보
- 제목: ${title}
- 등장 인물 수: ${characterCount}명
- 총 엔티티 수: ${entityCount}개
- 총 장면 수: ${sceneCount}개

## 답변 규칙
1. 소설 내용에 기반해서만 답변하세요
2. 확실하지 않은 내용은 추측임을 명시하세요
3. 관련 장면이나 인물이 있으면 언급해주세요
4. 스포일러 주의가 필요하면 경고해주세요
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
  const apiKey = localStorage.getItem('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다.');
  }

  // 마지막 사용자 메시지에서 관련 컨텍스트 추출
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const relevantContext = lastUserMessage
    ? extractRelevantContext(lastUserMessage.content, context.knowledgeGraph, context.originalText)
    : '';

  // API 요청용 메시지 구성
  const apiMessages = [
    { role: 'system', content: buildSystemPrompt(context) },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.role === 'user' && m === lastUserMessage
        ? `${m.content}\n\n---\n[참고 컨텍스트]\n${relevantContext}`
        : m.content
    }))
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'StoryGraph Chat',
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      stream: !!onChunk,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API 오류: ${response.status}`);
  }

  // 스트리밍 처리
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

  // 비스트리밍
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 고유 ID 생성
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
