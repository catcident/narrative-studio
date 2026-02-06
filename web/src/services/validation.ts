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

/**
 * LLM을 사용하여 두 파일 간 일관성 검증
 */
async function validateWithLLM(
  currentFile: FileGraphData,
  previousFiles: FileGraphData[],
  allEntities: Record<string, Entity>,
  apiKey: string | undefined,
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

  const systemPrompt = `당신은 소설의 **논리적 모순**을 찾는 전문가입니다.

## 핵심 원칙
소설은 이야기가 진행되면서 새로운 캐릭터, 관계, 설정이 추가되는 것이 **당연합니다**.
당신의 역할은 새로운 내용을 지적하는 것이 아니라, **기존 설정과 논리적으로 충돌하는 모순**만 찾는 것입니다.

## 보고해야 할 것 (확실한 논리적 모순만)
1. 사망한 캐릭터가 부활 설정 없이 다시 등장
2. 동일 인물의 나이/성별/종족 등 불변 속성이 다르게 기술됨
3. 파괴된 아이템/장소가 복구 설명 없이 원래대로 등장
4. 시간이 역행함 (예: 3일 후 사건 → 2일 후 사건)
5. 명시적으로 "불가능하다"고 한 것이 가능해짐 (설명 없이)

## 절대 보고하지 말 것
- 새로운 캐릭터의 등장 (당연함)
- 새로운 관계의 형성 (소설 전개의 핵심)
- 기존 캐릭터 간 새로운 상호작용 (이야기 발전)
- 이전에 없던 배경/설정 추가 (세계관 확장)
- 관계 유형의 구체화 (예: 이전엔 그냥 "관련", 이제는 "소유")
- 캐릭터의 감정/행동 변화 (캐릭터 발전)
- 새로운 장소나 아이템 등장

## 판단 기준
- "이전에 없었던 것" ≠ 오류 (새로운 것은 자연스러움)
- "이전과 다른 것" ≠ 오류 (변화/발전은 자연스러움)
- "이전과 논리적으로 충돌하는 것" = 오류 (이것만 보고)

## 응답 형식
{
  "issues": [
    {
      "type": "character_inconsistency" | "timeline_conflict" | "item_inconsistency" | "other",
      "severity": "error" | "warning",
      "description": "구체적인 모순 설명",
      "suggestion": "수정 제안"
    }
  ]
}

**대부분의 경우 빈 배열 {"issues": []} 을 반환해야 합니다.**
확실한 논리적 모순이 아니면 보고하지 마세요.`;

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
        ...(apiKey && { apiKey }),  // apiKey가 있을 때만 전달
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

    // 디버깅: 이슈 내용 출력
    if (issues.length > 0) {
      console.log(`[validation] ${currentFile.fileName} 이슈 발견:`, issues.map(i => i.description));
    } else {
      console.log(`[validation] ${currentFile.fileName} 이슈 없음`);
    }

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

  // 이슈가 하나라도 있으면 failed (error든 warning이든)
  const status: ValidationStatus = issues.length > 0 ? 'failed' : 'passed';

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
