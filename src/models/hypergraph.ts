/**
 * 하이퍼그래프 모델 클래스
 * 엔티티와 하이퍼엣지를 관리하는 핵심 데이터 구조
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Entity,
  EntityCategory,
  HyperEdge,
  RelationType,
  TimelinePoint,
  RelationshipSnapshot,
  NovelOntology,
  SourceRef,
  CharacterChronicle,
} from '../types/ontology.js';

export class HyperGraph {
  private entities: Map<string, Entity> = new Map();
  private hyperedges: Map<string, HyperEdge> = new Map();
  private timeline: TimelinePoint[] = [];
  private snapshots: Map<string, RelationshipSnapshot> = new Map();

  private metadata: NovelOntology['metadata'];

  constructor(title: string, author?: string) {
    this.metadata = {
      title,
      author,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0.0',
    };
  }

  // ============================================
  // 엔티티 관리
  // ============================================

  /**
   * 엔티티 추가
   */
  addEntity(
    name: string,
    category: EntityCategory,
    options?: Partial<Omit<Entity, 'id' | 'name' | 'category'>>
  ): Entity {
    const id = this.generateId('E');
    const entity: Entity = {
      id,
      name,
      category,
      ...options,
    };
    this.entities.set(id, entity);
    this.updateTimestamp();
    return entity;
  }

  /**
   * 이름으로 엔티티 찾기 (별칭 포함)
   */
  findEntityByName(name: string): Entity | undefined {
    for (const entity of this.entities.values()) {
      if (entity.name === name) return entity;
      if (entity.aliases?.includes(name)) return entity;
    }
    return undefined;
  }

  /**
   * 엔티티 가져오기
   */
  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * 카테고리별 엔티티 목록
   */
  getEntitiesByCategory(category: EntityCategory): Entity[] {
    return Array.from(this.entities.values()).filter(e => e.category === category);
  }

  /**
   * 모든 엔티티
   */
  getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  /**
   * 엔티티 업데이트
   */
  updateEntity(id: string, updates: Partial<Omit<Entity, 'id'>>): Entity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;

    const updated = { ...entity, ...updates };
    this.entities.set(id, updated);
    this.updateTimestamp();
    return updated;
  }

  // ============================================
  // 하이퍼엣지 관리
  // ============================================

  /**
   * 하이퍼엣지 추가 (2개 이상의 엔티티 연결)
   */
  addHyperEdge(
    type: RelationType,
    entityIds: string[],
    statement: string,
    options?: Partial<Omit<HyperEdge, 'id' | 'type' | 'entities' | 'statement'>>
  ): HyperEdge | null {
    // 최소 2개의 엔티티 필요
    if (entityIds.length < 2) {
      console.warn('HyperEdge requires at least 2 entities');
      return null;
    }

    // 모든 엔티티가 존재하는지 확인
    for (const entityId of entityIds) {
      if (!this.entities.has(entityId)) {
        console.warn(`Entity ${entityId} not found`);
        return null;
      }
    }

    const id = this.generateId('H');
    const edge: HyperEdge = {
      id,
      type,
      entities: entityIds,
      statement,
      ...options,
    };
    this.hyperedges.set(id, edge);
    this.updateTimestamp();
    return edge;
  }

  /**
   * 이름으로 하이퍼엣지 추가 (편의 메서드)
   */
  addHyperEdgeByNames(
    type: RelationType,
    entityNames: string[],
    statement: string,
    options?: Partial<Omit<HyperEdge, 'id' | 'type' | 'entities' | 'statement'>>
  ): HyperEdge | null {
    const entityIds: string[] = [];

    for (const name of entityNames) {
      const entity = this.findEntityByName(name);
      if (!entity) {
        console.warn(`Entity with name "${name}" not found`);
        return null;
      }
      entityIds.push(entity.id);
    }

    return this.addHyperEdge(type, entityIds, statement, options);
  }

  /**
   * 특정 엔티티와 연결된 모든 하이퍼엣지
   */
  getEdgesForEntity(entityId: string): HyperEdge[] {
    return Array.from(this.hyperedges.values()).filter(edge =>
      edge.entities.includes(entityId)
    );
  }

  /**
   * 두 엔티티 사이의 관계 찾기
   */
  getEdgesBetween(entityId1: string, entityId2: string): HyperEdge[] {
    return Array.from(this.hyperedges.values()).filter(
      edge => edge.entities.includes(entityId1) && edge.entities.includes(entityId2)
    );
  }

  /**
   * 관계 유형별 하이퍼엣지
   */
  getEdgesByType(type: RelationType): HyperEdge[] {
    return Array.from(this.hyperedges.values()).filter(edge => edge.type === type);
  }

  /**
   * 모든 하이퍼엣지
   */
  getAllEdges(): HyperEdge[] {
    return Array.from(this.hyperedges.values());
  }

  // ============================================
  // 타임라인 관리
  // ============================================

  /**
   * 타임라인 포인트 추가
   */
  addTimelinePoint(
    name: string,
    storyTime: string,
    entityIds: string[],
    options?: Partial<Omit<TimelinePoint, 'id' | 'name' | 'storyTime' | 'entities' | 'edges'>>
  ): TimelinePoint {
    const id = this.generateId('T');
    const point: TimelinePoint = {
      id,
      name,
      storyTime,
      entities: entityIds,
      edges: [],
      ...options,
    };
    this.timeline.push(point);
    this.updateTimestamp();
    return point;
  }

  /**
   * 타임라인 포인트에 엣지 연결
   */
  linkEdgeToTimeline(edgeId: string, timelinePointId: string): boolean {
    const point = this.timeline.find(t => t.id === timelinePointId);
    if (!point) return false;

    if (!point.edges.includes(edgeId)) {
      point.edges.push(edgeId);
    }
    return true;
  }

  /**
   * 타임라인 가져오기
   */
  getTimeline(): TimelinePoint[] {
    return this.timeline;
  }

  // ============================================
  // 스냅샷 관리 (특정 시점의 관계 상태)
  // ============================================

  /**
   * 스냅샷 생성
   */
  createSnapshot(timelinePointId: string): RelationshipSnapshot {
    const point = this.timeline.find(t => t.id === timelinePointId);
    const snapshot: RelationshipSnapshot = {
      timelinePointId,
      activeEdges: point?.edges || [],
      entityStates: {},
    };
    this.snapshots.set(timelinePointId, snapshot);
    return snapshot;
  }

  /**
   * 스냅샷에 엔티티 상태 추가
   */
  setEntityStateInSnapshot(
    timelinePointId: string,
    entityId: string,
    state: RelationshipSnapshot['entityStates'][string]
  ): void {
    let snapshot = this.snapshots.get(timelinePointId);
    if (!snapshot) {
      snapshot = this.createSnapshot(timelinePointId);
    }
    snapshot.entityStates[entityId] = state;
  }

  /**
   * 특정 시점의 스냅샷 가져오기
   */
  getSnapshot(timelinePointId: string): RelationshipSnapshot | undefined {
    return this.snapshots.get(timelinePointId);
  }

  // ============================================
  // 캐릭터 연대기
  // ============================================

  /**
   * 특정 캐릭터의 연대기 생성
   */
  getCharacterChronicle(characterId: string): CharacterChronicle {
    const events: CharacterChronicle['events'] = [];

    for (const point of this.timeline) {
      if (point.entities.includes(characterId)) {
        const relatedEdges = point.edges
          .map(edgeId => this.hyperedges.get(edgeId))
          .filter(edge => edge && edge.entities.includes(characterId));

        const snapshot = this.snapshots.get(point.id);
        const entityState = snapshot?.entityStates[characterId];

        events.push({
          timelinePointId: point.id,
          description: point.description || point.name,
          relatedEntities: relatedEdges.flatMap(e => e!.entities.filter(id => id !== characterId)),
          emotionalState: entityState?.status,
          location: entityState?.location,
        });
      }
    }

    return {
      characterId,
      events,
    };
  }

  // ============================================
  // 쿼리 메서드
  // ============================================

  /**
   * 특정 시점에 특정 장소에 있는 캐릭터들
   */
  getCharactersAtLocation(locationId: string, timelinePointId?: string): Entity[] {
    const characters = this.getEntitiesByCategory('character');

    if (!timelinePointId) {
      // 전체 기간 중 해당 장소와 관련된 캐릭터
      return characters.filter(char => {
        const edges = this.getEdgesForEntity(char.id);
        return edges.some(
          edge => edge.type === 'located_at' && edge.entities.includes(locationId)
        );
      });
    }

    // 특정 시점
    const snapshot = this.snapshots.get(timelinePointId);
    if (!snapshot) return [];

    return characters.filter(char => {
      const state = snapshot.entityStates[char.id];
      return state?.location === locationId;
    });
  }

  /**
   * 두 캐릭터 간의 관계 이력
   */
  getRelationshipHistory(char1Id: string, char2Id: string): Array<{
    edge: HyperEdge;
    timelinePoint?: TimelinePoint;
  }> {
    const edges = this.getEdgesBetween(char1Id, char2Id);
    return edges.map(edge => {
      const timelinePoint = this.timeline.find(t => t.edges.includes(edge.id));
      return { edge, timelinePoint };
    });
  }

  // ============================================
  // 직렬화/역직렬화
  // ============================================

  /**
   * 전체 온톨로지를 JSON으로 내보내기
   */
  toJSON(): NovelOntology {
    const entitiesObj: Record<string, Entity> = {};
    const edgesObj: Record<string, HyperEdge> = {};
    const snapshotsObj: Record<string, RelationshipSnapshot> = {};

    this.entities.forEach((v, k) => (entitiesObj[k] = v));
    this.hyperedges.forEach((v, k) => (edgesObj[k] = v));
    this.snapshots.forEach((v, k) => (snapshotsObj[k] = v));

    // 통계 계산
    const entitiesByCategory = {} as Record<EntityCategory, number>;
    const edgesByType = {} as Record<RelationType, number>;

    for (const entity of this.entities.values()) {
      entitiesByCategory[entity.category] = (entitiesByCategory[entity.category] || 0) + 1;
    }

    for (const edge of this.hyperedges.values()) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    }

    return {
      metadata: this.metadata,
      entities: entitiesObj,
      hyperedges: edgesObj,
      timeline: this.timeline,
      snapshots: snapshotsObj,
      stats: {
        totalEntities: this.entities.size,
        totalEdges: this.hyperedges.size,
        entitiesByCategory,
        edgesByType,
      },
    };
  }

  /**
   * JSON에서 온톨로지 불러오기
   */
  static fromJSON(json: NovelOntology): HyperGraph {
    const graph = new HyperGraph(json.metadata.title, json.metadata.author);
    graph.metadata = json.metadata;

    // 엔티티 복원
    for (const [id, entity] of Object.entries(json.entities)) {
      graph.entities.set(id, entity);
    }

    // 하이퍼엣지 복원
    for (const [id, edge] of Object.entries(json.hyperedges)) {
      graph.hyperedges.set(id, edge);
    }

    // 타임라인 복원
    graph.timeline = json.timeline;

    // 스냅샷 복원
    for (const [id, snapshot] of Object.entries(json.snapshots)) {
      graph.snapshots.set(id, snapshot);
    }

    return graph;
  }

  // ============================================
  // 유틸리티
  // ============================================

  private generateId(prefix: 'E' | 'H' | 'T'): string {
    const count =
      prefix === 'E'
        ? this.entities.size
        : prefix === 'H'
        ? this.hyperedges.size
        : this.timeline.length;
    return `${prefix}${String(count + 1).padStart(4, '0')}`;
  }

  private updateTimestamp(): void {
    this.metadata.updatedAt = new Date().toISOString();
  }

  /**
   * 간단한 통계 출력
   */
  printStats(): void {
    console.log('\n=== 온톨로지 통계 ===');
    console.log(`작품: ${this.metadata.title}`);
    console.log(`총 엔티티: ${this.entities.size}`);
    console.log(`총 관계: ${this.hyperedges.size}`);
    console.log(`타임라인 포인트: ${this.timeline.length}`);
    console.log('');
  }
}
