/**
 * 온톨로지 타입 정의
 */

export type EntityCategory =
  | 'character'
  | 'location'
  | 'organization'
  | 'item'
  | 'creature'
  | 'event'
  | 'concept'
  | 'time_period'
  | 'status'
  | 'emotion';

export type RelationType =
  // 영어 (하위호환)
  | 'family'
  | 'romantic'
  | 'friendship'
  | 'rivalry'
  | 'mentor'
  | 'subordinate'
  | 'belongs_to'
  | 'owns'
  | 'rules'
  | 'located_at'
  | 'occurred_at'
  | 'during'
  | 'participates'
  | 'causes'
  | 'transforms'
  | 'knows'
  | 'has_status'
  | 'related_to'
  // 한글
  | '가족'
  | '연인'
  | '친구'
  | '적대'
  | '동료'
  | '주인'
  | '위치'
  | '소유'
  | '관련';

export interface SourceRef {
  chapter?: number;
  episode?: number;
  paragraph?: number;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  originalText?: string;
}

export interface Entity {
  id: string;
  name: string;
  aliases?: string[];
  category: EntityCategory;
  description?: string;
  attributes?: Record<string, any>;
  firstMention?: SourceRef;
  mentions?: SourceRef[];
  scenes?: string[];  // 등장 장면 ID 목록
}

export interface HyperEdge {
  id: string;
  type: RelationType | string;  // 한글 타입도 허용
  entities: string[];
  statement: string;
  timeline?: {
    start?: string;
    end?: string;
    chapter?: number;
  };
  sentiment?: 'positive' | 'negative' | 'neutral' | 'complex';
  strength?: number;
  sourceRef?: SourceRef;
  scenes?: string[];  // 등장 장면 ID 목록
}

export interface TimelinePoint {
  id: string;
  name: string;
  description?: string;
  storyTime: string;
  chapter?: number;
  entities: string[];
  edges: string[];
}

export interface NovelOntology {
  metadata: {
    title: string;
    author?: string;
    createdAt: string;
    updatedAt: string;
    version: string;
  };
  entities: Record<string, Entity>;
  hyperedges: Record<string, HyperEdge>;
  timeline: TimelinePoint[];
  snapshots: Record<string, any>;
  stats: {
    totalEntities: number;
    totalEdges: number;
    entitiesByCategory: Record<EntityCategory, number>;
    edgesByType: Record<RelationType, number>;
  };
}

// 캐릭터 연대기
export interface ChronicleEvent {
  id: string;
  time: string;
  chapter?: number;
  description: string;
  relatedEntities: Entity[];
  edges: HyperEdge[];
  sentiment?: string;
}
