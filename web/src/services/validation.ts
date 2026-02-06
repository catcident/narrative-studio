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

// ==================== 타입 ====================

interface ValidationContext {
  apiKey: string;
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

/**
 * LLM을 사용하여 두 파일 간 일관성 검증
 */
async function validateWithLLM(
  currentFile: FileGraphData,
  previousFiles: FileGraphData[],
  allEntities: Record<string, Entity>,
  apiKey: string,
  model: string
): Promise<ValidationIssue[]> {
  // 이전 파일들의 정보 요약
  const previousContext = previousFiles
    .map((pf) => {
      const entitiesStr = pf.entities.map(entityToString).join('\n');
      const edgesStr = pf.edges
        .map((e) => edgeToString(e, allEntities))
        .join('\n');
      const scenesStr = pf.scenes.map(sceneToString).join('\n');

      return `=== ${pf.fileName} (${pf.fileId}) ===
## 등장인물/엔티티
${entitiesStr || '없음'}

## 관계
${edgesStr || '없음'}

## 주요 장면
${scenesStr || '없음'}`;
    })
    .join('\n\n');

  // 현재 파일 정보
  const currentEntitiesStr = currentFile.entities.map(entityToString).join('\n');
  const currentEdgesStr = currentFile.edges
    .map((e) => edgeToString(e, allEntities))
    .join('\n');
  const currentScenesStr = currentFile.scenes.map(sceneToString).join('\n');

  const currentContext = `=== ${currentFile.fileName} (${currentFile.fileId}) ===
## 등장인물/엔티티
${currentEntitiesStr || '없음'}

## 관계
${currentEdgesStr || '없음'}

## 주요 장면
${currentScenesStr || '없음'}`;

  const systemPrompt = `당신은 소설의 일관성을 검증하는 전문가입니다.
이전 파일들의 설정과 현재 파일의 설정을 비교하여 불일치나 오류를 찾아주세요.

다음 항목들을 확인하세요:
1. 캐릭터 일관성: 성격, 외모, 능력, 배경 등이 이전과 일치하는지
2. 세계관 일관성: 마법 체계, 사회 구조, 역사적 사실 등이 일치하는지
3. 시간축 일관성: 사건의 순서, 시간 경과가 논리적인지
4. 장소 일관성: 지명, 위치 관계 등이 일치하는지
5. 관계 일관성: 캐릭터 간 관계가 이전과 모순되지 않는지
6. 아이템/소품 일관성: 아이템의 특성, 위치 등이 일치하는지

응답은 반드시 다음 JSON 형식으로 해주세요:
{
  "issues": [
    {
      "type": "character_inconsistency" | "worldbuilding_error" | "timeline_conflict" | "location_inconsistency" | "relationship_conflict" | "item_inconsistency" | "other",
      "severity": "error" | "warning",
      "description": "문제 설명",
      "suggestion": "수정 제안 (선택사항)"
    }
  ]
}

문제가 없으면 빈 배열을 반환하세요: {"issues": []}
사소한 차이는 무시하고, 실제로 이야기의 일관성을 해치는 중요한 문제만 보고하세요.`;

  const userPrompt = `## 이전 파일들 (기준)
${previousContext}

## 현재 파일 (검증 대상)
${currentContext}

위 내용을 비교하여 현재 파일에서 발견되는 일관성 문제를 JSON 형식으로 보고해주세요.`;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        apiKey,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API 오류: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // JSON 파싱
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[validation] JSON 파싱 실패:', content);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const issues: ValidationIssue[] = (parsed.issues || []).map(
      (issue: any, idx: number) => ({
        id: `${currentFile.fileId}_issue_${idx + 1}`,
        type: issue.type || 'other',
        severity: issue.severity || 'warning',
        description: issue.description || '',
        suggestion: issue.suggestion,
      })
    );

    return issues;
  } catch (err) {
    console.error('[validation] LLM 검증 실패:', err);
    return [];
  }
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
  const issues = await validateWithLLM(
    currentData,
    previousData,
    graph.entities,
    context.apiKey,
    model
  );

  const status: ValidationStatus = issues.some((i) => i.severity === 'error')
    ? 'failed'
    : 'passed';

  return {
    fileId,
    status,
    validatedAt: new Date().toISOString(),
    issues,
    comparedWith: previousFiles.map((f) => f.id),
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
