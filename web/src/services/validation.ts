/**
 * 파일 검증 서비스
 * 각 파일의 그래프를 이전 파일들과 비교하여 일관성 검증
 */

import type {
  NovelKnowledgeGraph,
  SourceFile,
  ValidationStatus,
  ValidationIssue,
  FileValidationResult,
  Entity,
  HyperEdge,
  SceneSnapshot,
} from '../types';
import { DEFAULT_MODEL } from '../types';

// ==================== 상수 ====================

// 청크당 최대 문자 수 (LLM 컨텍스트 제한 고려)
const MAX_CONTEXT_CHARS = 15000;

// 원본 텍스트 최대 길이 (파일당)
const MAX_TEXT_PER_FILE = 3000;

// ==================== 타입 ====================

interface ValidationContext {
  apiKey?: string;  // 옵셔널 - 서버에서 환경변수 사용 가능
  model?: string;
  onProgress?: (fileId: string, status: ValidationStatus) => void;
}

interface FileGraphData {
  fileId: string;
  fileName: string;
  entities: Entity[];
  edges: HyperEdge[];
  scenes: SceneSnapshot[];
  originalText?: string;  // 원본 텍스트 (검증용)
}

// ==================== 헬퍼 함수 ====================

/**
 * 파일별 그래프 데이터 추출
 * @param graph 전체 지식 그래프
 * @param file 대상 파일
 * @param scopeFileIds 범위 제한용 파일 ID들 (이 파일들의 장면에서만 엔티티 정보 추출)
 */
function extractFileGraphData(
  graph: NovelKnowledgeGraph,
  file: SourceFile,
  scopeFileIds?: Set<string>
): FileGraphData {
  const fileId = file.id;
  const fileName = file.fileName;

  // 해당 파일의 장면들
  const scenes = Object.values(graph.snapshots).filter(
    (scene) => scene.sourceFileId === fileId || scene.sourceFile === fileName
  );
  const sceneIds = new Set(scenes.map((s) => s.sceneId));

  // 해당 파일에 등장하는 엔티티들
  const entityIds = new Set<string>();
  scenes.forEach((scene) => {
    scene.charactersPresent?.forEach((id) => entityIds.add(id));
    scene.activeEdges?.forEach((edgeId) => {
      const edge = graph.hyperedges[edgeId];
      if (edge) {
        edge.entities.forEach((id) => entityIds.add(id));
      }
    });
  });

  // 엔티티 가져오되, scopeFileIds가 있으면 해당 범위 장면의 정보만 사용
  let entities: Entity[];
  if (scopeFileIds) {
    // 범위 내 파일들의 장면 ID 수집
    const scopeSceneIds = new Set<string>();
    Object.values(graph.snapshots).forEach((scene) => {
      if (scopeFileIds.has(scene.sourceFileId || '')) {
        scopeSceneIds.add(scene.sceneId);
      }
    });

    // 엔티티 정보를 범위 내 장면 기준으로 필터링
    // description/attributes는 검증에서 사용하지 않음 (병합 데이터라 오염 가능)
    entities = Object.values(graph.entities)
      .filter((e) => entityIds.has(e.id));
  } else {
    entities = Object.values(graph.entities).filter((e) =>
      entityIds.has(e.id)
    );
  }

  // 해당 파일의 관계들
  const edges = Object.values(graph.hyperedges).filter(
    (edge) => edge.scenes?.some((sid) => sceneIds.has(sid))
  );

  // 원본 텍스트 전체
  const originalText = file.text;

  return { fileId, fileName, entities, edges, scenes, originalText };
}

/**
 * 엔티티 정보를 문자열로 변환 (LLM 프롬프트용)
 * description/attributes는 병합 데이터라 오염 가능 → 이름/카테고리/별칭만 사용
 */
function entityToString(entity: Entity): string {
  let str = `- ${entity.name} (${entity.category})`;
  if (entity.aliases && entity.aliases.length > 0) {
    str += ` [별칭: ${entity.aliases.join(', ')}]`;
  }
  return str;
}

/**
 * 관계 정보를 문자열로 변환
 * statement는 entity description 복사본일 수 있어 오염 가능 → 타입/참여자만 사용
 */
function edgeToString(edge: HyperEdge, entities: Record<string, Entity>): string {
  const entityNames = edge.entities
    .map((id) => entities[id]?.name || id)
    .join(', ');
  return `- [${edge.type}] ${entityNames}`;
}

/**
 * 장면 정보를 문자열로 변환
 */
function sceneToString(scene: SceneSnapshot): string {
  let str = `- ${scene.sceneId}`;
  if (scene.location) str += ` @ ${scene.location}`;
  if (scene.time) str += ` (${scene.time})`;
  str += `: ${scene.summary}`;
  if (scene.events && scene.events.length > 0) {
    str += `\n  이벤트: ${scene.events.join(', ')}`;
  }
  return str;
}

// ==================== LLM 검증 ====================

const SYSTEM_PROMPT = `소설 챕터의 **설정 오류/모순**을 검증합니다.

## 입력 데이터
- **[기존 설정]**: 이전 챕터들의 지식그래프 (엔티티 목록, 관계)
- **[새 챕터 원본]**: 검증할 새 챕터의 원본 텍스트

## 반드시 찾아야 할 오류 (심각)
1. **종족 불일치**: "고양이"였던 캐릭터가 "개"로 언급됨
2. **출신지 모순**: "숲 출신"이 "도시 출신"으로 바뀜
3. **외형 변경**: "검은 털"이 "흰 털"로 바뀜 (마법/변신 설정 제외)
4. **성별 변경**: 성별이 이전과 다르게 언급됨
5. **갑작스러운 사망**: 사망 장면/암시 없이 "죽어있음"으로 등장

## 오류가 아닌 것 (정상)
- 별칭/애칭 부여
- 새 캐릭터 등장
- 장소 이동
- 시간 경과에 따른 변화
- 세계관 고유 설정 (마법, 특수능력 등)
- 캐릭터의 감정/태도 변화

## 검증 기준
- **기존 설정에 명시적으로 기록된 정보**와 새 챕터 내용이 직접 충돌하는 경우만 오류
- 추측이나 해석이 필요한 경우는 오류로 보지 않음
- 불확실하면 오류로 판정하지 않음

## JSON 응답 형식
{"summary": "1-2문장 요약", "issues": [{"type": "오류 유형", "description": "A가 기존에 X였는데 Y로 언급됨"}]}

오류 없으면: {"summary": "설정 검증 완료, 이상 없음", "issues": []}`;

/**
 * 컨텍스트를 청크로 분할
 */
function splitIntoChunks(
  previousFiles: FileGraphData[],
  currentFile: FileGraphData
): { previousContext: string; currentContext: string }[] {

  // 원본 텍스트가 길면 앞/중간/뒤 부분만 추출
  const truncateText = (text: string | undefined): string => {
    if (!text) return '없음';
    if (text.length <= MAX_TEXT_PER_FILE) return text;
    const partLen = Math.floor(MAX_TEXT_PER_FILE / 3);
    const start = text.slice(0, partLen);
    const middle = text.slice(Math.floor(text.length / 2) - partLen / 2, Math.floor(text.length / 2) + partLen / 2);
    const end = text.slice(-partLen);
    return `${start}\n\n[...중략...]\n\n${middle}\n\n[...중략...]\n\n${end}`;
  };

  // 현재 파일: 원본 텍스트만 (검증 대상)
  const currentContext = `[새 챕터 원본: ${currentFile.fileName}]
${truncateText(currentFile.originalText)}`;

  // 현재 파일에 등장하는 엔티티 ID 수집
  const currentEntityIds = new Set(currentFile.entities.map(e => e.id));

  // 이전 파일들에서 현재 파일 엔티티들의 설정만 추출
  const relevantEntities: Entity[] = [];

  for (const pf of previousFiles) {
    // 현재 파일 엔티티와 겹치는 엔티티만
    pf.entities.forEach(e => {
      if (currentEntityIds.has(e.id) && !relevantEntities.find(re => re.id === e.id)) {
        relevantEntities.push(e);
      }
    });
  }

  // 이전 파일들의 장면 요약 추출 (파일별로 분리되어 있어 오염 없음)
  const previousSceneSummaries = previousFiles
    .map(pf => {
      const scenesStr = pf.scenes
        .map(s => sceneToString(s))
        .join('\n');
      return `[${pf.fileName}]\n${scenesStr}`;
    })
    .join('\n\n');

  // 기존 설정 컨텍스트 생성 (장면 요약 기반 — entity description/edge statement는 오염 가능하므로 제외)
  const entitiesStr = relevantEntities.map(entityToString).join('\n');

  const previousContext = `[기존 설정 - 이전 챕터들의 정보]
등장인물:
${entitiesStr || '없음'}

장면 요약:
${previousSceneSummaries || '없음'}`;

  // 청크 분할 (컨텍스트가 너무 크면 파일 단위로 분할)
  const chunks: { previousContext: string; currentContext: string }[] = [];
  const totalLen = previousContext.length + currentContext.length;

  if (totalLen > MAX_CONTEXT_CHARS && previousFiles.length > 1) {
    // 이전 파일을 개별로 분할
    for (const pf of previousFiles) {
      const scenesStr = pf.scenes.map(s => sceneToString(s)).join('\n');
      const chunkContext = `[기존 설정 - ${pf.fileName}]
등장인물:
${entitiesStr || '없음'}

장면 요약:
${scenesStr || '없음'}`;
      chunks.push({ previousContext: chunkContext, currentContext });
    }
  } else {
    chunks.push({ previousContext, currentContext });
  }

  // 청크가 없으면 빈 컨텍스트로 하나 생성
  if (chunks.length === 0) {
    chunks.push({ previousContext: '기존 설정 없음 (새 엔티티만 등장)', currentContext });
  }

  console.log(`[validation] ${currentFile.fileName}: 이전 ${previousFiles.length}개 파일, ${relevantEntities.length}개 엔티티 → ${chunks.length}개 청크`);

  return chunks;
}

/** 청크 검증 결과 */
interface ChunkValidationResult {
  issues: ValidationIssue[];
  summary: string;
}

/**
 * 단일 청크에 대해 LLM 검증 수행
 */
async function validateChunk(
  previousContext: string,
  currentContext: string,
  currentFileId: string,
  chunkIndex: number,
  apiKey: string | undefined,
  model: string
): Promise<ChunkValidationResult> {
  const userPrompt = `## 이전 파일들의 설정 (기준)
${previousContext}

## 현재 파일 (검증 대상)
${currentContext}

위 내용을 비교하여 JSON으로 보고하세요. summary는 반드시 작성하세요.`;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        ...(apiKey && { apiKey }),
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API 오류: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    console.log(`[validation] 청크 ${chunkIndex} LLM 응답:`, content);

    // JSON 파싱
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[validation] 청크 ${chunkIndex} JSON 파싱 실패 - JSON 없음:`, content);
      return { issues: [], summary: '검증 결과를 파싱할 수 없습니다.' };
    }

    console.log(`[validation] 청크 ${chunkIndex} JSON 매칭:`, jsonMatch[0]);

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`[validation] 청크 ${chunkIndex} 파싱 결과:`, JSON.stringify(parsed, null, 2));

    const issues = (parsed.issues || []).map(
      (issue: Record<string, string | undefined>, idx: number) => ({
        id: `${currentFileId}_chunk${chunkIndex}_issue_${idx + 1}`,
        type: issue.type || 'other',
        severity: issue.severity || 'warning',
        description: issue.description || '',
        suggestion: issue.suggestion,
      })
    );

    console.log(`[validation] 청크 ${chunkIndex} 이슈 ${issues.length}개:`, issues);

    return {
      issues,
      summary: parsed.summary || '검토 요약 없음',
    };
  } catch (err: unknown) {
    console.error(`[validation] 청크 ${chunkIndex} 검증 실패:`, err);
    return { issues: [], summary: '검증 중 오류 발생' };
  }
}

/** LLM 검증 결과 */
interface LLMValidationResult {
  issues: ValidationIssue[];
  summary: string;
}

/**
 * LLM을 사용하여 파일 간 일관성 검증 (청크 분할 지원)
 */
async function validateWithLLM(
  currentFile: FileGraphData,
  previousFiles: FileGraphData[],
  apiKey: string | undefined,
  model: string
): Promise<LLMValidationResult> {
  // 청크 분할
  const chunks = splitIntoChunks(previousFiles, currentFile);

  // 각 청크 검증 (순차 실행)
  const allIssues: ValidationIssue[] = [];
  const allSummaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[validation] ${currentFile.fileName} 청크 ${i + 1}/${chunks.length} 검증 중...`);

    const result = await validateChunk(
      chunk.previousContext,
      chunk.currentContext,
      currentFile.fileId,
      i,
      apiKey,
      model
    );

    allIssues.push(...result.issues);
    if (result.summary) {
      allSummaries.push(result.summary);
    }
  }

  // 중복 제거 (description 기준)
  const uniqueIssues = allIssues.filter((issue, index, self) =>
    index === self.findIndex(i => i.description === issue.description)
  );

  // summary 병합
  const summary = allSummaries.join(' / ');

  // 디버깅
  if (uniqueIssues.length > 0) {
    console.log(`[validation] ${currentFile.fileName} 이슈 발견:`, uniqueIssues.map(i => i.description));
  } else {
    console.log(`[validation] ${currentFile.fileName} 이슈 없음`);
  }
  console.log(`[validation] ${currentFile.fileName} 요약:`, summary);

  return { issues: uniqueIssues, summary };
}

// ==================== 공개 API ====================

/**
 * 단일 파일 검증
 * 해당 파일의 그래프를 이전 파일들과 비교
 */
export async function validateFile(
  graph: NovelKnowledgeGraph,
  fileId: string,
  context: ValidationContext
): Promise<FileValidationResult> {
  const sourceFiles = graph.metadata.sourceFiles || [];
  const fileIndex = sourceFiles.findIndex((f) => f.id === fileId);

  if (fileIndex < 0) {
    return {
      fileId,
      status: 'failed',
      validatedAt: new Date().toISOString(),
      issues: [
        {
          id: `${fileId}_error`,
          type: 'other',
          severity: 'error',
          description: '파일을 찾을 수 없습니다.',
        },
      ],
      comparedWith: [],
    };
  }

  // 첫 번째 파일은 비교 대상이 없으므로 항상 통과
  if (fileIndex === 0) {
    return {
      fileId,
      status: 'passed',
      validatedAt: new Date().toISOString(),
      issues: [],
      comparedWith: [],
    };
  }

  context.onProgress?.(fileId, 'validating');

  const currentFile = sourceFiles[fileIndex];
  const previousFiles = sourceFiles.slice(0, fileIndex);

  // 범위 제한: 이전 파일들 + 현재 파일만 (5화 검증 시 1~5화만)
  const scopeFileIds = new Set([
    ...previousFiles.map((f) => f.id),
    currentFile.id,
  ]);

  // 그래프 데이터 추출 (범위 내 파일 정보만 사용)
  const currentData = extractFileGraphData(graph, currentFile, scopeFileIds);
  const previousData = previousFiles.map((f) => extractFileGraphData(graph, f, scopeFileIds));

  // LLM 검증
  const model = context.model || DEFAULT_MODEL;
  const { issues, summary } = await validateWithLLM(
    currentData,
    previousData,
    context.apiKey,
    model
  );

  // 이슈가 하나라도 있으면 failed (error든 warning이든)
  const status: ValidationStatus = issues.length > 0 ? 'failed' : 'passed';

  return {
    fileId,
    status,
    validatedAt: new Date().toISOString(),
    issues,
    comparedWith: previousFiles.map((f) => f.id),
    summary,
  };
}

/**
 * 모든 파일 순차 검증
 * 파일 N은 파일 1~(N-1)과 비교
 */
export async function validateAllFiles(
  graph: NovelKnowledgeGraph,
  context: ValidationContext
): Promise<Map<string, FileValidationResult>> {
  const results = new Map<string, FileValidationResult>();
  const sourceFiles = graph.metadata.sourceFiles || [];

  for (let i = 0; i < sourceFiles.length; i++) {
    const file = sourceFiles[i];
    const result = await validateFile(graph, file.id, context);
    results.set(file.id, result);

    // 실패한 경우, 이후 파일들은 invalidated 상태로 설정
    if (result.status === 'failed') {
      for (let j = i + 1; j < sourceFiles.length; j++) {
        const laterFile = sourceFiles[j];
        results.set(laterFile.id, {
          fileId: laterFile.id,
          status: 'invalidated',
          validatedAt: null,
          issues: [],
          comparedWith: [],
        });
        context.onProgress?.(laterFile.id, 'invalidated');
      }
      break;
    }
  }

  return results;
}

/**
 * 특정 파일 이후의 모든 파일을 invalidated 상태로 설정
 */
export function invalidateFilesAfter(
  currentResults: Map<string, FileValidationResult>,
  sourceFiles: SourceFile[],
  failedFileId: string
): Map<string, FileValidationResult> {
  const newResults = new Map(currentResults);
  const failedIndex = sourceFiles.findIndex((f) => f.id === failedFileId);

  if (failedIndex < 0) return newResults;

  for (let i = failedIndex + 1; i < sourceFiles.length; i++) {
    const file = sourceFiles[i];
    const existing = newResults.get(file.id);

    // 이미 passed 상태였던 파일만 invalidated로 변경
    if (existing && existing.status === 'passed') {
      newResults.set(file.id, {
        ...existing,
        status: 'invalidated',
        validatedAt: null,
      });
    }
  }

  return newResults;
}

/**
 * 검증 결과 초기화 (새 파일 추가 시)
 */
export function createInitialValidationResults(
  sourceFiles: SourceFile[]
): Map<string, FileValidationResult> {
  const results = new Map<string, FileValidationResult>();

  sourceFiles.forEach((file, index) => {
    results.set(file.id, {
      fileId: file.id,
      status: index === 0 ? 'passed' : 'pending', // 첫 파일은 자동 통과
      validatedAt: index === 0 ? new Date().toISOString() : null,
      issues: [],
      comparedWith: [],
    });
  });

  return results;
}
