/**
 * 온톨로지 추출 서비스
 * 소설 텍스트에서 엔티티와 관계를 추출하여 하이퍼그래프에 등록
 */

import { LLMClient, createLLMClient } from './llm-client.js';
import { HyperGraph } from '../models/hypergraph.js';
import {
  NOVEL_ONTOLOGY_SYSTEM,
  NOVEL_ONTOLOGY_INSTRUCTION,
  CHARACTER_DETAIL_INSTRUCTION,
  RELATIONSHIP_CHANGE_INSTRUCTION,
  CONSISTENCY_CHECK_INSTRUCTION,
} from '../prompts/extraction-prompts.js';
import type {
  ExtractionResult,
  EntityCategory,
  RelationType,
  Entity,
  HyperEdge,
} from '../types/ontology.js';

export interface ExtractionOptions {
  title?: string;
  chapter?: number;
  mergeExisting?: boolean;  // 기존 엔티티와 병합 여부
}

export interface ConsistencyResult {
  hasConflicts: boolean;
  conflicts: Array<{
    type: 'temporal' | 'spatial' | 'relationship' | 'setting' | 'knowledge';
    severity: 'critical' | 'warning' | 'minor';
    existing: string;
    new: string;
    description: string;
    suggestion: string;
  }>;
  newElements: Array<{
    type: string;
    description: string;
  }>;
}

export class ExtractionService {
  private llm: LLMClient;
  private graph: HyperGraph;

  constructor(graph: HyperGraph, llmClient?: LLMClient) {
    this.graph = graph;
    this.llm = llmClient || createLLMClient();
  }

  /**
   * 텍스트에서 온톨로지 추출 및 그래프에 등록
   */
  async extractAndRegister(
    text: string,
    options: ExtractionOptions = {}
  ): Promise<{ entities: Entity[]; edges: HyperEdge[] }> {
    const { title = '무제', chapter = 1, mergeExisting = true } = options;

    // 1. LLM으로 추출
    const prompt = NOVEL_ONTOLOGY_INSTRUCTION
      .replace('{{title}}', title)
      .replace('{{chapter}}', String(chapter))
      .replace('{{text}}', text);

    const result = await this.llm.generateJSON<ExtractionResult>(
      NOVEL_ONTOLOGY_SYSTEM,
      prompt,
      { temperature: 0.2 }
    );

    // 2. 엔티티 등록
    const registeredEntities: Entity[] = [];
    const entityNameToId: Map<string, string> = new Map();

    for (const rawEntity of result.entities) {
      let entity: Entity | undefined;

      if (mergeExisting) {
        // 기존 엔티티 찾기 (이름 또는 별칭으로)
        entity = this.graph.findEntityByName(rawEntity.name);
        if (!entity && rawEntity.aliases) {
          for (const alias of rawEntity.aliases) {
            entity = this.graph.findEntityByName(alias);
            if (entity) break;
          }
        }
      }

      if (entity) {
        // 기존 엔티티 업데이트
        const updatedAliases = [
          ...(entity.aliases || []),
          ...(rawEntity.aliases || []),
        ].filter((v, i, arr) => arr.indexOf(v) === i);

        this.graph.updateEntity(entity.id, {
          aliases: updatedAliases,
          description: rawEntity.description || entity.description,
          attributes: { ...entity.attributes, ...rawEntity.attributes },
        });
        entityNameToId.set(rawEntity.name, entity.id);
        registeredEntities.push(entity);
      } else {
        // 새 엔티티 등록
        entity = this.graph.addEntity(rawEntity.name, rawEntity.category, {
          aliases: rawEntity.aliases,
          description: rawEntity.description,
          attributes: rawEntity.attributes,
          firstMention: {
            chapter,
          },
        });
        entityNameToId.set(rawEntity.name, entity.id);
        registeredEntities.push(entity);
      }

      // 별칭도 매핑
      if (rawEntity.aliases) {
        for (const alias of rawEntity.aliases) {
          entityNameToId.set(alias, entity.id);
        }
      }
    }

    // 3. 관계(하이퍼엣지) 등록
    const registeredEdges: HyperEdge[] = [];

    for (const rawRel of result.relationships) {
      // 엔티티 이름을 ID로 변환
      const entityIds: string[] = [];
      let allFound = true;

      for (const entityName of rawRel.entities) {
        const id = entityNameToId.get(entityName);
        if (id) {
          entityIds.push(id);
        } else {
          // 그래프에서 직접 찾기
          const entity = this.graph.findEntityByName(entityName);
          if (entity) {
            entityIds.push(entity.id);
          } else {
            console.warn(`Entity not found: ${entityName}`);
            allFound = false;
          }
        }
      }

      if (!allFound || entityIds.length < 2) {
        continue;
      }

      const edge = this.graph.addHyperEdge(
        rawRel.relation_type as RelationType,
        entityIds,
        rawRel.statement,
        {
          timeline: rawRel.timeline
            ? {
                start: rawRel.timeline.time_description,
                chapter: rawRel.timeline.chapter || chapter,
              }
            : undefined,
          sentiment: rawRel.sentiment,
          strength: rawRel.strength,
          sourceRef: {
            chapter: rawRel.source_chapter || chapter,
            paragraph: rawRel.source_paragraph,
          },
        }
      );

      if (edge) {
        registeredEdges.push(edge);
      }
    }

    return { entities: registeredEntities, edges: registeredEdges };
  }

  /**
   * 캐릭터 상세 정보 추출
   */
  async extractCharacterDetails(
    characterName: string,
    text: string
  ): Promise<any> {
    const prompt = CHARACTER_DETAIL_INSTRUCTION
      .replace(/\{\{characterName\}\}/g, characterName)
      .replace('{{text}}', text);

    return this.llm.generateJSON(NOVEL_ONTOLOGY_SYSTEM, prompt, {
      temperature: 0.2,
    });
  }

  /**
   * 두 캐릭터 간 관계 변화 추적
   */
  async trackRelationshipChanges(
    char1: string,
    char2: string,
    text: string
  ): Promise<any> {
    const prompt = RELATIONSHIP_CHANGE_INSTRUCTION
      .replace(/\{\{char1\}\}/g, char1)
      .replace(/\{\{char2\}\}/g, char2)
      .replace('{{text}}', text);

    return this.llm.generateJSON(NOVEL_ONTOLOGY_SYSTEM, prompt, {
      temperature: 0.2,
    });
  }

  /**
   * 설정 일관성 검사
   */
  async checkConsistency(newText: string): Promise<ConsistencyResult> {
    const existingOntology = JSON.stringify(this.graph.toJSON(), null, 2);

    const prompt = CONSISTENCY_CHECK_INSTRUCTION
      .replace('{{existingOntology}}', existingOntology)
      .replace('{{newText}}', newText);

    return this.llm.generateJSON<ConsistencyResult>(
      NOVEL_ONTOLOGY_SYSTEM,
      prompt,
      { temperature: 0.1 }
    );
  }

  /**
   * 챕터 단위 일괄 처리
   */
  async processChapters(
    chapters: Array<{ text: string; chapter: number }>,
    title: string
  ): Promise<void> {
    console.log(`Processing ${chapters.length} chapters for "${title}"...`);

    for (const { text, chapter } of chapters) {
      console.log(`\nProcessing chapter ${chapter}...`);

      const result = await this.extractAndRegister(text, {
        title,
        chapter,
        mergeExisting: true,
      });

      console.log(
        `  - Entities: ${result.entities.length}`
      );
      console.log(
        `  - Relationships: ${result.edges.length}`
      );
    }

    this.graph.printStats();
  }

  /**
   * 현재 그래프 반환
   */
  getGraph(): HyperGraph {
    return this.graph;
  }
}
