/**
 * 소설 온톨로지 타입 정의
 * 하이퍼그래프 기반 인물 관계도 시스템
 */

// ============================================
// 엔티티 카테고리 (소설 도메인)
// ============================================
export type EntityCategory =
  | 'character'      // 인물: 주인공, 조연, 악역 등
  | 'location'       // 장소: 왕국, 마을, 던전, 건물 등
  | 'organization'   // 조직: 길드, 국가, 가문, 종교 등
  | 'item'           // 아이템: 무기, 도구, 마법 물품 등
  | 'creature'       // 생물: 동물, 몬스터, 정령 등
  | 'event'          // 사건: 전쟁, 축제, 재해 등
  | 'concept'        // 개념: 마법, 기술, 법칙 등
  | 'time_period'    // 시간: 시대, 날짜, 기간 등
  | 'status'         // 상태: 직위, 신분, 능력치 등
  | 'emotion';       // 감정: 관계의 감정 상태

// ============================================
// 관계 유형 (소설 도메인)
// ============================================
export type RelationType =
  // 인물 관계
  | 'family'         // 가족 관계 (부모-자식, 형제 등)
  | 'romantic'       // 연인/배우자 관계
  | 'friendship'     // 친구/동료 관계
  | 'rivalry'        // 라이벌/적대 관계
  | 'mentor'         // 스승-제자 관계
  | 'subordinate'    // 상하 관계 (주군-신하, 고용 등)
  // 소속/소유
  | 'belongs_to'     // ~에 소속되다
  | 'owns'           // ~를 소유하다
  | 'rules'          // ~를 통치/지배하다
  // 위치/시간
  | 'located_at'     // ~에 위치하다
  | 'occurred_at'    // ~에서 발생하다 (시간/장소)
  | 'during'         // ~기간 동안
  // 행위/상태
  | 'participates'   // ~에 참여하다
  | 'causes'         // ~를 야기하다
  | 'transforms'     // ~로 변화하다
  | 'knows'          // ~를 알다/인지하다
  | 'has_status'     // ~상태를 갖다
  // 일반
  | 'related_to';    // 일반적 관련

// ============================================
// 엔티티 (노드)
// ============================================
export interface Entity {
  id: string;                    // 고유 ID (E0001, E0002...)
  name: string;                  // 이름
  aliases?: string[];            // 별칭/이명
  category: EntityCategory;      // 카테고리
  description?: string;          // 설명
  attributes?: Record<string, any>; // 추가 속성 (나이, 성별, 능력 등)
  firstMention?: SourceRef;      // 첫 등장 위치
  mentions?: SourceRef[];        // 언급 위치들
}

// ============================================
// 하이퍼엣지 (관계)
// ============================================
export interface HyperEdge {
  id: string;                    // 고유 ID (H0001, H0002...)
  type: RelationType;            // 관계 유형
  entities: string[];            // 연결된 엔티티 ID들 (2개 이상)
  statement: string;             // 관계 설명 문장

  // 시간적 정보
  timeline?: {
    start?: string;              // 시작 시점 (작품 내 시간)
    end?: string;                // 종료 시점 (null이면 현재 진행중)
    chapter?: number;            // 챕터/에피소드 번호
  };

  // 감정/강도 (인물 관계용)
  sentiment?: 'positive' | 'negative' | 'neutral' | 'complex';
  strength?: number;             // 1-10 관계 강도

  // 출처 정보
  sourceRef?: SourceRef;
}

// ============================================
// 출처 참조
// ============================================
export interface SourceRef {
  chapter?: number;              // 챕터 번호
  episode?: number;              // 에피소드 번호
  paragraph?: number;            // 문단 번호
  page?: number;                 // 페이지 번호
  lineStart?: number;            // 시작 라인
  lineEnd?: number;              // 종료 라인
  originalText?: string;         // 원문 발췌
}

// ============================================
// 타임라인 포인트
// ============================================
export interface TimelinePoint {
  id: string;                    // 고유 ID (T0001...)
  name: string;                  // 사건/시점 이름
  description?: string;          // 설명
  storyTime: string;             // 작품 내 시간 (예: "왕력 127년 봄")
  chapter?: number;              // 챕터 번호
  entities: string[];            // 관련 엔티티 ID들
  edges: string[];               // 이 시점에 활성화된 관계 ID들
}

// ============================================
// 관계 스냅샷 (특정 시점의 관계 상태)
// ============================================
export interface RelationshipSnapshot {
  timelinePointId: string;       // 타임라인 포인트 ID
  activeEdges: string[];         // 활성화된 하이퍼엣지 ID들
  entityStates: Record<string, {
    status?: string;             // 해당 시점 상태
    location?: string;           // 해당 시점 위치
    notes?: string;              // 메모
  }>;
}

// ============================================
// 전체 온톨로지 구조
// ============================================
export interface NovelOntology {
  // 메타데이터
  metadata: {
    title: string;               // 작품 제목
    author?: string;             // 작가
    createdAt: string;           // 생성일
    updatedAt: string;           // 수정일
    version: string;             // 버전
  };

  // 핵심 데이터
  entities: Record<string, Entity>;        // 엔티티 맵
  hyperedges: Record<string, HyperEdge>;   // 하이퍼엣지 맵

  // 시간축 데이터
  timeline: TimelinePoint[];               // 타임라인
  snapshots: Record<string, RelationshipSnapshot>; // 시점별 스냅샷

  // 통계
  stats: {
    totalEntities: number;
    totalEdges: number;
    entitiesByCategory: Record<EntityCategory, number>;
    edgesByType: Record<RelationType, number>;
  };
}

// ============================================
// LLM 추출 결과 (JSON Schema용)
// ============================================
export interface ExtractionResult {
  entities: Array<{
    name: string;
    category: EntityCategory;
    aliases?: string[];
    description?: string;
    attributes?: Record<string, any>;
  }>;
  relationships: Array<{
    statement: string;
    entities: string[];           // 엔티티 이름들
    relation_type: RelationType;
    timeline?: {
      time_description?: string;  // 시간 설명
      chapter?: number;
    };
    sentiment?: 'positive' | 'negative' | 'neutral' | 'complex';
    strength?: number;
    source_chapter?: number;
    source_paragraph?: number;
  }>;
}

// ============================================
// 캐릭터 연대기 (Character Chronicle)
// ============================================
export interface CharacterChronicle {
  characterId: string;
  events: Array<{
    timelinePointId: string;
    description: string;
    relatedEntities: string[];
    emotionalState?: string;
    location?: string;
  }>;
}
