/**
 * Character Relationship Chart
 * 소설 인물 관계도 온톨로지 시스템
 *
 * Story-Forge 프로젝트용 기능 모듈
 */

// Types
export * from './types/ontology.js';

// Models
export { HyperGraph } from './models/hypergraph.js';

// Services
export { LLMClient, createLLMClient, CHEAP_MODELS } from './services/llm-client.js';
export { ExtractionService } from './services/extraction-service.js';

// Prompts
export {
  NOVEL_ONTOLOGY_SYSTEM,
  NOVEL_ONTOLOGY_INSTRUCTION,
  CHARACTER_DETAIL_INSTRUCTION,
  RELATIONSHIP_CHANGE_INSTRUCTION,
  CONSISTENCY_CHECK_INSTRUCTION,
} from './prompts/extraction-prompts.js';

// 간단한 사용 예제
export function createNovelOntology(title: string, author?: string) {
  const { HyperGraph } = require('./models/hypergraph.js');
  const { ExtractionService } = require('./services/extraction-service.js');

  const graph = new HyperGraph(title, author);
  const extractor = new ExtractionService(graph);

  return {
    graph,
    extractor,

    /**
     * 텍스트에서 온톨로지 추출
     */
    async extract(text: string, chapter?: number) {
      return extractor.extractAndRegister(text, { title, chapter });
    },

    /**
     * 설정 일관성 검사
     */
    async validate(newText: string) {
      return extractor.checkConsistency(newText);
    },

    /**
     * JSON으로 내보내기
     */
    toJSON() {
      return graph.toJSON();
    },

    /**
     * 캐릭터 연대기 생성
     */
    getCharacterChronicle(characterName: string) {
      const entity = graph.findEntityByName(characterName);
      if (!entity) return null;
      return graph.getCharacterChronicle(entity.id);
    },
  };
}
