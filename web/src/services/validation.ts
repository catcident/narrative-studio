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
const MAX_CONTEXT_CHARS = 8000;

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
}

// ==================== 헬퍼 함수 ====================

/**
 * 파일별 그래프 데이터 추출
 */
function extractFileGraphData(
  graph: NovelKnowledgeGraph,
  file: SourceFile
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

  const entities = Object.values(graph.entities).filter((e) =>
    entityIds.has(e.id)
  );

  // 해당 파일의 관계들
  const edges = Object.values(graph.hyperedges).filter(
    (edge) => edge.scenes?.some((sid) => sceneIds.has(sid))
  );

  return { fileId, fileName, entities, edges, scenes };
}

/**
 * 엔티티 정보를 문자열로 변환 (LLM 프롬프트용)
 */
function entityToString(entity: Entity): string {
  let str = `- ${entity.name} (${entity.category})`;
  if (entity.description) {
    str += `: ${entity.description}`;
  }
  if (entity.aliases && entity.aliases.length > 0) {
    str += ` [별칭: ${entity.aliases.join(', ')}]`;
  }
  if (entity.attributes && Object.keys(entity.attributes).length > 0) {
    const attrs = Object.entries(entity.attributes)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    str += ` {${attrs}}`;
  }
  return str;
}

/**
 * 관계 정보를 문자열로 변환
 */
function edgeToString(edge: HyperEdge, entities: Record<string, Entity>): string {
  const entityNames = edge.entities
    .map((id) => entities[id]?.name || id)
    .join(', ');
  return `- [${edge.type}] ${entityNames}: ${edge.statement}`;
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

const SYSTEM_PROMPT = `당신은 소설의 **논리적 모순**을 찾는 전문가입니다.

## 핵심 원칙
- 소설은 **시간순으로 진행**됩니다. 파일 1 → 파일 2 → 파일 3 순서입니다.
- 새로운 내용이 추가되는 것은 **당연**합니다.
- 당신의 역할: **기존 설정과 물리적/논리적으로 충돌하는 모순**만 찾기

## 보고해야 할 것 (확실한 모순만)
1. **사망 후 부활**: 죽었다고 명시된 캐릭터가 설명 없이 다시 등장
2. **불변 속성 변경**: 나이/성별/종족/혈액형 등이 다르게 기술됨
3. **파괴 후 복구**: 부서졌다고 명시된 것이 설명 없이 멀쩡히 등장
4. **동시 존재 불가**: 같은 시점에 두 장소에 동시에 있음 (순간이동 능력 없이)
5. **시간 역행**: 명시된 시간이 거꾸로 감 (3일 후 → 2일 후)

## 절대 보고하지 말 것 (이것들은 모순이 아님)
- **장소 이동**: A가 1화에서 서울에 있다가 2화에서 부산에 있음 → 이동한 것임, 모순 아님
- **관계 변화**: 친했다가 싸워서 사이가 나빠짐 → 시간에 따른 변화, 모순 아님
- **새 정보 추가**: 이전에 언급 안 된 설정이 나옴 → 세계관 확장, 모순 아님
- **이름/호칭 변경**: "나"로 불리다가 "가"로 불림 → 가명/위장 가능, 모순 아님
- **새 캐릭터/관계/장소**: 처음 등장 → 당연함, 모순 아님
- **감정/행동 변화**: 이전과 다른 행동 → 캐릭터 발전, 모순 아님

## 판단 기준
질문: "이전 설정이 **물리적으로 불가능**하게 만드는가?"
- 서울에 있던 사람이 부산에 나타남 → 이동 가능, 모순 아님
- 죽은 사람이 살아있음 → 물리적 불가능, 모순임
- 부서진 검이 멀쩡함 → 물리적 불가능, 모순임

## 응답 형식 (반드시 이 형식으로)
{
  "summary": "검토한 내용 요약 (예: 캐릭터 A, B의 설정, 장소 X의 위치 관계, 시간대 등을 검토함)",
  "issues": []
}

모순이 있을 때:
{
  "summary": "검토 내용 요약",
  "issues": [{"type": "character_inconsistency", "severity": "error", "description": "구체적 설명", "suggestion": "수정 제안"}]
}

**summary는 항상 작성하세요. 무엇을 검토했는지 사용자가 알 수 있어야 합니다.**`;

/**
 * 컨텍스트를 청크로 분할
 */
function splitIntoChunks(
  previousFiles: FileGraphData[],
  currentFile: FileGraphData,
  allEntities: Record<string, Entity>
): { previousContext: string; currentContext: string }[] {
  // 현재 파일 컨텍스트 생성
  const currentEntitiesStr = currentFile.entities.map(entityToString).join('\n');
  const currentEdgesStr = currentFile.edges
    .map((e) => edgeToString(e, allEntities))
    .join('\n');
  const currentScenesStr = currentFile.scenes.map(sceneToString).join('\n');

  const currentContext = `=== ${currentFile.fileName} ===
## 등장인물/엔티티
${currentEntitiesStr || '없음'}

## 관계
${currentEdgesStr || '없음'}

## 주요 장면
${currentScenesStr || '없음'}`;

  // 이전 파일들을 청크로 분할
  const chunks: { previousContext: string; currentContext: string }[] = [];
  let currentChunk = '';

  for (const pf of previousFiles) {
    const entitiesStr = pf.entities.map(entityToString).join('\n');
    const edgesStr = pf.edges
      .map((e) => edgeToString(e, allEntities))
      .join('\n');
    const scenesStr = pf.scenes.map(sceneToString).join('\n');

    const fileContext = `=== ${pf.fileName} ===
## 등장인물/엔티티
${entitiesStr || '없음'}

## 관계
${edgesStr || '없음'}

## 주요 장면
${scenesStr || '없음'}

`;

    // 청크 크기 체크
    if (currentChunk.length + fileContext.length + currentContext.length > MAX_CONTEXT_CHARS) {
      // 현재 청크 저장하고 새 청크 시작
      if (currentChunk) {
        chunks.push({ previousContext: currentChunk, currentContext });
      }
      currentChunk = fileContext;
    } else {
      currentChunk += fileContext;
    }
  }

  // 마지막 청크 저장
  if (currentChunk) {
    chunks.push({ previousContext: currentChunk, currentContext });
  }

  // 청크가 없으면 (이전 파일이 없거나 매우 작으면) 빈 컨텍스트로 하나 생성
  if (chunks.length === 0) {
    chunks.push({ previousContext: '없음', currentContext });
  }

  console.log(`[validation] ${previousFiles.length}개 파일 → ${chunks.length}개 청크로 분할`);

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
      (issue: any, idx: number) => ({
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
  } catch (err) {
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
  allEntities: Record<string, Entity>,
  apiKey: string | undefined,
  model: string
): Promise<LLMValidationResult> {
  // 청크 분할
  const chunks = splitIntoChunks(previousFiles, currentFile, allEntities);

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

  // 그래프 데이터 추출
  const currentData = extractFileGraphData(graph, currentFile);
  const previousData = previousFiles.map((f) => extractFileGraphData(graph, f));

  // LLM 검증
  const model = context.model || DEFAULT_MODEL;
  const { issues, summary } = await validateWithLLM(
    currentData,
    previousData,
    graph.entities,
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
