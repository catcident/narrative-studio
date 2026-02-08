/**
 * 지식 그래프 추출 서비스 — 엔티티 선별 (청크 컨텍스트 구성)
 */

import type { Entity, HyperEdge, EntityCategory } from '../../types';
import type { KnownEntity, EntitySummary, ChunkBilling, ChunkExtractedData, AccumulatedGraph } from './types';
import { CATEGORY_NAMES, getApiKey, stripMarkdownCodeBlock, fetchWithClientTimeout } from './types';
import { ENTITY_SELECTION_PROMPT } from './prompts';

/**
 * 지식그래프에서 엔티티 요약 목록 생성
 * 각 노드의 이름, 카테고리, 설명, 연결된 관계들을 한 줄씩 요약
 */
export function buildEntitySummaries(graph: AccumulatedGraph): EntitySummary[] {
  const summaries: EntitySummary[] = [];

  for (const entity of Object.values(graph.entities)) {
    // 이 엔티티와 연결된 관계들 찾기
    const relations: string[] = [];
    for (const edge of Object.values(graph.hyperedges)) {
      if (!edge.entities?.includes(entity.id)) continue;

      const otherId = edge.entities.find((id) => id !== entity.id);
      if (!otherId) continue;
      const other = graph.entities[otherId];
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
  billing: ChunkBilling | null;
}

/** 그래프의 모든 엔티티 이름 목록 반환 (선별 스킵/실패 시 폴백용) */
function allEntityNames(graph: AccumulatedGraph): string[] {
  return Object.values(graph.entities).map((e) => e.name);
}

/**
 * LLM을 사용하여 청크와 관련된 엔티티 선별
 */
export async function selectRelevantEntities(
  chunkText: string,
  graph: AccumulatedGraph,
  model?: string,
  apiKeyOverride?: string,
): Promise<SelectionResult> {
  // 엔티티가 1개 이하면 선별 없이 전체 반환
  const entityCount = Object.keys(graph.entities).length;
  if (entityCount <= 1) {
    console.log(`[extraction] 엔티티 ${entityCount}개 - 선별 스킵, 전체 사용`);
    return { names: allEntityNames(graph), billing: null };
  }

  // 엔티티 요약 생성
  const summaries = buildEntitySummaries(graph);
  const summaryText = formatEntitySummariesForSelection(summaries);

  // 텍스트 미리보기: 앞 800자 + 뒤 200자 (중간 생략)
  let textPreview: string;
  if (chunkText.length <= 1200) {
    textPreview = chunkText;
  } else {
    textPreview = chunkText.slice(0, 800) + '\n...(중략)...\n' + chunkText.slice(-200);
  }

  const prompt = ENTITY_SELECTION_PROMPT
    .replace('{{textPreview}}', textPreview)
    .replace('{{entitySummaries}}', summaryText);

  console.log(`[extraction] 선별 프롬프트 크기: ${prompt.length}자, 엔티티 ${entityCount}개`);

  try {
    // 빠른 모델로 선별 (gemini-flash 사용)
    const selectionModel = 'google/gemini-2.0-flash-001';
    const userApiKey = apiKeyOverride !== undefined ? apiKeyOverride : getApiKey();

    const response = await fetchWithClientTimeout('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        apiKey: userApiKey || undefined,
        model: selectionModel,
      }),
    }, 30000);  // 30초 타임아웃 (빠른 작업)

    if (!response.ok) {
      // 잔액 부족 (402): 빈 선별 결과 + insufficient_balance 플래그 반환
      if (response.status === 402) {
        return {
          names: [],
          billing: { prompt_tokens: 0, completion_tokens: 0, model: selectionModel, insufficient_balance: true },
        };
      }
      console.warn('[extraction] 선별 API 오류, 전체 엔티티 사용');
      return { names: allEntityNames(graph), billing: null };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // billing 데이터 캡처 (서버 _billing 사용 — usage 누락 시 추정값 포함)
    const billing = data._billing ? {
      ...data._billing,
      model: selectionModel,
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
      return { names: allEntityNames(graph), billing };
    }

    // 텍스트에 직접 이름이 언급된 엔티티는 LLM이 누락해도 강제 포함
    const chunkLower = chunkText.toLowerCase();
    const allNames = allEntityNames(graph);
    for (const name of allNames) {
      if (name.length >= 2 && chunkLower.includes(name.toLowerCase())) {
        if (!selectedNames.some(n => n.toLowerCase() === name.toLowerCase())) {
          selectedNames.push(name);
        }
      }
    }

    console.log(`[extraction] 선별 ${entityCount}개 중 ${selectedNames.length}개 선택: ${selectedNames.slice(0, 10).join(', ')}${selectedNames.length > 10 ? '...' : ''}`);
    return { names: selectedNames, billing };

  } catch (err: unknown) {
    console.warn('[extraction] 선별 오류 발생, 전체 엔티티 사용:', err);
    return { names: allEntityNames(graph), billing: null };
  }
}

/**
 * 선택된 엔티티 이름으로 KnownEntity 목록 필터링
 */
export function filterEntitiesByNames(
  graph: AccumulatedGraph,
  selectedNames: string[]
): KnownEntity[] {
  const selectedSet = new Set(selectedNames.map(n => n.toLowerCase()));
  const result: KnownEntity[] = [];

  for (const entity of Object.values(graph.entities)) {
    const nameLower = entity.name.toLowerCase();
    const aliasMatch = (entity.aliases || []).some((a) =>
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
export function buildAccumulatedGraph(allExtracted: ChunkExtractedData[], existingGraph?: { entities: Record<string, Entity>; hyperedges: Record<string, HyperEdge> }): AccumulatedGraph {
  const entities: Record<string, Entity> = {};
  const hyperedges: Record<string, HyperEdge> = {};

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
    nameToId.set(entity.name.toLowerCase(), id);
    for (const alias of (entity.aliases || [])) {
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
          category: (entity.category || 'character') as EntityCategory,
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
      const fromId = nameToId.get(rel.from.toLowerCase());
      const toId = nameToId.get(rel.to.toLowerCase());
      hyperedges[edgeId] = {
        id: edgeId,
        type: rel.type || '관련',
        entities: [fromId, toId].filter(Boolean) as string[],
        statement: rel.description || '',
        scenes: (rel.scenes || []).map(String),
      };
    }
  }

  return { entities, hyperedges };
}
