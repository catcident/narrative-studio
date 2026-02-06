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
  subtype?: string;
  bidirectional?: boolean;
  fromPerspective?: string;
  toPerspective?: string;
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
  available?: boolean;          // OpenRouter에서 현재 사용 가능 여부
}

/** 큐레이션 메타데이터: 소설 분석에 적합한 모델만 선별 + 한국어 설명 + 정렬 순서 */
export interface CuratedModelMeta {
  description: string;
  sortOrder: number;
}

/**
 * OpenRouter 400+개 모델 중 소설 분석에 적합한 모델만 큐레이션.
 * key = OpenRouter 모델 ID, value = 한국어 설명 + 정렬 순서 (낮을수록 상위).
 * 동적 모델 로딩 시 이 목록에 있는 모델만 표시됨.
 */
export const CURATED_MODEL_META: Record<string, CuratedModelMeta> = {
  'anthropic/claude-sonnet-4': { description: '최고 품질', sortOrder: 10 },
  'anthropic/claude-3.5-sonnet': { description: '최고 품질', sortOrder: 11 },
  'openai/gpt-4o': { description: '고품질', sortOrder: 20 },
  'deepseek/deepseek-chat': { description: '가성비', sortOrder: 30 },
  'google/gemini-2.0-flash-001': { description: '빠르고 저렴', sortOrder: 40 },
  'google/gemini-2.5-flash': { description: '빠르고 저렴', sortOrder: 41 },
  'qwen/qwen-2.5-72b-instruct': { description: '준수한 성능', sortOrder: 50 },
  'openai/gpt-4o-mini': { description: '경량', sortOrder: 60 },
  'anthropic/claude-3-haiku': { description: '경량', sortOrder: 70 },
  'google/gemini-2.5-flash-lite': { description: '가장 저렴', sortOrder: 80 },
};

/**
 * 정적 폴백 모델 목록 (API 불가 시 사용).
 * 동적 로딩 성공 시 이 목록은 사용되지 않음.
 */
export const AVAILABLE_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', inputCost: 3.00, outputCost: 15.00, description: '최고 품질' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', inputCost: 3.00, outputCost: 15.00, description: '최고 품질' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', inputCost: 2.50, outputCost: 10.00, description: '고품질' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', inputCost: 0.14, outputCost: 0.28, description: '가성비' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', inputCost: 0.10, outputCost: 0.40, description: '빠르고 저렴' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', inputCost: 0.15, outputCost: 0.60, description: '빠르고 저렴' },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', inputCost: 0.12, outputCost: 0.39, description: '준수한 성능' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', inputCost: 0.15, outputCost: 0.60, description: '경량' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', inputCost: 0.25, outputCost: 1.25, description: '경량' },
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', inputCost: 0.075, outputCost: 0.30, description: '가장 저렴' },
];

export const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

/** available !== false인 모델의 ID 배열 반환 (orchestrator availableModelIds용) */
export function getAvailableModelIds(models: ModelInfo[]): string[] {
  return models.filter((m) => m.available !== false).map((m) => m.id);
}

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

// ==================== UI ====================

export type ViewMode = 'graph' | 'timeline' | 'chronicle' | 'world' | 'source' | 'chat';

// ==================== Billing ====================

/** API 응답(snake_case)을 그대로 사용 — 변환 비용 대비 이점 없음 */
export interface PlanFeatures {
  byok: boolean;
  models: string[] | 'all';
  max_file_size_mb: number;
  can_purchase_credits: boolean;
}

export interface BillingSubscription {
  plan: string;
  planName: string;
  creditBalance: number;
  features: PlanFeatures;
  creditResetAt: string | null;
  status: string;
}

export interface ChunkUsage {
  chunkIndex: number;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface CurrentUsage {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  chunks: ChunkUsage[];
}

export interface CreditTransaction {
  id: number;
  amount: number;
  balance_after: number;
  tx_type: string;
  tx_type_display: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ==================== Validation ====================

/** 파일 검증 상태 */
export type ValidationStatus = 'pending' | 'validating' | 'passed' | 'failed' | 'invalidated';

/** 검증 이슈 유형 */
export type ValidationIssueType =
  | 'character_inconsistency'  // 캐릭터 설정 불일치
  | 'worldbuilding_error'      // 세계관 설정 오류
  | 'timeline_conflict'        // 시간축 충돌
  | 'location_inconsistency'   // 장소 설정 불일치
  | 'relationship_conflict'    // 관계 설정 충돌
  | 'item_inconsistency'       // 아이템/소품 불일치
  | 'other';                   // 기타

/** 검증 이슈 */
export interface ValidationIssue {
  id: string;
  type: ValidationIssueType;
  severity: 'error' | 'warning';  // error: 명백한 오류, warning: 의심스러운 부분
  description: string;
  entityIds?: string[];       // 관련 엔티티
  sceneIds?: string[];        // 관련 장면
  previousFileId?: string;    // 충돌하는 이전 파일 ID
  suggestion?: string;        // 수정 제안
}

/** 파일별 검증 결과 */
export interface FileValidationResult {
  fileId: string;
  status: ValidationStatus;
  validatedAt: string | null;
  issues: ValidationIssue[];
  comparedWith: string[];     // 비교한 파일 ID 목록
}
