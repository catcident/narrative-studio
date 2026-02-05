/**
 * 지식 그래프 추출 서비스 — LLM 청크 추출
 */

import type { KnownEntity, ChunkExtractionResult } from './types';
import { CATEGORY_NAMES, getApiKey, stripMarkdownCodeBlock } from './types';
import { USER_PROMPT } from './prompts';
import { trimKnownEntities } from './selector';

// 클라이언트 측 fetch with timeout
export async function fetchWithClientTimeout(url: string, options: RequestInit, timeoutMs: number = 150000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function extractFromChunk(
  chunkText: string,
  title: string,
  chunkNum: number,
  knownEntities: KnownEntity[] = [],
  model?: string
): Promise<ChunkExtractionResult> {
  // 이전에 발견된 엔티티 정보를 프롬프트에 추가 (카테고리별로 구분)
  let previousEntitiesText = '';
  const limitedEntities = trimKnownEntities(knownEntities);

  if (limitedEntities.length > 0) {
    // 카테고리별로 그룹화
    const byCategory: Record<string, KnownEntity[]> = {};
    for (const e of limitedEntities) {
      if (!byCategory[e.category]) {
        byCategory[e.category] = [];
      }
      byCategory[e.category].push(e);
    }

    previousEntitiesText = `## 이전 청크에서 발견된 엔티티들 (동일한 것이면 같은 이름 사용!)
⚠️ 중요: 아래 목록에 있는 엔티티가 이번 청크에 다시 등장하면 반드시 같은 이름을 사용하세요!

`;

    for (const [category, entities] of Object.entries(byCategory)) {
      const categoryName = CATEGORY_NAMES[category] || category;
      const limitedCategoryEntities = entities.slice(-15); // 카테고리별 15개까지만
      previousEntitiesText += `### ${categoryName} (${category})
${limitedCategoryEntities.map(e => {
  const aliasText = e.aliases?.length ? ` (별칭: ${e.aliases.slice(0, 3).join(', ')})` : '';
  const shortDesc = (e.description || '').slice(0, 50);
  return `- ${e.name}${aliasText}: ${shortDesc}`;
}).join('\n')}

`;
    }
  }

  const prompt = USER_PROMPT
    .replace('{{title}}', title)
    .replace('{{chunkNum}}', String(chunkNum))
    .replace('{{text}}', chunkText)
    .replace('{{previousCharacters}}', previousEntitiesText);

  console.log(`청크 ${chunkNum} 프롬프트 크기: ${prompt.length}자`);

  // 서버 API route 사용 (환경변수 우선, 없으면 사용자 키 사용)
  const userApiKey = getApiKey();
  const response = await fetchWithClientTimeout('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, apiKey: userApiKey || undefined, model }),
  }, 150000); // 2.5분 타임아웃

  if (!response.ok) {
    const err = await response.text();
    console.error('[extraction] API 응답 에러:', err);
    throw new Error(`API 오류: ${response.status} - ${err.slice(0, 200)}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }
  console.log('API 응답 데이터:', data);

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    console.error('[extraction] 응답 구조:', JSON.stringify(data, null, 2));
    throw new Error('LLM 응답이 비어있습니다. API 키를 확인해주세요.');
  }

  console.log('LLM 응답 내용:', content.slice(0, 500));

  let extracted;
  try {
    const jsonContent = stripMarkdownCodeBlock(content);
    extracted = JSON.parse(jsonContent);
  } catch (parseErr) {
    console.error('[extraction] JSON 파싱 에러, 원본:', content.slice(0, 1000));
    // JSON이 잘린 경우 복구 시도
    const fixedContent = tryFixJson(content);
    if (fixedContent) {
      console.log('JSON 복구 성공');
      extracted = fixedContent;
    } else {
      // 파싱 실패 시 빈 결과 반환 (전체 분석을 중단하지 않음)
      console.warn('[extraction] JSON 파싱 실패, 이 청크 건너뜀');
      extracted = { chapters: [], scenes: [], entities: [], relationships: [] };
    }
  }

  return {
    data: extracted,
    billing: data._billing || null,
  };
}

// 잘린 JSON 복구 시도
export function tryFixJson(content: string): any {
  let fixed = stripMarkdownCodeBlock(content);

  // { 로 시작하는 JSON 찾기
  const jsonStart = fixed.indexOf('{');
  if (jsonStart > 0) {
    fixed = fixed.slice(jsonStart);
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
      console.log('반복 패턴 감지됨, JSON 복구 시도...');
      const firstMatch = match[0];
      const repeatStart = fixed.indexOf(firstMatch);
      if (repeatStart > 100) {  // 충분한 데이터가 앞에 있으면
        fixed = fixed.slice(0, repeatStart);
      }
    }
  }

  // 불완전한 문자열 닫기 (", 뒤에 값이 없는 경우)
  fixed = fixed.replace(/,\s*"[^"]*$/g, '');  // 끝에 불완전한 문자열 제거
  fixed = fixed.replace(/,\s*$/g, '');  // 끝에 쉼표 제거

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
    // 마지막 시도: 유효한 JSON 객체 부분만 추출
    try {
      // scenes 배열까지만 파싱 시도
      const scenesEnd = fixed.lastIndexOf('"scenes"');
      if (scenesEnd > 0) {
        // 최소한의 유효한 JSON 구조 생성
        const minimalJson = {
          chapters: [],
          scenes: [],
          entities: [],
          relationships: []
        };
        console.log('불완전한 JSON, 최소 구조로 반환');
        return minimalJson;
      }
    } catch {
      // 무시
    }
    return null;
  }
}
