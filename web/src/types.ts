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
  | '출신'
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
  /**
   * @deprecated UI에서 사용하지 말 것
   * - 파일 수정/삭제 시 동기화 문제로 인해 UI 표시에서 제외됨
   * - 데이터는 유지됨 (향후 채팅 기능에서 활용 예정)
   */
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
  creditsPerChunk: number;        // 분석 청크당 예상 크레딧 (로어북 포함, 서버 계산)
  creditsPerChunkNoLore: number;  // 분석 청크당 예상 크레딧 (로어북 제외, 서버 계산)
  creditsPerChat: number;         // 채팅 1회당 기본 크레딧 (서버 계산)
  description: string;
  available?: boolean;          // OpenRouter에서 현재 사용 가능 여부
  coreModel?: boolean;          // 핵심 모델 여부 (요금제별 접근 제어용)
}

/** 모델 조회 실패 시 폴백 크레딧 값 (unknown 모델 기준 — 중간 가격대) */
export const DEFAULT_CREDITS_PER_CHUNK = 18;
export const DEFAULT_CREDITS_PER_CHUNK_NO_LORE = 10;
export const DEFAULT_CREDITS_PER_CHAT = 10;

/** 큐레이션 메타데이터: 소설 분석에 적합한 모델만 선별 + 한국어 설명 + 정렬 순서 */
export interface CuratedModelMeta {
  description: string;
  sortOrder: number;
  coreModel: boolean;
}

/**
 * OpenRouter 400+개 모델 중 소설 분석에 적합한 모델만 큐레이션.
 * key = OpenRouter 모델 ID, value = 한국어 설명 + 정렬 순서 (낮을수록 상위).
 * 동적 모델 로딩 시 이 목록에 있는 모델만 표시됨.
 */
export const CURATED_MODEL_META: Record<string, CuratedModelMeta> = {
  // 핵심 모델 (coreModel: true)
  'google/gemini-2.5-flash': { description: '경제적 (기본)', sortOrder: 10, coreModel: true },
  'openai/gpt-5-mini': { description: '추천', sortOrder: 25, coreModel: true },
  'anthropic/claude-haiku-4.5': { description: '균형', sortOrder: 30, coreModel: true },
  'anthropic/claude-sonnet-4.5': { description: '최고 품질', sortOrder: 40, coreModel: true },
  // 추가 모델 (coreModel: false)
  'google/gemini-2.5-flash-lite': { description: '가장 저렴', sortOrder: 50, coreModel: false },
  'deepseek/deepseek-v3.2': { description: '가성비', sortOrder: 55, coreModel: false },
  'openai/gpt-5.1': { description: 'GPT 프리미엄', sortOrder: 60, coreModel: false },
  'google/gemini-2.5-pro': { description: 'Gemini 프리미엄', sortOrder: 65, coreModel: false },
  'google/gemini-3-flash-preview': { description: '차세대 (실험)', sortOrder: 70, coreModel: false },
};

/**
 * 정적 폴백 모델 목록 (API 불가 시 사용).
 * 동적 로딩 성공 시 이 목록은 사용되지 않음.
 * creditsPerChunk/creditsPerChat 값은 서버 수식으로 사전 계산된 근사값.
 */
export const FALLBACK_MODELS: ModelInfo[] = [
  // 핵심 4종 (creditsPerChunkNoLore = 서버 computeCreditsPerChunk(model, dm, false) 근사치)
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', creditsPerChunk: 14.32, creditsPerChunkNoLore: 8.33, creditsPerChat: 12, description: '경제적 (기본)', coreModel: true },
  { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', creditsPerChunk: 12.08, creditsPerChunkNoLore: 7.05, creditsPerChat: 10, description: '추천', coreModel: true },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', creditsPerChunk: 27.69, creditsPerChunkNoLore: 15.66, creditsPerChat: 27, description: '균형', coreModel: true },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', creditsPerChunk: 64.04, creditsPerChunkNoLore: 35.98, creditsPerChat: 61, description: '최고 품질', coreModel: true },
  // 추가 5종
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', creditsPerChunk: 4.07, creditsPerChunkNoLore: 2.50, creditsPerChat: 5, description: '가장 저렴', coreModel: false },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', creditsPerChunk: 5.59, creditsPerChunkNoLore: 3.22, creditsPerChat: 9, description: '가성비', coreModel: false },
  { id: 'openai/gpt-5.1', name: 'GPT-5.1', creditsPerChunk: 42.87, creditsPerChunkNoLore: 24.49, creditsPerChat: 34, description: 'GPT 프리미엄', coreModel: false },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', creditsPerChunk: 42.87, creditsPerChunkNoLore: 24.49, creditsPerChat: 34, description: 'Gemini 프리미엄', coreModel: false },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', creditsPerChunk: 17.70, creditsPerChunkNoLore: 10.14, creditsPerChat: 16, description: '차세대 (실험)', coreModel: false },
];

export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

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

// ==================== Lorebook ====================

/** 로어북 엔트리 카테고리 */
export type LoreCategory =
  | 'appearance'           // 외모 (머리, 체형, 흉터 등)
  | 'outfit'               // 복장/장비 (옷, 무기, 소지품)
  | 'personality'          // 성격/말투/습관
  | 'ability'              // 능력/기술/직업스킬
  | 'background'           // 배경/출신/과거
  | 'motivation'           // 목표/동기
  | 'relationship_detail'  // 관계 상세 ("A를 형이라 부른다")
  | 'lore';                // 세계관/설정 (규칙, 체계, 장소 묘사 등)

/** 로어북 개별 기록 (1개 = 1개 사실, 1개 장면) */
export interface LoreEntry {
  id: string;              // "LR0001"
  entityName: string;      // KG 엔티티와 매칭용 이름
  category: LoreCategory;
  content: string;         // 기록 내용
  quote?: string;          // 원문 대사/인용 (있으면)
  sceneId: string;         // "S0003" — 단일 장면 연결
  sourceFileId?: string;   // "F0002" — 파일 삭제 시 연동
}

/** 로어북 전체 */
export interface Lorebook {
  entries: Record<string, LoreEntry>;
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
  validationResults?: Record<string, FileValidationResult>;  // 파일별 검증 결과
  lorebook?: Lorebook;  // 로어북 (인물 프로필, 세계관 설정 등)
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

// ==================== Partial Analysis ====================

export interface PartialAnalysisInfo {
  processedChunks: number;
  totalChunks: number;
  title: string;
  timestamp: number;
  model?: string;
}

// ==================== UI ====================

export type ViewMode = 'graph' | 'timeline' | 'chronicle' | 'world' | 'lorebook' | 'source' | 'chat';

// ==================== Billing ====================

/** API 응답(snake_case)을 그대로 사용 — 변환 비용 대비 이점 없음 */
export interface PlanFeatures {
  byok: boolean;
  models: string[] | 'all';
  max_file_size_mb: number;
  can_purchase_credits: boolean;
  max_chats_per_analysis: number;  // -1 = 무제한
  max_saved_graphs: number;        // -1 = 무제한
  max_versions: number;            // -1 = 무제한
  export_formats: string[];        // [] = 불가, ['png'], ['png', 'svg']
}

export interface BillingSubscription {
  plan: string;
  planName: string;
  creditBalance: number;
  purchasedCreditBalance: number;
  monthlyCredits: number;
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
  summary?: string;           // 검토 내용 요약
}

// ==================== Batch Analysis ====================

export type BatchItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface QueueItem {
  id: string;
  fileName: string;
  text: string;
  charCount: number;
  model: string;
  status: BatchItemStatus;
  progress?: string;
  progressCurrent?: number;
  progressTotal?: number;
  error?: string;
  creditCost?: number;
}
