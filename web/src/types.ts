/**
 * 지식 그래프 타입 정의
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
  | '소속'
  | '포함'
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
  importance?: number;  // 중요도 1~10 (10이 가장 중요)
  sourceFile?: string;  // 엔티티가 처음 등장한 파일명
}

export interface HyperEdge {
  id: string;
  type: RelationType | string;  // 한글 타입도 허용
  entities: string[];
  statement: string;
  quote?: string;  // 원문 인용
  timeline?: {
    start?: string;
    end?: string;
    chapter?: number;
  };
  sentiment?: 'positive' | 'negative' | 'neutral' | 'complex';
  strength?: number;
  sourceRef?: SourceRef;
  scenes?: string[];  // 등장 장면 ID 목록
  sourceFile?: string;  // 관계가 발생한 파일명
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

export interface Chapter {
  id: string;
  number: number;
  title: string;
  summary?: string;
}

// 사용 가능한 모델 목록
export interface ModelInfo {
  id: string;
  name: string;
  inputCost: number;  // per 1M tokens, USD
  outputCost: number; // per 1M tokens, USD
  description: string;
}

// 성능 순으로 정렬 (벤치마크 기준, 최고 → 최저)
export const AVAILABLE_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', inputCost: 3.00, outputCost: 15.00, description: '1위 - 최고 품질' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', inputCost: 2.50, outputCost: 10.00, description: '2위 - 고품질' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', inputCost: 0.14, outputCost: 0.28, description: '3위 - 가성비 최고 ⭐' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', inputCost: 0.10, outputCost: 0.40, description: '4위 - 빠르고 저렴' },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', inputCost: 0.35, outputCost: 0.40, description: '5위 - 준수한 성능' },
  { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro', inputCost: 1.25, outputCost: 5.00, description: '6위 - 비싼 편' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', inputCost: 0.15, outputCost: 0.60, description: '7위 - 경량' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', inputCost: 0.25, outputCost: 1.25, description: '8위 - 경량' },
  { id: 'google/gemini-2.0-flash-lite-preview-02-05', name: 'Gemini 2.0 Flash Lite', inputCost: 0.075, outputCost: 0.30, description: '9위 - 가장 저렴' },
];

export const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

// 업로드된 소스 파일 정보
export interface SourceFile {
  id: string;
  fileName: string;  // 원본 파일명
  uploadedAt: string;
  text: string;  // 원본 텍스트
  charCount: number;  // 글자 수
}

// 장면 스냅샷
export interface SceneSnapshot {
  sceneId: string;
  order: number;  // 서술 순서 (텍스트에 나온 순서, 1화/2화/3화...)
  chapter: string | null;
  chapterNumber: number | null;
  time: string;
  timeMarker: string | null;  // 텍스트에 명시된 시간 표현만 (예: "10년 전", "다음 날") - 추측 금지, 없으면 null
  location: string;
  summary: string;
  events: string[];
  mood?: string;
  charactersPresent: string[];
  activeEdges: string[];
  sourceFile?: string;  // 이 장면이 추출된 원본 파일명
  sourceFileId?: string;  // 원본 파일 ID (F0001 형식)
}

export interface NovelKnowledgeGraph {
  metadata: {
    id?: string;  // 저장 후 할당되는 고유 ID
    title: string;
    author?: string;
    createdAt: string;
    updatedAt: string;
    version: string;
    model?: string;  // 분석에 사용된 모델 ID
    sourceFiles?: SourceFile[];  // 업로드된 파일 목록
  };
  entities: Record<string, Entity>;
  hyperedges: Record<string, HyperEdge>;
  chapters?: Record<string, Chapter>;
  timeline: TimelinePoint[];
  snapshots: Record<string, SceneSnapshot>;
  stats: {
    totalEntities: number;
    totalEdges: number;
    totalChapters?: number;
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
