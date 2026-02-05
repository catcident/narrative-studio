/**
 * 지식 그래프 추출 서비스 — 엔티티 선별 (청크 컨텍스트 구성)
 */

import type { NovelKnowledgeGraph } from '../../types';
import type { KnownEntity, EntitySummary } from './types';
import { CATEGORY_NAMES, MAX_KNOWN_ENTITIES, MAX_PER_CATEGORY, getApiKey, stripMarkdownCodeBlock } from './types';
import { ENTITY_SELECTION_PROMPT } from './prompts';
import { fetchWithClientTimeout } from './types';

export function trimKnownEntities(entities: KnownEntity[]): KnownEntity[] {
  if (entities.length <= MAX_KNOWN_ENTITIES) {
    return entities;
  }

  // 카테고리별로 그룹화하고 각각 제한
  const byCategory: Record<string, KnownEntity[]> = {};
  for (const e of entities) {
    if (!byCategory[e.category]) {
      byCategory[e.category] = [];
    }
    byCategory[e.category].push(e);
  }

  const result: KnownEntity[] = [];
  for (const category of Object.keys(byCategory)) {
    const categoryEntities = byCategory[category];
    // 최근 것들만 유지
    result.push(...categoryEntities.slice(-MAX_PER_CATEGORY));
  }

  return result.slice(-MAX_KNOWN_ENTITIES);
}

/**
 * 지식그래프에서 엔티티 요약 목록 생성
 * 각 노드의 이름, 카테고리, 설명, 연결된 관계들을 한 줄씩 요약
 */
export function buildEntitySummaries(graph: NovelKnowledgeGraph): EntitySummary[] {
  const summaries: EntitySummary[] = [];

  for (const entity of Object.values(graph.entities) as any[]) {
    // 이 엔티티와 연결된 관계들 찾기
    const relations: string[] = [];
    for (const edge of Object.values(graph.hyperedges) as any[]) {
      if (!edge.entities?.includes(entity.id)) continue;

      const otherId = edge.entities.find((id: string) => id !== entity.id);
      const other = graph.entities[otherId] as any;
      if (!other) continue;

      // 관계 방향 결정 (from이 현재 엔티티인지)
      const isFrom = edge.entities[0] === entity.id;
      const arrow = isFrom ? '→' : '←';
      const desc = (edge.statement || '').slice(0, 30);

      relations.push(`${edge.type} ${arrow} ${other.name}: ${desc}`);
    }

    summaries.push({
      name: entity.name,
      category: entity.category || 'character',
      description: (entity.description || '').slice(0, 50),
      relations: relations.slice(0, 5),  // 관계는 최대 5개
    });
  }

  return summaries;
}

/**
 * 엔티티 요약을 텍스트로 변환 (LLM 선별용)
 */
export function formatEntitySummariesForSelection(summaries: EntitySummary[]): string {
  return summaries.map(s => {
    const catName = CATEGORY_NAMES[s.category] || s.category;
    const header = `${s.name} (${catName})${s.description ? ' - ' + s.description : ''}`;
    if (s.relations.length === 0) {
      return header;
    }
    return header + '\n  ' + s.relations.join('\n  ');
  }).join('\n\n');
}

export interface SelectionResult {
  names: string[];
  billing: { prompt_tokens: number; completion_tokens: number } | null;
}

/**
 * LLM을 사용하여 청크와 관련된 엔티티 선별
 */
export async function selectRelevantEntities(
  chunkText: string,
  graph: NovelKnowledgeGraph,
  model?: string
): Promise<SelectionResult> {
  // 엔티티가 1개 이하면 선별 없이 전체 반환
  const entityCount = Object.keys(graph.entities).length;
  if (entityCount <= 1) {
    console.log(`[extraction] 엔티티 ${entityCount}개 - 선별 스킵, 전체 사용`);
    return { names: Object.values(graph.entities).map((e: any) => e.name), billing: null };
  }

  // 엔티티 요약 생성
  const summaries = buildEntitySummaries(graph);
  const summaryText = formatEntitySummariesForSelection(summaries);

  // 텍스트 미리보기 (앞부분 1000자)
  const textPreview = chunkText.slice(0, 1000);

  const prompt = ENTITY_SELECTION_PROMPT
    .replace('{{textPreview}}', textPreview)
    .replace('{{entitySummaries}}', summaryText);

  console.log(`[extraction] 선별 프롬프트 크기: ${prompt.length}자, 엔티티 ${entityCount}개`);

  try {
    // 빠른 모델로 선별 (gemini-flash 사용)
    const selectionModel = 'google/gemini-2.0-flash-001';
    const userApiKey = getApiKey();

    const response = await fetchWithClientTimeout('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        apiKey: userApiKey || undefined,
        model: selectionModel
      }),
    }, 30000);  // 30초 타임아웃 (빠른 작업)

    if (!response.ok) {
      console.warn('[extraction] 선별 API 오류, 전체 엔티티 사용');
      return { names: Object.values(graph.entities).map((e: any) => e.name), billing: null };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // billing 데이터 캡처
    const billing = data.usage ? {
      prompt_tokens: data.usage.prompt_tokens || 0,
      completion_tokens: data.usage.completion_tokens || 0,
    } : null;

    // JSON 배열 파싱
    let selectedNames: string[] = [];
    try {
      const jsonContent = stripMarkdownCodeBlock(content);
      selectedNames = JSON.parse(jsonContent);
      if (!Array.isArray(selectedNames)) {
        throw new Error('배열이 아님');
      }
    } catch {
      console.warn('[extraction] 선별 JSON 파싱 실패, 전체 엔티티 사용');
      return { names: Object.values(graph.entities).map((e: any) => e.name), billing };
    }

    console.log(`[extraction] 선별 ${entityCount}개 중 ${selectedNames.length}개 선택: ${selectedNames.slice(0, 10).join(', ')}${selectedNames.length > 10 ? '...' : ''}`);
    return { names: selectedNames, billing };

  } catch (error) {
    console.warn('[extraction] 선별 오류 발생, 전체 엔티티 사용:', error);
    return { names: Object.values(graph.entities).map((e: any) => e.name), billing: null };
  }
}

/**
 * 선택된 엔티티 이름으로 KnownEntity 목록 필터링
 */
export function filterEntitiesByNames(
  graph: NovelKnowledgeGraph,
  selectedNames: string[]
): KnownEntity[] {
  const selectedSet = new Set(selectedNames.map(n => n.toLowerCase()));
  const result: KnownEntity[] = [];

  for (const entity of Object.values(graph.entities) as any[]) {
    const nameLower = entity.name.toLowerCase();
    const aliasMatch = (entity.aliases || []).some((a: string) =>
      selectedSet.has(a.toLowerCase())
    );

    if (selectedSet.has(nameLower) || aliasMatch) {
      result.push({
        name: entity.name,
        description: (entity.description || '').slice(0, 100),
        category: entity.category || 'character',
        aliases: entity.aliases || []
      });
    }
  }

  return result;
}

/**
 * allExtracted에서 축적 그래프 생성 (엔티티 + 관계 정보 포함)
 * 한번에 올리기/따로 올리기 모두 동일한 방식으로 처리
 */
export function buildAccumulatedGraph(allExtracted: any[], existingGraph?: NovelKnowledgeGraph): NovelKnowledgeGraph {
  const entities: Record<string, any> = {};
  const hyperedges: Record<string, any> = {};

  // existingGraph가 있으면 그것을 기반으로 시작
  if (existingGraph) {
    Object.assign(entities, existingGraph.entities);
    Object.assign(hyperedges, existingGraph.hyperedges);
  }

  let entityCounter = Object.keys(entities).length;
  let edgeCounter = Object.keys(hyperedges).length;

  // 이름 → ID 매핑 (중복 체크용)
  const nameToId = new Map<string, string>();
  for (const [id, entity] of Object.entries(entities)) {
    nameToId.set((entity as any).name.toLowerCase(), id);
    for (const alias of ((entity as any).aliases || [])) {
      nameToId.set(alias.toLowerCase(), id);
    }
  }

  // allExtracted에서 엔티티와 관계 축적
  for (const extracted of allExtracted) {
    // 엔티티 축적
    for (const entity of (extracted.entities || [])) {
      const nameLower = entity.name.toLowerCase();
      if (!nameToId.has(nameLower)) {
        entityCounter++;
        const id = `E${String(entityCounter).padStart(4, '0')}`;
        entities[id] = {
          id,
          name: entity.name,
          category: entity.category || 'character',
          description: entity.description || '',
          aliases: entity.aliases || [],
        };
        nameToId.set(nameLower, id);
        for (const alias of (entity.aliases || [])) {
          nameToId.set(alias.toLowerCase(), id);
        }
      }
    }

    // 관계 축적
    for (const rel of (extracted.relationships || [])) {
      edgeCounter++;
      const edgeId = `R${String(edgeCounter).padStart(4, '0')}`;
      hyperedges[edgeId] = {
        id: edgeId,
        type: rel.type || '관련',
        participants: rel.participants || [],
        description: rel.description || '',
        scenes: rel.scenes || [],
      };
    }
  }

  return {
    metadata: { title: '', createdAt: '', updatedAt: '', version: '1.0.0' },
    entities,
    hyperedges,
    chapters: existingGraph?.chapters || {},
    timeline: existingGraph?.timeline || [],
    snapshots: existingGraph?.snapshots || {},
    stats: {
      totalEntities: Object.keys(entities).length,
      totalEdges: Object.keys(hyperedges).length,
      totalChapters: 0,
      entitiesByCategory: {} as any,
      edgesByType: {} as any
    }
  };
}

