/**
 * 지식 그래프 추출 서비스 — LLM 청크 추출
 */

import type { KnownEntity, ChunkExtractionResult, ChunkExtractedData, LoreExtractionResult, RawLoreEntry } from './types';
import { CATEGORY_NAMES, EMPTY_CHUNK_DATA, getApiKey, stripMarkdownCodeBlock, fetchWithClientTimeout, trimKnownEntities } from './types';
import { USER_PROMPT, LOREBOOK_EXTRACTION_PROMPT } from './prompts';

// 이전 엔티티 정보를 프롬프트용 텍스트로 변환 (extractFromChunk, extractLorebook 공용)
function buildPreviousEntitiesText(knownEntities: KnownEntity[]): string {
  const limitedEntities = trimKnownEntities(knownEntities);
  if (limitedEntities.length === 0) return '';

  const byCategory: Record<string, KnownEntity[]> = {};
  for (const e of limitedEntities) {
    if (!byCategory[e.category]) byCategory[e.category] = [];
    byCategory[e.category].push(e);
  }

  let text = `## 이전 청크에서 발견된 엔티티들 (동일한 것이면 같은 이름 사용!)
⚠️ 중요: 아래 목록에 있는 엔티티가 이번 청크에 다시 등장하면 반드시 같은 이름을 사용하세요!

`;

  for (const [category, entities] of Object.entries(byCategory)) {
    const categoryName = CATEGORY_NAMES[category] || category;
    const limitedCategoryEntities = entities.slice(-15);
    text += `### ${categoryName} (${category})
${limitedCategoryEntities.map(e => {
  const aliasText = e.aliases?.length ? ` (별칭: ${e.aliases.slice(0, 3).join(', ')})` : '';
  const shortDesc = (e.description || '').slice(0, 50);
  return `- ${e.name}${aliasText}: ${shortDesc}`;
}).join('\n')}

`;
  }

  return text;
}

export async function extractFromChunk(
  chunkText: string,
  chunkNum: number,
  knownEntities: KnownEntity[] = [],
  model?: string,
  apiKeyOverride?: string,
  holdToken?: string,
): Promise<ChunkExtractionResult> {
  // 이전에 발견된 엔티티 정보를 프롬프트에 추가 (카테고리별로 구분)
  const previousEntitiesText = buildPreviousEntitiesText(knownEntities);

  const prompt = USER_PROMPT
    .replace('{{chunkNum}}', String(chunkNum))
    .replace('{{text}}', chunkText)
    .replace('{{previousCharacters}}', previousEntitiesText);

  console.log(`[extraction] 청크 ${chunkNum} 프롬프트 크기: ${prompt.length}자`);

  // 서버 API route 사용 (환경변수 우선, 없으면 사용자 키 사용)
  const userApiKey = apiKeyOverride !== undefined ? apiKeyOverride : getApiKey();
  const response = await fetchWithClientTimeout('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, apiKey: userApiKey || undefined, model, holdToken: holdToken || undefined }),
  }, 150000); // 2.5분 타임아웃

  if (!response.ok) {
    // 잔액 부족 (402): 예외 대신 빈 결과 + 플래그 반환
    if (response.status === 402) {
      console.warn('[extraction] 402 insufficient balance received');
      return {
        data: EMPTY_CHUNK_DATA,
        billing: { prompt_tokens: 0, completion_tokens: 0, model: model || '', insufficient_balance: true },
      };
    }
    const err = await response.text();
    console.error('[extraction] API 응답 에러:', err);
    throw new Error(`API 오류: ${response.status} - ${err.slice(0, 200)}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }
  console.log('[extraction] API 응답 데이터:', data);

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    console.error('[extraction] 응답 구조:', JSON.stringify(data, null, 2));
    throw new Error('LLM 응답이 비어있습니다. API 키를 확인해주세요.');
  }

  console.log('[extraction] LLM 응답 내용:', content.slice(0, 500));

  let extracted: ChunkExtractedData;
  try {
    const jsonContent = stripMarkdownCodeBlock(content);
    extracted = JSON.parse(jsonContent) as ChunkExtractedData;
  } catch {
    console.error(`[extraction] JSON 파싱 에러 (model=${model}), 원본 prefix:`, content.slice(0, 500));
    // JSON이 잘린 경우 복구 시도
    const fixedContent = tryFixJson(content);
    if (fixedContent) {
      console.log('[extraction] JSON 복구 성공');
      extracted = fixedContent as ChunkExtractedData;
    } else {
      // 파싱 실패 시 빈 결과 반환 (전체 분석을 중단하지 않음)
      console.warn(`[extraction] JSON 파싱 실패 (model=${model}), 이 청크 건너뜀. content prefix: ${content.slice(0, 200)}`);
      extracted = EMPTY_CHUNK_DATA;
    }
  }

  return {
    data: extracted,
    billing: data._billing ? { ...data._billing, model } : null,
  };
}

// 잘린 JSON 복구 시도
export function tryFixJson(content: string): unknown {
  let fixed = stripMarkdownCodeBlock(content);

  // { 로 시작하는 JSON 찾기
  const jsonStart = fixed.indexOf('{');
  if (jsonStart > 0) {
    fixed = fixed.slice(jsonStart);
  }

  // JSON 앞에 설명 텍스트가 있는 경우 제거
  if (jsonStart === -1) {
    console.log('[extraction] JSON 시작 문자({) 없음, 복구 불가');
    return null;
  }

  // 반복 패턴 감지 및 제거 (LLM이 무한 반복하는 경우)
  // 예: "춘운, 경홍, 섬월, 요연, 능파, " 가 반복되는 경우
  const repeatPatterns = [
    /,\s*([^,]{2,50}(?:,\s*[^,]{2,50}){3,})\s*(?:\1\s*)+/g,  // 쉼표로 구분된 패턴 반복
    /"[^"]+"\s*(?:,\s*"[^"]+"\s*){10,}/g,  // 10개 이상의 연속 문자열
  ];

  for (const pattern of repeatPatterns) {
    const match = fixed.match(pattern);
    if (match && match[0].length > 500) {
      // 반복 패턴이 감지되면 첫 번째 유효한 부분만 남기고 자르기
      console.log('[extraction] 반복 패턴 감지됨, JSON 복구 시도...');
      const firstMatch = match[0];
      const repeatStart = fixed.indexOf(firstMatch);
      if (repeatStart > 100) {  // 충분한 데이터가 앞에 있으면
        fixed = fixed.slice(0, repeatStart);
      }
    }
  }

  // trailing comma 제거 (LLM이 자주 하는 실수)
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');

  // 불완전한 문자열 닫기 (", 뒤에 값이 없는 경우)
  fixed = fixed.replace(/,\s*"[^"]*$/g, '');  // 끝에 불완전한 문자열 제거
  fixed = fixed.replace(/,\s*$/g, '');  // 끝에 쉼표 제거

  // 불완전한 객체/배열 제거 (잘린 JSON의 끝부분)
  fixed = fixed.replace(/,\s*\{[^}]*$/g, '');  // 끝에 불완전한 객체 제거
  fixed = fixed.replace(/,\s*\[[^\]]*$/g, '');  // 끝에 불완전한 배열 제거

  // 열린 괄호 수 세기
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let prevChar = '';

  for (const char of fixed) {
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    }
    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;
    }
    prevChar = char;
  }

  // 닫는 괄호 추가
  while (bracketCount > 0) {
    fixed += ']';
    bracketCount--;
  }
  while (braceCount > 0) {
    fixed += '}';
    braceCount--;
  }

  try {
    return JSON.parse(fixed);
  } catch {
    // 2차 시도: 제어 문자 제거 후 재시도
    try {
      const sanitized = fixed.replace(/[\x00-\x1F\x7F]/g, (ch) => {
        if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
        return '';
      });
      return JSON.parse(sanitized);
    } catch {
      // 복구 불가능한 경우 null 반환
      return null;
    }
  }
}

// --- LLM B: 로어북 추출 ---

export async function extractLorebook(
  chunkText: string,
  chunkNum: number,
  knownEntities: KnownEntity[] = [],
  model?: string,
  apiKeyOverride?: string,
  holdToken?: string,
): Promise<LoreExtractionResult> {
  const previousEntitiesText = buildPreviousEntitiesText(knownEntities);

  const prompt = LOREBOOK_EXTRACTION_PROMPT
    .replace('{{chunkNum}}', String(chunkNum))
    .replace('{{text}}', chunkText)
    .replace('{{previousEntities}}', previousEntitiesText);

  const userApiKey = apiKeyOverride !== undefined ? apiKeyOverride : getApiKey();
  const response = await fetchWithClientTimeout('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, apiKey: userApiKey || undefined, model, holdToken: holdToken || undefined }),
  }, 150000);

  if (!response.ok) {
    if (response.status === 402) {
      return { data: [], billing: { prompt_tokens: 0, completion_tokens: 0, model: model || '', insufficient_balance: true } };
    }
    const err = await response.text();
    console.error('[lorebook] API 응답 에러:', err);
    throw new Error(`API 오류: ${response.status} - ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error);

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    console.warn('[lorebook] LLM 응답 비어있음');
    return { data: [], billing: data._billing ? { ...data._billing, model } : null };
  }

  let parsed: { lore_entries?: RawLoreEntry[] };
  try {
    const jsonContent = stripMarkdownCodeBlock(content);
    parsed = JSON.parse(jsonContent);
  } catch {
    console.error(`[lorebook] JSON 파싱 에러 (model=${model}), content prefix:`, content.slice(0, 500));
    const fixedContent = tryFixJson(content);
    if (fixedContent && typeof fixedContent === 'object') {
      parsed = fixedContent as { lore_entries?: RawLoreEntry[] };
    } else {
      console.warn(`[lorebook] JSON 파싱 실패 (model=${model}), 이 청크 건너뜀. content prefix: ${content.slice(0, 200)}`);
      return { data: [], billing: data._billing ? { ...data._billing, model } : null };
    }
  }

  const entries = Array.isArray(parsed.lore_entries) ? parsed.lore_entries : [];
  return {
    data: entries,
    billing: data._billing ? { ...data._billing, model } : null,
  };
}
