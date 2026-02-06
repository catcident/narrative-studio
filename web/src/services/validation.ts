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

    // 엔티티 정보를 범위 내 장면 기준으로 재구성
    entities = Object.values(graph.entities)
      .filter((e) => entityIds.has(e.id))
      .map((e) => {
        // 해당 엔티티가 등장하는 범위 내 장면들의 요약에서 정보 추출
        const relevantScenes = Object.values(graph.snapshots).filter(
          (scene) =>
            scopeSceneIds.has(scene.sceneId) &&
            scene.charactersPresent?.includes(e.id)
        );

        // 범위 내 장면들의 요약을 엔티티 설명으로 사용
        const scopedDescription = relevantScenes
          .map((s) => s.summary)
          .filter(Boolean)
          .slice(0, 3) // 최대 3개 장면
          .join(' / ');

        return {
          ...e,
          description: scopedDescription || `${e.name} (${e.category})`,
        };
      });
  } else {
    entities = Object.values(graph.entities).filter((e) =>
      entityIds.has(e.id)
    );
  }

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

const SYSTEM_PROMPT = `당신은 소설의 **심각한 논리적 모순**만 찾는 전문가입니다.

## ⚠️ 위치 변경은 절대 모순이 아닙니다! ⚠️

캐릭터가 1화에서 A에 있다가 2화에서 B에 있으면?
→ 그냥 이동한 것입니다. **모순 아님!**

예시:
- 1화: 고양이가 풀밭에 있음 → 2화: 고양이가 골목에 있음 → **정상** (걸어감)
- 1화: 고양이가 집에서 태어남 → 6화: 고양이가 숲에 있음 → **정상** (이동함)
- 풀밭 출신인데 현재 골목에 있음 → **정상** (고향과 현재 위치는 다를 수 있음)

## 보고해야 할 모순 (이것만!)
1. **사망 후 부활**: "죽었다"고 명시된 캐릭터가 이후 살아서 등장
2. **나이 역행**: 30세였다가 20세가 됨 (회상 장면 제외)
3. **성별/종족 변경**: 남자가 여자로, 고양이가 개로 바뀜

## 모순이 아닌 것 (보고 금지!)
- ❌ 위치가 바뀜 (A→B 이동)
- ❌ 출신지와 현재 위치가 다름
- ❌ 새로운 장소 방문
- ❌ 새로운 관계 형성
- ❌ 성격/행동 변화

## 응답 (JSON만)
{"summary": "검토 요약", "issues": []}

**위치 이동을 모순으로 보고하면 오답입니다.**`;

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

  // 범위 제한: 이전 파일들 + 현재 파일만 (5화 검증 시 1~5화만)
  const scopeFileIds = new Set([
    ...previousFiles.map((f) => f.id),
    currentFile.id,
  ]);

  // 그래프 데이터 추출 (범위 내 파일 정보만 사용)
  const currentData = extractFileGraphData(graph, currentFile, scopeFileIds);
  const previousData = previousFiles.map((f) => extractFileGraphData(graph, f, scopeFileIds));

  // 범위 내 엔티티만 필터링
  const scopeSceneIds = new Set<string>();
  Object.values(graph.snapshots).forEach((scene) => {
    if (scopeFileIds.has(scene.sourceFileId || '')) {
      scopeSceneIds.add(scene.sceneId);
    }
  });

  const scopedEntities: Record<string, Entity> = {};
  Object.entries(graph.entities).forEach(([id, entity]) => {
    // 이 엔티티가 범위 내 장면에 등장하는지 확인
    const appearsInScope = Object.values(graph.snapshots).some(
      (scene) =>
        scopeSceneIds.has(scene.sceneId) &&
        scene.charactersPresent?.includes(id)
    );
    if (appearsInScope) {
      scopedEntities[id] = entity;
    }
  });

  // LLM 검증
  const model = context.model || DEFAULT_MODEL;
  const { issues, summary } = await validateWithLLM(
    currentData,
    previousData,
    scopedEntities,  // 범위 내 엔티티만 전달
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
