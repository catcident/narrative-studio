/**
 * 지식 그래프 추출 서비스 (개선된 버전)
 * 더 세부적인 정보 추출 + 시점별 관계
 */

import type { NovelKnowledgeGraph } from '../types';
import { DEFAULT_MODEL } from '../types';

function getApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('OPENROUTER_API_KEY') || '';
}

export function setApiKey(key: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('OPENROUTER_API_KEY', key);
  }
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

const USER_PROMPT = `소설 텍스트 청크 {{chunkNum}} 분석

{{text}}

---
{{previousCharacters}}

## 출력 형식 (JSON)
\`\`\`json
{
  "chapters": [{"id": 1, "title": "텍스트에서 찾은 실제 장/화 제목 (예: '3화: 박스')"}],
  "scenes": [{
    "id": 1,
    "chapter": 1,
    "location": "장소",
    "time": "시간(있으면)",
    "summary": "장면 요약",
    "time_marker": "텍스트에 명시된 시간 표현만 (예: '10년 전', '다음 날', '회귀 전') - 없으면 null"
  }],
  "entities": [{
    "name": "이름",
    "category": "character|location|item|concept",
    "description": "핵심 특성/역할",
    "scenes": [1],
    "aliases": ["별칭"]
  }],
  "relationships": [{
    "from": "A",
    "to": "B",
    "type": "관계타입",
    "description": "관계 설명",
    "scenes": [1]
  }]
}
\`\`\`

## 핵심 규칙

### 1. 장/화 인식 (매우 중요!)
텍스트에서 장/화/에피소드 구분을 찾아 chapters에 기록합니다.

**인식해야 할 패턴들:**
- 마크다운: "# 1화: 아침", "# 3화: 박스", "## 제1장: 시작"
- 숫자+단위: "1화", "2장", "제3장", "4편", "5절"
- 콜론/공백 형식: "1화:", "1화 제목", "제1장: 시작"
- 괄호 형식: "[1화]", "【제1장】", "(Episode 1)"
- 영문: "Chapter 1", "Episode 1", "Part 1", "Ch.1", "Ep.1"
- 특수: "프롤로그", "에필로그", "Prologue", "Epilogue", "서장", "종장", "막간"

**⚠️ 제목은 텍스트에서 그대로 복사하세요!**
- 텍스트에 "# 3화: 박스"가 있으면 → title: "3화: 박스"
- 텍스트에 "# 7화: 거꿀"이 있으면 → title: "7화: 거꿀"
- 예시 형식("1화: 제목")을 그대로 쓰지 마세요. 실제 텍스트의 제목을 사용하세요!

### 2. 장면 분할 및 시간 처리
시간/장소 변경 시 새 장면.

**시간 기록 원칙 (중요!):**
- time_marker에는 텍스트에 **명시적으로 적힌 시간 표현만** 기록
- 예: "10년 전", "다음 날", "그로부터 일주일 후", "회귀 전", "어린 시절"
- **추측하지 마세요!** 단서가 없으면 null로 두세요
- 이게 과거인지 현재인지 **판단하려 하지 마세요** - 나중에 후처리로 계산합니다

### 3. 엔티티 추출 - 전수 추출 원칙
**모든 것을 추출**합니다. 중요도는 후처리에서 계산합니다.

**카테고리 구분 기준:**
- **character**: 대화/행동하는 존재 (사람, 동물, 의인화된 것. 이름 없으면 "검은 고양이" 등 특징으로)
- **location**: 공간/장소 (골목, 집, 방, 공원 등 - 캐릭터가 "~에 있다"고 할 수 있는 곳)
- **item**: 물건/도구 (쓰레기통, 박스, 음식, 책 등 - 이동/소유 가능한 것)
- **concept**: 추상적 개념 (세계관 설정, 규칙, 현상 등)

**LLM이 중요도를 판단하지 마세요.** 일회성처럼 보여도 추출합니다.

### 4. 관계 타입 (10가지만 사용)
가족, 연인, 친구, 적대, 동료, 소속, 위치, 소유, 포함, 관련

### 5. 엔티티 구분 vs 통일 (매우 중요!)

**⚠️ 이전에 추출된 엔티티 목록을 반드시 확인하세요!**

**같은 것 = 이전 이름 그대로 사용:**
- 같은 물건/장소/인물이 재등장 → 이전 이름 사용
- 같은 현상/개념의 다른 표현 → 이전 이름 사용
- 같은 장소의 다른 표현 → 이전 이름 사용 (예: "그 집", "낡은 집" → 같은 곳이면 "집"으로 통일)
- **⚠️ 캐릭터 이름이 밝혀지면 반드시 기존 엔티티에 병합!**
  - 텍스트에서 "그 고양이의 이름은 거꿀이다" 같은 문장이 나오면:
  - → 새로 "거꿀" 엔티티를 만들지 말고, 기존 "회색 고양이"의 aliases에 "거꿀" 추가
  - → name은 기존 것 유지, 새 이름은 aliases에!

**다른 것 = 새로 추출:**
- **서사적 역할이 다른 물건**: 평범한 도구 vs 특별한 능력을 가진 물건 → 별개
- **물리적으로 다른 객체**: 같은 종류여도 별개 개체면 별개 (예: "A의 검"과 "B의 검")
- **다른 캐릭터**: 같은 종류/직업이어도 개체가 다르면 별개

**판단 기준**: "이 두 개가 소설에서 같은 역할/의미를 가지는가?"
- YES → 이전 이름 사용
- NO → 새로 추출 (구분되는 이름으로)

### 6. 관계 필수 규칙
- from/to는 반드시 entities의 name과 동일해야 함
- 같은 장면에 등장하는 캐릭터들 사이에 관계 추출`;

// 중간 저장용 타입
export interface ExtractionProgress {
  title: string;
  totalChunks: number;
  processedChunks: number;
  allExtracted: any[];
  knownCharacters: { name: string; description: string; aliases?: string[] }[];
  chunks: string[];
  timestamp: number;
  model?: string;  // 사용된 모델
  originalText?: string;  // 원본 텍스트
  fileName?: string;  // 원본 파일명
}

// localStorage 키
const PROGRESS_KEY = 'novel-extraction-progress';

// 중간 결과 저장
export function saveProgress(progress: ExtractionProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    console.log(`진행상황 저장: ${progress.processedChunks}/${progress.totalChunks}`);
  } catch (e) {
    console.warn('진행상황 저장 실패:', e);
  }
}

// 저장된 진행상황 불러오기
export function loadProgress(): ExtractionProgress | null {
  try {
    const saved = localStorage.getItem(PROGRESS_KEY);
    if (saved) {
      const progress = JSON.parse(saved) as ExtractionProgress;
      // 24시간 이내의 것만 복원
      if (Date.now() - progress.timestamp < 24 * 60 * 60 * 1000) {
        return progress;
      }
    }
  } catch (e) {
    console.warn('진행상황 불러오기 실패:', e);
  }
  return null;
}

// 진행상황 삭제
export function clearProgress(): void {
  localStorage.removeItem(PROGRESS_KEY);
}

// 저장된 진행상황이 있는지 확인
export function hasProgress(): ExtractionProgress | null {
  return loadProgress();
}

/**
 * 스마트 청크 분할
 * - 장/화/절 경계에서 우선 분할
 * - 문장 끝(. ! ? 등)에서 분할
 * - 문장 중간에서 끊기지 않도록 함
 * - 청크 간 오버랩으로 문맥 연결 보장
 */
function splitIntoSmartChunks(text: string, targetSize: number = 5000, overlapSize: number = 300): string[] {
  const chunks: string[] = [];

  // 장/화/절 구분 패턴 (다양한 소설 형식 지원)
  // - 마크다운 헤딩: # 제목, ## 1화
  // - 한글 장/화: 1화, 제1장, 1장, 제1화, 1편, 1절
  // - 콜론/공백 형식: 1화:, 1화 제목, 1장: 제목
  // - 괄호 형식: [1화], 【1화】, (1화)
  // - 영문: Chapter 1, Episode 1, Part 1, Ch.1, Ep.1
  // - 프롤로그/에필로그
  // - 구분선: ---, ***, ===
  const chapterPattern = new RegExp(
    '(?=' +
      // 마크다운 헤딩 (# ~ ###)
      '\\n#{1,3}\\s+.+\\n' +
    ')|(?=' +
      // 한글 장/화/편/절 (줄 시작, 숫자 필수)
      // 예: 1화, 제1장, 1장:, 제1화 제목
      '\\n(?:제)?\\s*\\d+\\s*[장화편절](?:[:\\s]|$)' +
    ')|(?=' +
      // 괄호로 감싼 형식
      // 예: [1화], 【제1장】, (Episode 1)
      '\\n[\\[【\\(]\\s*(?:제)?\\s*\\d+\\s*[장화편절]?\\s*[\\]】\\)]' +
    ')|(?=' +
      // 영문 Chapter/Episode/Part (대소문자 무시)
      '\\n(?:Chapter|Episode|Part|Ch\\.|Ep\\.)\\s*\\d+' +
    ')|(?=' +
      // 프롤로그/에필로그/서장/종장
      '\\n(?:프롤로그|에필로그|Prologue|Epilogue|서장|종장|막간|Interlude)(?:[:\\s]|$)' +
    ')|(?=' +
      // 구분선 (대시, 별표, 등호 3개 이상)
      '\\n[-]{3,}\\n' +
    ')|(?=' +
      '\\n[*]{3,}\\n' +
    ')|(?=' +
      '\\n[=]{3,}\\n' +
    ')|(?=' +
      // 별표 + 공백 구분선
      '\\n\\*\\s*\\*\\s*\\*\\s*\\n' +
    ')',
    'gi'
  );

  // 먼저 장/화 단위로 분할
  const sections = text.split(chapterPattern).filter(s => s.trim());

  for (const section of sections) {
    // 장/화 헤더로 시작하는 섹션인지 확인
    const hasChapterHeader = /^[\s\n]*#|^[\s\n]*(?:제)?\s*\d+\s*[장화편절]|^[\s\n]*\[|\^[\s\n]*【/.test(section);

    if (section.length <= targetSize) {
      // 섹션이 목표 크기 이하면 그대로 추가
      // 단, 장/화 헤더가 있는 섹션은 합치지 않음 (장 구분 유지)
      if (!hasChapterHeader && chunks.length > 0 && chunks[chunks.length - 1].length + section.length <= targetSize) {
        // 이전 청크와 합칠 수 있으면 합침 (장/화 헤더 없는 경우만)
        chunks[chunks.length - 1] += section;
      } else {
        chunks.push(section);
      }
    } else {
      // 섹션이 너무 크면 문장 단위로 분할
      let remaining = section;

      while (remaining.length > 0) {
        if (remaining.length <= targetSize) {
          if (chunks.length > 0 && chunks[chunks.length - 1].length + remaining.length <= targetSize) {
            chunks[chunks.length - 1] += remaining;
          } else {
            chunks.push(remaining);
          }
          break;
        }

        // targetSize 근처에서 문장 끝 찾기
        let cutPoint = targetSize;

        // 문장 끝 패턴: 마침표, 물음표, 느낌표 + 공백/줄바꿈
        // 또는 줄바꿈이 두 번 연속 (단락 구분)
        const searchStart = Math.max(0, targetSize - 500); // 500자 여유 범위
        const searchEnd = Math.min(remaining.length, targetSize + 200);
        const searchRange = remaining.slice(searchStart, searchEnd);

        // 문장 끝 패턴들
        const sentenceEnds = [
          /[.!?]\s+/g,      // 마침표/물음표/느낌표 + 공백
          /[.!?]\n/g,       // 마침표/물음표/느낌표 + 줄바꿈
          /\n\n/g,          // 빈 줄 (단락 구분)
          /[.!?]$/g,        // 마침표/물음표/느낌표 (검색 범위 끝)
        ];

        let bestCut = -1;
        for (const pattern of sentenceEnds) {
          let match;
          while ((match = pattern.exec(searchRange)) !== null) {
            const absolutePos = searchStart + match.index + match[0].length;
            // targetSize에 가장 가까운 위치 선택
            if (absolutePos <= targetSize + 200) {
              bestCut = absolutePos;
            }
          }
          if (bestCut > searchStart) break; // 적절한 위치를 찾았으면 중단
        }

        if (bestCut > searchStart) {
          cutPoint = bestCut;
        } else {
          // 문장 끝을 못 찾으면 공백에서 자르기
          const lastSpace = remaining.lastIndexOf(' ', targetSize);
          const lastNewline = remaining.lastIndexOf('\n', targetSize);
          cutPoint = Math.max(lastSpace, lastNewline);
          if (cutPoint <= searchStart) {
            cutPoint = targetSize; // 공백도 없으면 그냥 자르기
          }
        }

        chunks.push(remaining.slice(0, cutPoint).trim());
        // 오버랩: cutPoint에서 overlapSize만큼 앞에서부터 시작 (문맥 연결)
        const overlapStart = Math.max(0, cutPoint - overlapSize);
        remaining = remaining.slice(overlapStart).trim();
      }
    }
  }

  // 빈 청크 제거 및 너무 작은 청크 병합
  const result: string[] = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;

    if (result.length > 0 && chunk.length < 500 && result[result.length - 1].length + chunk.length <= targetSize * 1.2) {
      // 500자 미만의 작은 청크는 이전 청크와 병합 (20% 초과 허용)
      result[result.length - 1] += '\n' + chunk;
    } else {
      result.push(chunk);
    }
  }

  return result;
}

// 엔티티 정보 타입 (모든 카테고리 지원)
interface KnownEntity {
  name: string;
  description: string;
  category: string;
  aliases?: string[];
}

// 엔티티 요약 정보 (관계 포함)
interface EntitySummary {
  name: string;
  category: string;
  description: string;
  relations: string[];  // "타입 → 상대: 설명" 형태
}

// knownEntities 크기 제한 (카테고리별로 관리)
const MAX_KNOWN_ENTITIES = 100;  // 전체 최대
const MAX_PER_CATEGORY = 30;     // 카테고리별 최대

function trimKnownEntities(entities: KnownEntity[]): KnownEntity[] {
  if (entities.length <= MAX_KNOWN_ENTITIES) {
    return entities;
  }

  // 카테고리별로 그룹화하고 각각 제한
  const byCategory: Record<string, KnownEntity[]> = {};
  for (const e of entities) {
    if (!byCategory[e.category]) {
      byCategory[e.category] = [];
    }
    byCategory[e.category].push(e);
  }

  const result: KnownEntity[] = [];
  for (const category of Object.keys(byCategory)) {
    const categoryEntities = byCategory[category];
    // 최근 것들만 유지
    result.push(...categoryEntities.slice(-MAX_PER_CATEGORY));
  }

  return result.slice(-MAX_KNOWN_ENTITIES);
}

/**
 * 지식그래프에서 엔티티 요약 목록 생성
 * 각 노드의 이름, 카테고리, 설명, 연결된 관계들을 한 줄씩 요약
 */
function buildEntitySummaries(graph: NovelKnowledgeGraph): EntitySummary[] {
  const summaries: EntitySummary[] = [];

  for (const entity of Object.values(graph.entities) as any[]) {
    // 이 엔티티와 연결된 관계들 찾기
    const relations: string[] = [];
    for (const edge of Object.values(graph.hyperedges) as any[]) {
      if (!edge.entities?.includes(entity.id)) continue;

      const otherId = edge.entities.find((id: string) => id !== entity.id);
      const other = graph.entities[otherId] as any;
      if (!other) continue;

      // 관계 방향 결정 (from이 현재 엔티티인지)
      const isFrom = edge.entities[0] === entity.id;
      const arrow = isFrom ? '→' : '←';
      const desc = (edge.statement || '').slice(0, 30);

      relations.push(`${edge.type} ${arrow} ${other.name}: ${desc}`);
    }

    summaries.push({
      name: entity.name,
      category: entity.category || 'character',
      description: (entity.description || '').slice(0, 50),
      relations: relations.slice(0, 5),  // 관계는 최대 5개
    });
  }

  return summaries;
}

/**
 * 엔티티 요약을 텍스트로 변환 (LLM 선별용)
 */
function formatEntitySummariesForSelection(summaries: EntitySummary[]): string {
  const categoryNames: Record<string, string> = {
    character: '인물',
    location: '장소',
    item: '물건',
    organization: '조직',
    event: '사건',
    concept: '개념'
  };

  return summaries.map(s => {
    const catName = categoryNames[s.category] || s.category;
    const header = `${s.name} (${catName})${s.description ? ' - ' + s.description : ''}`;
    if (s.relations.length === 0) {
      return header;
    }
    return header + '\n  ' + s.relations.join('\n  ');
  }).join('\n\n');
}

// 엔티티 선별용 프롬프트
const ENTITY_SELECTION_PROMPT = `다음 텍스트를 분석할 예정입니다. 아래 텍스트 미리보기를 읽고, 기존 엔티티 목록에서 이 텍스트와 **관련 있는 것만** 선택하세요.

## 텍스트 미리보기 (앞부분 1000자)
{{textPreview}}

---

## 기존 엔티티 목록
각 엔티티의 이름, 카테고리, 설명, 연결된 관계가 표시됩니다.
이 중에서 위 텍스트에 직접 언급되거나, 맥락상 관련 있는 엔티티만 선택하세요.

{{entitySummaries}}

---

## 지시사항
1. 텍스트에 직접 이름이 언급된 엔티티 선택
2. 텍스트 내용과 관련된 엔티티 선택 (예: "집에서" → "집" 선택)
3. 선택된 엔티티와 밀접하게 연결된 것도 고려 (소유자, 가족 등)
4. **concept 타입 (세계관, 현상, 규칙 등)은 관련 내용이 언급되면 반드시 선택** (예: "시간이 거꾸로" → "시간의 역전" 선택)
5. 무관한 엔티티는 제외

관련 있는 엔티티의 이름만 JSON 배열로 반환하세요.
예: ["나", "박스", "집"]

⚠️ JSON 배열만 반환. 설명 없이 이름 목록만.`;

/**
 * LLM을 사용하여 청크와 관련된 엔티티 선별
 */
async function selectRelevantEntities(
  chunkText: string,
  graph: NovelKnowledgeGraph,
  model?: string
): Promise<string[]> {
  // 엔티티가 1개 이하면 선별 없이 전체 반환
  const entityCount = Object.keys(graph.entities).length;
  if (entityCount <= 1) {
    console.log(`[선별] 엔티티 ${entityCount}개 - 선별 스킵, 전체 사용`);
    return Object.values(graph.entities).map((e: any) => e.name);
  }

  // 엔티티 요약 생성
  const summaries = buildEntitySummaries(graph);
  const summaryText = formatEntitySummariesForSelection(summaries);

  // 텍스트 미리보기 (앞부분 1000자)
  const textPreview = chunkText.slice(0, 1000);

  const prompt = ENTITY_SELECTION_PROMPT
    .replace('{{textPreview}}', textPreview)
    .replace('{{entitySummaries}}', summaryText);

  console.log(`[선별] 프롬프트 크기: ${prompt.length}자, 엔티티 ${entityCount}개`);

  try {
    // 빠른 모델로 선별 (gemini-flash 사용)
    const selectionModel = 'google/gemini-2.0-flash-001';
    const userApiKey = getApiKey();

    const response = await fetchWithClientTimeout('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        apiKey: userApiKey || undefined,
        model: selectionModel
      }),
    }, 30000);  // 30초 타임아웃 (빠른 작업)

    if (!response.ok) {
      console.warn('[선별] API 오류, 전체 엔티티 사용');
      return Object.values(graph.entities).map((e: any) => e.name);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // JSON 배열 파싱
    let selectedNames: string[] = [];
    try {
      // 마크다운 코드블록 제거
      let jsonContent = content.trim();
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.slice(7);
      } else if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.slice(3);
      }
      if (jsonContent.endsWith('```')) {
        jsonContent = jsonContent.slice(0, -3);
      }
      jsonContent = jsonContent.trim();

      selectedNames = JSON.parse(jsonContent);
      if (!Array.isArray(selectedNames)) {
        throw new Error('배열이 아님');
      }
    } catch {
      console.warn('[선별] JSON 파싱 실패, 전체 엔티티 사용');
      return Object.values(graph.entities).map((e: any) => e.name);
    }

    console.log(`[선별] ${entityCount}개 중 ${selectedNames.length}개 선택: ${selectedNames.slice(0, 10).join(', ')}${selectedNames.length > 10 ? '...' : ''}`);
    return selectedNames;

  } catch (error) {
    console.warn('[선별] 오류 발생, 전체 엔티티 사용:', error);
    return Object.values(graph.entities).map((e: any) => e.name);
  }
}

/**
 * 선택된 엔티티 이름으로 KnownEntity 목록 필터링
 */
function filterEntitiesByNames(
  graph: NovelKnowledgeGraph,
  selectedNames: string[]
): KnownEntity[] {
  const selectedSet = new Set(selectedNames.map(n => n.toLowerCase()));
  const result: KnownEntity[] = [];

  for (const entity of Object.values(graph.entities) as any[]) {
    const nameLower = entity.name.toLowerCase();
    const aliasMatch = (entity.aliases || []).some((a: string) =>
      selectedSet.has(a.toLowerCase())
    );

    if (selectedSet.has(nameLower) || aliasMatch) {
      result.push({
        name: entity.name,
        description: (entity.description || '').slice(0, 100),
        category: entity.category || 'character',
        aliases: entity.aliases || []
      });
    }
  }

  return result;
}

/**
 * allExtracted에서 축적 그래프 생성 (엔티티 + 관계 정보 포함)
 * 한번에 올리기/따로 올리기 모두 동일한 방식으로 처리
 */
function buildAccumulatedGraph(allExtracted: any[], existingGraph?: NovelKnowledgeGraph): NovelKnowledgeGraph {
  const entities: Record<string, any> = {};
  const hyperedges: Record<string, any> = {};

  // existingGraph가 있으면 그것을 기반으로 시작
  if (existingGraph) {
    Object.assign(entities, existingGraph.entities);
    Object.assign(hyperedges, existingGraph.hyperedges);
  }

  let entityCounter = Object.keys(entities).length;
  let edgeCounter = Object.keys(hyperedges).length;

  // 이름 → ID 매핑 (중복 체크용)
  const nameToId = new Map<string, string>();
  for (const [id, entity] of Object.entries(entities)) {
    nameToId.set((entity as any).name.toLowerCase(), id);
    for (const alias of ((entity as any).aliases || [])) {
      nameToId.set(alias.toLowerCase(), id);
    }
  }

  // allExtracted에서 엔티티와 관계 축적
  for (const extracted of allExtracted) {
    // 엔티티 축적
    for (const entity of (extracted.entities || [])) {
      const nameLower = entity.name.toLowerCase();
      if (!nameToId.has(nameLower)) {
        entityCounter++;
        const id = `E${String(entityCounter).padStart(4, '0')}`;
        entities[id] = {
          id,
          name: entity.name,
          category: entity.category || 'character',
          description: entity.description || '',
          aliases: entity.aliases || [],
        };
        nameToId.set(nameLower, id);
        for (const alias of (entity.aliases || [])) {
          nameToId.set(alias.toLowerCase(), id);
        }
      }
    }

    // 관계 축적
    for (const rel of (extracted.relationships || [])) {
      edgeCounter++;
      const edgeId = `R${String(edgeCounter).padStart(4, '0')}`;
      hyperedges[edgeId] = {
        id: edgeId,
        type: rel.type || '관련',
        participants: rel.participants || [],
        description: rel.description || '',
        scenes: rel.scenes || [],
      };
    }
  }

  return {
    metadata: { title: '', createdAt: '', updatedAt: '', version: '1.0.0' },
    entities,
    hyperedges,
    chapters: existingGraph?.chapters || {},
    timeline: existingGraph?.timeline || [],
    snapshots: existingGraph?.snapshots || {},
    stats: {
      totalEntities: Object.keys(entities).length,
      totalEdges: Object.keys(hyperedges).length,
      totalChapters: 0,
      entitiesByCategory: {} as any,
      edgesByType: {} as any
    }
  };
}

/**
 * KnownEntity 배열에서 선택된 이름으로 필터링
 */
function filterKnownEntitiesByNames(
  knownEntities: KnownEntity[],
  selectedNames: string[]
): KnownEntity[] {
  const selectedSet = new Set(selectedNames.map(n => n.toLowerCase()));

  return knownEntities.filter(e => {
    const nameLower = e.name.toLowerCase();
    const aliasMatch = (e.aliases || []).some((a: string) =>
      selectedSet.has(a.toLowerCase())
    );
    return selectedSet.has(nameLower) || aliasMatch;
  });
}

export async function extractKnowledgeGraph(
  text: string,
  title: string,
  onProgress?: (msg: string, current?: number, total?: number, estimatedMinutes?: number | null) => void,
  resumeFrom?: ExtractionProgress,
  model?: string,  // 사용할 모델 ID
  fileName?: string,  // 원본 파일명
  existingGraph?: NovelKnowledgeGraph  // 기존 지식그래프 (파일 추가 시)
): Promise<NovelKnowledgeGraph> {
  // 텍스트를 스마트하게 청크로 분할 (장/화 경계, 문장 끝 기준)
  const CHUNK_SIZE = 5000;
  let chunks: string[] = [];
  let allExtracted: any[] = [];
  let knownEntities: KnownEntity[] = [];
  let startChunk = 0;

  // 사용할 모델 결정: 이어하기면 저장된 모델, 아니면 파라미터 또는 기본값
  const useModel = resumeFrom?.model || model || DEFAULT_MODEL;

  // 이어하기인 경우
  if (resumeFrom) {
    chunks = resumeFrom.chunks;
    allExtracted = resumeFrom.allExtracted;
    // 이전 버전 호환: knownCharacters를 knownEntities로 변환
    knownEntities = (resumeFrom.knownCharacters || []).map(c => ({
      ...c,
      category: 'character'
    }));
    startChunk = resumeFrom.processedChunks;
    console.log(`이어하기: ${startChunk}/${resumeFrom.totalChunks}부터 재개 (모델: ${useModel})`);
    onProgress?.(`이어하기: ${startChunk}/${resumeFrom.totalChunks}부터 재개...`);
  } else {
    // 새로 시작: 스마트 청크 분할 사용
    chunks = splitIntoSmartChunks(text, CHUNK_SIZE);

    // 기존 지식그래프가 있으면 LLM 선별 방식 사용 예정
    // knownEntities는 비워두고, 각 청크 처리 시 선별하여 전달
    if (existingGraph) {
      const entityCount = Object.keys(existingGraph.entities).length;
      console.log(`기존 지식그래프 감지: ${entityCount}개 엔티티 (청크별 LLM 선별 사용)`);
    }

    console.log(`분석 시작 (모델: ${useModel})`);
  }

  const totalChunks = chunks.length;

  if (!resumeFrom) {
    console.log(`텍스트를 ${totalChunks}개 청크로 분할`);
    onProgress?.(`텍스트를 ${totalChunks}개 부분으로 분할...`);
  }

  let chunkTimes: number[] = [];
  let chunkStartTime = Date.now();

  for (let i = startChunk; i < chunks.length; i++) {
    const remaining = totalChunks - i;
    const avgTime = chunkTimes.length > 0 ? chunkTimes.reduce((a, b) => a + b, 0) / chunkTimes.length : 0;
    const estimatedRemaining = avgTime > 0 ? Math.ceil((remaining * avgTime) / 60000) : null;
    const timeText = estimatedRemaining !== null ? ` (예상 ${estimatedRemaining}분 남음)` : '';
    const msg = `청크 ${i + 1}/${totalChunks} 분석 중...${timeText}`;
    console.log(msg);
    const characterCount = knownEntities.filter(e => e.category === 'character').length;
    console.log(`[청크 ${i + 1}] 현재까지 알려진 엔티티: ${knownEntities.length}개 (인물 ${characterCount}명)`);
    onProgress?.(msg, i + 1, totalChunks, estimatedRemaining);

    chunkStartTime = Date.now();

    try {
      // 축적 그래프 생성: existingGraph + 이전 청크 결과 (allExtracted)
      // 한번에 올리기/따로 올리기 모두 동일한 방식으로 처리
      const accumulatedGraph = buildAccumulatedGraph(allExtracted, existingGraph);
      const totalKnownCount = Object.keys(accumulatedGraph.entities).length;

      let entitiesToUse: KnownEntity[] = [];

      // 2개 이상의 알려진 엔티티가 있으면 LLM 선별 사용
      if (totalKnownCount > 1) {
        onProgress?.(`청크 ${i + 1}: 관련 엔티티 선별 중...`, i + 1, totalChunks, estimatedRemaining);

        // LLM으로 관련 엔티티 선별
        const selectedNames = await selectRelevantEntities(chunks[i], accumulatedGraph, useModel);

        // 선별된 이름으로 필터링
        entitiesToUse = filterEntitiesByNames(accumulatedGraph, selectedNames);

        console.log(`[청크 ${i + 1}] LLM 선별: 축적 그래프 ${totalKnownCount}개 중 ${entitiesToUse.length}개 선택`);
      } else {
        // 알려진 엔티티가 1개 이하면 그냥 전체 사용 (accumulatedGraph에서 가져옴)
        entitiesToUse = filterEntitiesByNames(accumulatedGraph, Object.values(accumulatedGraph.entities).map((e: any) => e.name));
        console.log(`[청크 ${i + 1}] 선별 스킵 (알려진 엔티티 ${totalKnownCount}개)`);
      }

      console.log(`[청크 ${i + 1}] 프롬프트에 전달할 엔티티: ${entitiesToUse.length}개`);
      const extracted = await extractFromChunk(chunks[i], i + 1, entitiesToUse, useModel);
      if (extracted) {
        allExtracted.push(extracted);

        // 이 청크에서 발견된 모든 엔티티를 다음 청크를 위해 저장
        const newEntities: string[] = [];
        for (const entity of (extracted.entities || [])) {
          const existing = knownEntities.find(e =>
            e.name === entity.name ||
            e.aliases?.includes(entity.name) ||
            entity.aliases?.includes(e.name)
          );
          if (existing) {
            // 설명 업데이트
            if (entity.description && !existing.description.includes(entity.description)) {
              existing.description = (existing.description + ' ' + entity.description).slice(0, 200);
            }
            // 별칭 병합
            if (entity.aliases) {
              existing.aliases = [...new Set([...(existing.aliases || []), ...entity.aliases])];
            }
          } else {
            knownEntities.push({
              name: entity.name,
              description: (entity.description || '').slice(0, 100),
              category: entity.category || 'character',
              aliases: entity.aliases || []
            });
            newEntities.push(`${entity.name}(${entity.category})`);
          }
        }
        const extractedCharacters = (extracted.entities || []).filter((e: any) => e.category === 'character');
        console.log(`[청크 ${i + 1}] 추출된 인물: ${extractedCharacters.map((e: any) => e.name).join(', ')}`);
        console.log(`[청크 ${i + 1}] 새로 발견된 엔티티: ${newEntities.join(', ') || '없음'}`);
        console.log(`[청크 ${i + 1}] 누적 엔티티 수: ${knownEntities.length}개`);

        // 청크 처리 시간 측정
        chunkTimes.push(Date.now() - chunkStartTime);

        // 매 청크 후 진행상황 저장 (하위 호환성을 위해 knownCharacters로 저장)
        saveProgress({
          title,
          totalChunks,
          processedChunks: i + 1,
          allExtracted,
          knownCharacters: knownEntities.filter(e => e.category === 'character'),
          chunks,
          timestamp: Date.now(),
          model: useModel,
          originalText: resumeFrom?.originalText || text,
          fileName: resumeFrom?.fileName || fileName,
        });
      }
    } catch (error: any) {
      console.error(`청크 ${i + 1} 처리 실패:`, error);

      // 타임아웃이나 API 오류는 스킵하고 계속 진행
      const isTimeout = error.message?.includes('timeout') || error.message?.includes('AbortError') || error.name === 'AbortError';
      const isApiError = error.message?.includes('API');

      if (isTimeout || isApiError) {
        console.warn(`청크 ${i + 1} 스킵 (타임아웃/API 오류), 계속 진행...`);
        onProgress?.(`청크 ${i + 1} 스킵 (오류), 계속 진행...`);

        // 빈 결과로 추가 (장면 번호 유지를 위해)
        allExtracted.push({ chapters: [], scenes: [], entities: [], relationships: [] });

        // 진행상황 저장 (실패한 청크도 처리됨으로 표시)
        saveProgress({
          title,
          totalChunks,
          processedChunks: i + 1,
          allExtracted,
          knownCharacters: knownEntities.filter(e => e.category === 'character'),
          chunks,
          timestamp: Date.now(),
          model: useModel,
          originalText: resumeFrom?.originalText || text,
          fileName: resumeFrom?.fileName || fileName,
        });
        continue; // 다음 청크로 계속
      }

      // 다른 종류의 에러는 진행상황 저장 후 중단
      saveProgress({
        title,
        totalChunks,
        processedChunks: i,
        allExtracted,
        knownCharacters: knownEntities.filter(e => e.category === 'character'),
        chunks,
        timestamp: Date.now(),
        model: useModel,
        originalText: resumeFrom?.originalText || text,
        fileName: resumeFrom?.fileName || fileName,
      });
      throw new Error(`청크 ${i + 1}/${totalChunks} 처리 실패: ${error.message}. 이어하기로 재시도할 수 있습니다.`);
    }
  }

  // 완료되면 진행상황 삭제
  clearProgress();
  onProgress?.('인물 정보 병합 중...');

  // 결과 병합
  const merged = mergeExtractions(allExtracted);

  // 후처리: 누락된 관계 자동 생성
  onProgress?.('관계 검증 및 보완 중...');
  const validated = inferMissingRelationships(merged);

  // 이어하기인 경우 저장된 원본 텍스트/파일명 사용
  const finalText = resumeFrom?.originalText || text;
  const finalFileName = resumeFrom?.fileName || fileName;
  return buildKnowledgeGraph(validated, title, useModel, finalFileName, finalText, existingGraph);
}

// 클라이언트 측 fetch with timeout
async function fetchWithClientTimeout(url: string, options: RequestInit, timeoutMs: number = 150000): Promise<Response> {
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

async function extractFromChunk(
  chunkText: string,
  chunkNum: number,
  knownEntities: KnownEntity[] = [],
  model?: string  // 사용할 모델
): Promise<any> {
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

    const categoryNames: Record<string, string> = {
      character: '인물',
      location: '장소',
      item: '물건',
      organization: '조직',
      event: '사건',
      concept: '개념'
    };

    previousEntitiesText = `## 이전 청크에서 발견된 엔티티들 (동일한 것이면 같은 이름 사용!)
⚠️ 중요: 아래 목록에 있는 엔티티가 이번 청크에 다시 등장하면 반드시 같은 이름을 사용하세요!

`;

    for (const [category, entities] of Object.entries(byCategory)) {
      const categoryName = categoryNames[category] || category;
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
    console.error('API 응답 에러:', err);
    throw new Error(`API 오류: ${response.status} - ${err.slice(0, 200)}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }
  console.log('API 응답 데이터:', data);

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    console.error('응답 구조:', JSON.stringify(data, null, 2));
    throw new Error('LLM 응답이 비어있습니다. API 키를 확인해주세요.');
  }

  console.log('LLM 응답 내용:', content.slice(0, 500));

  let extracted;
  try {
    // 마크다운 코드블록 제거
    let jsonContent = content.trim();
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.slice(7);
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.slice(3);
    }
    if (jsonContent.endsWith('```')) {
      jsonContent = jsonContent.slice(0, -3);
    }
    jsonContent = jsonContent.trim();

    extracted = JSON.parse(jsonContent);
  } catch (parseErr) {
    console.error('JSON 파싱 에러, 원본:', content.slice(0, 1000));
    // JSON이 잘린 경우 복구 시도
    const fixedContent = tryFixJson(content);
    if (fixedContent) {
      console.log('JSON 복구 성공');
      extracted = fixedContent;
    } else {
      // 파싱 실패 시 빈 결과 반환 (전체 분석을 중단하지 않음)
      console.warn('JSON 파싱 실패, 이 청크 건너뜀');
      extracted = { chapters: [], scenes: [], entities: [], relationships: [] };
    }
  }

  return extracted;
}

// 여러 청크 결과를 병합 (같은 인물 판단 + 장면 번호 글로벌화)
function mergeExtractions(extractions: any[]): any {
  const entities: any[] = [];
  const relationships: any[] = [];
  const scenes: any[] = [];
  const chapters: any[] = [];
  const chapterMap: Record<string, number> = {}; // 장 제목 -> id 매핑
  const nameMap: Record<string, number> = {}; // 이름 -> entities 인덱스

  let globalSceneOffset = 0;

  console.log(`[병합] 총 ${extractions.length}개 청크 결과 병합 시작`);

  for (let chunkIdx = 0; chunkIdx < extractions.length; chunkIdx++) {
    const ext = extractions[chunkIdx];
    console.log(`[병합] 청크 ${chunkIdx + 1}: entities=${(ext.entities || []).length}, relationships=${(ext.relationships || []).length}, scenes=${(ext.scenes || []).length}`);

    // 장(chapter) 병합 (중복 제거)
    for (const chapter of (ext.chapters || [])) {
      const key = chapter.title || `제${chapter.id}장`;
      if (!chapterMap[key]) {
        const newId = chapters.length + 1;
        chapterMap[key] = newId;
        chapters.push({
          ...chapter,
          id: newId,
        });
      }
    }

    // 장면 병합 (글로벌 번호 부여 - 청크 내 순서 기준)
    // LLM이 준 scene.id는 무시하고, 배열 인덱스(청크 내 순서)를 사용
    const localToGlobal: Record<number, number> = {};
    const chunkScenes = ext.scenes || [];

    for (let sceneIdx = 0; sceneIdx < chunkScenes.length; sceneIdx++) {
      const scene = chunkScenes[sceneIdx];
      // 글로벌 ID = 이전 청크들의 장면 수 + 현재 청크 내 순서(1부터 시작)
      const globalId = globalSceneOffset + sceneIdx + 1;
      // LLM이 준 scene.id를 글로벌 ID로 매핑 (엔티티/관계의 scenes 참조용)
      localToGlobal[scene.id] = globalId;

      // 장면의 chapter를 글로벌 chapter id로 변환
      let globalChapter = scene.chapter;
      if (scene.chapter && ext.chapters) {
        const chapterInfo = ext.chapters.find((c: any) => c.id === scene.chapter);
        if (chapterInfo) {
          const key = chapterInfo.title || `제${chapterInfo.id}장`;
          globalChapter = chapterMap[key] || scene.chapter;
        }
      }

      scenes.push({
        ...scene,
        id: globalId,
        chapter: globalChapter,
        chunkNum: chunkIdx + 1
      });
    }
    globalSceneOffset += chunkScenes.length || 1;

    // 엔티티 병합
    for (const entity of (ext.entities || [])) {
      const normalizedName = normalizeName(entity.name);
      const existingIdx = findSimilarEntity(normalizedName, nameMap, entities);

      // 장면 번호를 글로벌로 변환
      const globalScenes = (entity.scenes || []).map((s: number) => localToGlobal[s] || s);

      if (existingIdx !== -1) {
        // 기존 엔티티에 정보 추가
        const existing = entities[existingIdx];
        if (entity.description && !existing.description?.includes(entity.description)) {
          existing.description = (existing.description || '') + ' ' + entity.description;
        }
        // 장면 병합
        existing.scenes = [...new Set([...(existing.scenes || []), ...globalScenes])];
        // 속성 병합
        if (entity.attributes) {
          existing.attributes = { ...(existing.attributes || {}), ...entity.attributes };
        }
        // aliases 병합
        if (entity.aliases) {
          existing.aliases = [...new Set([...(existing.aliases || []), ...entity.aliases])];
        }
      } else {
        // 새 엔티티
        const idx = entities.length;
        entities.push({
          ...entity,
          scenes: globalScenes,
          aliases: entity.aliases || []
        });
        nameMap[normalizedName] = idx;
        for (const alias of (entity.aliases || [])) {
          nameMap[normalizeName(alias)] = idx;
        }
      }
    }

    // 관계 병합 (중복 시 장면만 추가)
    for (const rel of (ext.relationships || [])) {
      const globalScenes = (rel.scenes || []).map((s: number) => localToGlobal[s] || s);
      const key = `${normalizeName(rel.from)}-${rel.type}-${normalizeName(rel.to)}`;
      const existingRel = relationships.find(r =>
        `${normalizeName(r.from)}-${r.type}-${normalizeName(r.to)}` === key
      );

      if (existingRel) {
        // 장면만 추가
        existingRel.scenes = [...new Set([...(existingRel.scenes || []), ...globalScenes])];
      } else {
        relationships.push({ ...rel, scenes: globalScenes });
      }
    }
  }

  console.log(`[병합 완료] 최종 entities=${entities.length}, relationships=${relationships.length}, scenes=${scenes.length}, chapters=${chapters.length}`);
  console.log(`[병합 완료] 인물 목록: ${entities.filter(e => e.category === 'character').map(e => e.name).join(', ')}`);
  return { entities, relationships, scenes, chapters };
}

// 이름 정규화 (공백, 호칭 제거)
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(씨|님|군|양|선생|사장|부장|과장|대리|사원)$/g, '');
}

// 비슷한 엔티티 찾기
function findSimilarEntity(name: string, nameMap: Record<string, number>, _entities: any[]): number {
  // 정확히 일치
  if (nameMap[name] !== undefined) {
    return nameMap[name];
  }

  // "나", "나는", "주인공" 같은 1인칭 표현 통합
  const firstPersonNames = ['나', '나는', '주인공', '화자'];
  if (firstPersonNames.includes(name)) {
    for (const fpName of firstPersonNames) {
      if (nameMap[fpName] !== undefined) {
        return nameMap[fpName];
      }
    }
  }

  // 부분 일치 (2글자 이상)
  if (name.length >= 2) {
    for (const [existingName, idx] of Object.entries(nameMap)) {
      if (existingName.includes(name) || name.includes(existingName)) {
        return idx;
      }
    }
  }

  return -1;
}

// 잘린 JSON 복구 시도
function tryFixJson(content: string): any {
  // 마크다운 코드블록 제거
  let fixed = content.trim();
  if (fixed.startsWith('```json')) {
    fixed = fixed.slice(7);
  } else if (fixed.startsWith('```')) {
    fixed = fixed.slice(3);
  }
  if (fixed.endsWith('```')) {
    fixed = fixed.slice(0, -3);
  }
  fixed = fixed.trim();

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

// 허용된 관계 타입
const VALID_RELATION_TYPES = ['가족', '연인', '친구', '적대', '동료', '소속', '위치', '소유', '포함', '관련'];

// 잘못된 관계 타입을 올바른 타입으로 매핑
const RELATION_TYPE_MAPPING: Record<string, string> = {
  // 가족 관련
  '부모': '가족', '자녀': '가족', '형제': '가족', '자매': '가족', '친척': '가족',
  '아버지': '가족', '어머니': '가족', '아들': '가족', '딸': '가족', '할머니': '가족', '할아버지': '가족',
  // 연인 관련
  '사랑': '연인', '짝사랑': '연인', '애인': '연인', '전연인': '연인', '결혼': '연인',
  // 친구 관련
  '지인': '친구', '아는사이': '친구', '친한사이': '친구', '우정': '친구',
  '아친구이': '친구', // 잘못 생성된 예시
  // 적대 관련
  '원수': '적대', '라이벌': '적대', '갈등': '적대', '경쟁': '적대', '싸움': '적대',
  // 동료 관련
  '직장동료': '동료', '팀원': '동료', '동기': '동료', '선배': '동료', '후배': '동료',
  // 영어 타입 (하위호환)
  'family': '가족', 'romantic': '연인', 'friendship': '친구', 'rivalry': '적대',
  'mentor': '동료', 'subordinate': '동료', 'belongs_to': '소속', 'owns': '소유',
  'located_at': '위치', 'related_to': '관련', 'related': '관련',
};

/**
 * 관계 타입 정규화 - 잘못된 타입을 올바른 타입으로 변환
 */
function normalizeRelationType(type: string): string {
  if (!type) return '관련';

  const trimmed = type.trim();

  // 이미 유효한 타입이면 그대로 반환
  if (VALID_RELATION_TYPES.includes(trimmed)) {
    return trimmed;
  }

  // 매핑에서 찾기
  const mapped = RELATION_TYPE_MAPPING[trimmed] || RELATION_TYPE_MAPPING[trimmed.toLowerCase()];
  if (mapped) {
    console.log(`관계 타입 정규화: "${trimmed}" → "${mapped}"`);
    return mapped;
  }

  // 부분 매칭 시도
  for (const [key, value] of Object.entries(RELATION_TYPE_MAPPING)) {
    if (trimmed.includes(key) || key.includes(trimmed)) {
      console.log(`관계 타입 정규화 (부분매칭): "${trimmed}" → "${value}"`);
      return value;
    }
  }

  // 매핑 실패 시 기본값
  console.log(`관계 타입 정규화 실패: "${trimmed}" → "관련"`);
  return '관련';
}

/**
 * 모든 관계의 타입을 정규화
 */
function normalizeAllRelationTypes(extracted: any): any {
  const { relationships, ...rest } = extracted;

  const normalizedRelationships = (relationships || []).map((rel: any) => ({
    ...rel,
    type: normalizeRelationType(rel.type)
  }));

  return { ...rest, relationships: normalizedRelationships };
}

/**
 * 후처리: 엔티티 설명에서 누락된 관계 자동 생성
 * "화자가 피우는 담배" 같은 설명에서 소유 관계를 추출
 * "화자가 걷는 길" 같은 설명에서 위치 관계를 추출
 */
function inferMissingRelationships(extracted: any): any {
  // 먼저 관계 타입 정규화
  const normalized = normalizeAllRelationTypes(extracted);
  const { entities, relationships } = normalized;
  const newRelationships: any[] = [];

  // 엔티티 이름 목록 (인물만)
  const characterNames = entities
    .filter((e: any) => e.category === 'character')
    .map((e: any) => e.name);

  // 소유자/사용자 패턴 (소유 관계)
  const ownerPatterns = [
    /^(.+?)(?:가|이|의)\s*(?:피우는|먹는|마시는|쓰는|타는|가진|입는|쓰던|읽는|보는|사용하는|운전하는|타고\s*다니는|가지고\s*있는)/,
    /^(.+?)의\s+/,  // "~의 물건" 패턴
  ];

  // 위치 패턴 (위치 관계) - location 엔티티용
  const locationPatterns = [
    /^(.+?)(?:가|이)\s*(?:걷는|걸어가는|지나가는|다니는|있는|가는|오는|서\s*있는|앉아\s*있는|누워\s*있는)/,
    /^(.+?)(?:가|이)\s*(?:사는|거주하는|일하는|근무하는|다니는)/,
  ];

  for (const entity of entities) {
    if (entity.category === 'character') continue; // 인물은 스킵

    const desc = entity.description || '';
    const attrOwner = entity.attributes?.owner;
    const isLocation = entity.category === 'location';

    // attributes.owner가 있으면 관계 생성
    if (attrOwner) {
      const ownerName = normalizeOwnerName(attrOwner);
      if (!hasRelationship(relationships, ownerName, entity.name) &&
          !hasRelationship(newRelationships, ownerName, entity.name)) {
        newRelationships.push({
          from: ownerName,
          to: entity.name,
          type: isLocation ? '위치' : '소유',
          description: `${ownerName}의 ${entity.name}`,
          sentiment: 'neutral',
          strength: 5,
          scenes: entity.scenes || []
        });
      }
    }

    // location 엔티티면 위치 패턴 먼저 시도
    if (isLocation) {
      let foundMatch = false;
      for (const pattern of locationPatterns) {
        const match = desc.match(pattern);
        if (match) {
          let personName = match[1].trim();
          personName = normalizeOwnerName(personName);

          // 이미 관계가 있는지 확인
          if (!hasRelationship(relationships, personName, entity.name) &&
              !hasRelationship(newRelationships, personName, entity.name)) {
            newRelationships.push({
              from: personName,
              to: entity.name,
              type: '위치',
              description: desc,
              sentiment: 'neutral',
              strength: 5,
              scenes: entity.scenes || []
            });
            console.log(`위치 관계 추론: "${personName}" -> "${entity.name}" (${desc})`);
          }
          foundMatch = true;
          break;
        }
      }
      if (foundMatch) continue;
    }

    // 설명에서 소유자 패턴 찾기
    for (const pattern of ownerPatterns) {
      const match = desc.match(pattern);
      if (match) {
        let ownerName = match[1].trim();
        ownerName = normalizeOwnerName(ownerName);

        // 이미 관계가 있는지 확인
        if (!hasRelationship(relationships, ownerName, entity.name) &&
            !hasRelationship(newRelationships, ownerName, entity.name)) {
          newRelationships.push({
            from: ownerName,
            to: entity.name,
            type: isLocation ? '위치' : '소유',
            description: desc,
            sentiment: 'neutral',
            strength: 5,
            scenes: entity.scenes || []
          });
        }
        break; // 첫 번째 매칭만 사용
      }
    }

    // 설명에서 인물 이름이 직접 언급되어 있으면 관계 생성
    for (const charName of characterNames) {
      if (desc.includes(charName)) {
        if (!hasRelationship(relationships, charName, entity.name) &&
            !hasRelationship(newRelationships, charName, entity.name)) {
          newRelationships.push({
            from: charName,
            to: entity.name,
            type: isLocation ? '위치' : '관련',
            description: desc,
            sentiment: 'neutral',
            strength: 4,
            scenes: entity.scenes || []
          });
          console.log(`설명 기반 관계 추론: "${charName}" -> "${entity.name}"`);
        }
      }
    }
  }

  console.log(`후처리: ${newRelationships.length}개의 누락된 관계 추가됨`);

  return {
    ...normalized,
    relationships: [...relationships, ...newRelationships]
  };
}

// 소유자 이름 정규화
function normalizeOwnerName(name: string): string {
  const firstPersonAliases = ['화자', '주인공', '나는', '내'];
  if (firstPersonAliases.includes(name.toLowerCase())) {
    return '나';
  }
  return name;
}

// 관계 존재 여부 확인
function hasRelationship(relationships: any[], from: string, to: string): boolean {
  const normFrom = from.toLowerCase();
  const normTo = to.toLowerCase();
  return relationships.some(r =>
    (r.from?.toLowerCase() === normFrom && r.to?.toLowerCase() === normTo) ||
    (r.from?.toLowerCase() === normTo && r.to?.toLowerCase() === normFrom)
  );
}

function buildKnowledgeGraph(extracted: any, title: string, model?: string, fileName?: string, originalText?: string, existingGraph?: NovelKnowledgeGraph): NovelKnowledgeGraph {
  const now = new Date().toISOString();

  // 기존 그래프가 있으면 거기서 시작, 없으면 빈 값으로 시작
  const entities: Record<string, any> = existingGraph ? { ...existingGraph.entities } : {};
  const hyperedges: Record<string, any> = existingGraph ? { ...existingGraph.hyperedges } : {};
  const nameToId: Record<string, string> = {};

  // 기존 엔티티의 이름 매핑 초기화
  Object.values(entities).forEach((e: any) => {
    nameToId[e.name] = e.id;
    nameToId[e.name.toLowerCase()] = e.id;
    nameToId[normalizeName(e.name)] = e.id;
    (e.aliases || []).forEach((alias: string) => {
      nameToId[alias] = e.id;
      nameToId[alias.toLowerCase()] = e.id;
      nameToId[normalizeName(alias)] = e.id;
    });
  });

  // 기존 카운터 (기존 데이터가 있으면 이어서)
  let entityCounter = Object.keys(entities).length;
  let edgeCounter = Object.keys(hyperedges).length;
  let chapterCounter = existingGraph ? Object.keys(existingGraph.chapters || {}).length : 0;

  // 엔티티 등록
  (extracted.entities || []).forEach((e: any) => {
    // 기존에 같은 이름의 엔티티가 있는지 확인
    const existingId = nameToId[e.name] || nameToId[e.name.toLowerCase()] || nameToId[normalizeName(e.name)];

    if (existingId && entities[existingId]) {
      // 기존 엔티티에 정보 추가
      const existing = entities[existingId];
      // 별칭 병합
      existing.aliases = [...new Set([...(existing.aliases || []), ...(e.aliases || [])])];
      // 설명 추가
      if (e.description && !existing.description?.includes(e.description)) {
        existing.description = (existing.description + ' ' + e.description).slice(0, 500);
      }
      // 장면 병합 (새 장면 번호는 나중에 처리)
      return; // 새 엔티티 생성 안함
    }

    entityCounter++;
    const id = `E${String(entityCounter).padStart(4, '0')}`;
    const sceneIds = (e.scenes || []).map((s: number) => `S${String(s).padStart(4, '0')}`);
    entities[id] = {
      id,
      name: e.name,
      category: e.category || 'character',
      aliases: e.aliases || [],
      description: e.description || '',
      attributes: e.attributes || {},
      scenes: sceneIds,  // 등장 장면 ID들 (문자열)
      firstMention: { chapter: 1 },
      importance: e.importance || 5,  // 기본 중요도 5
    };
    nameToId[e.name] = id;
    // 소문자로도 매핑
    nameToId[e.name.toLowerCase()] = id;
    // 정규화된 이름으로도 매핑
    nameToId[normalizeName(e.name)] = id;
    (e.aliases || []).forEach((alias: string) => {
      nameToId[alias] = id;
      nameToId[alias.toLowerCase()] = id;
      nameToId[normalizeName(alias)] = id;
    });
  });

  // 유연한 이름 매칭 함수
  const findEntityId = (name: string): string | undefined => {
    if (!name) return undefined;

    // 1. 정확한 매칭
    if (nameToId[name]) return nameToId[name];
    if (nameToId[name.toLowerCase()]) return nameToId[name.toLowerCase()];

    // 2. 정규화된 이름으로 매칭
    const normalized = normalizeName(name);
    if (nameToId[normalized]) return nameToId[normalized];

    // 3. 부분 매칭 (이름이 포함되거나 포함하는 경우)
    const nameLower = name.toLowerCase();
    for (const [entityName, id] of Object.entries(nameToId)) {
      const entityNameLower = entityName.toLowerCase();
      // "춘향" ↔ "춘향이", "이도령" ↔ "이몽룡 이도령"
      if (entityNameLower.includes(nameLower) || nameLower.includes(entityNameLower)) {
        return id;
      }
    }

    // 4. 2글자 이상 공통 부분 매칭
    if (name.length >= 2) {
      for (const [entityName, id] of Object.entries(nameToId)) {
        // 한글 이름에서 겹치는 부분이 2글자 이상이면 매칭
        const overlap = findOverlap(name, entityName);
        if (overlap.length >= 2) {
          return id;
        }
      }
    }

    return undefined;
  };

  // 두 문자열의 최대 겹치는 부분 찾기
  const findOverlap = (a: string, b: string): string => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    let maxOverlap = '';

    for (let i = 0; i < aLower.length; i++) {
      for (let j = i + 1; j <= aLower.length; j++) {
        const sub = aLower.slice(i, j);
        if (bLower.includes(sub) && sub.length > maxOverlap.length) {
          maxOverlap = sub;
        }
      }
    }
    return maxOverlap;
  };

  // 관계 등록
  (extracted.relationships || []).forEach((r: any) => {
    // 유연한 이름 매칭
    const fromId = findEntityId(r.from);
    const toId = findEntityId(r.to);
    if (!fromId || !toId) {
      console.log('관계 매핑 실패:', r.from, '->', r.to, '(엔티티를 찾을 수 없음)');
      return;
    }

    // 같은 엔티티 간의 관계는 무시
    if (fromId === toId) {
      console.log('자기참조 관계 무시:', r.from, '->', r.to);
      return;
    }

    // 기존에 같은 관계가 있는지 확인
    const existingEdge = Object.values(hyperedges).find((e: any) =>
      e.type === r.type &&
      e.entities.includes(fromId) &&
      e.entities.includes(toId)
    );

    const sceneIds = (r.scenes || []).map((s: number) => `S${String(s).padStart(4, '0')}`);

    if (existingEdge) {
      // 기존 관계에 장면만 추가
      existingEdge.scenes = [...new Set([...(existingEdge.scenes || []), ...sceneIds])];
      return;
    }

    edgeCounter++;
    const id = `H${String(edgeCounter).padStart(4, '0')}`;
    hyperedges[id] = {
      id,
      type: r.type,
      subtype: r.subtype,
      entities: [fromId, toId],
      statement: r.description,
      quote: r.quote,  // 원문 인용
      timeline: {
        start: r.start_time,
        chapter: 1,
      },
      sentiment: r.sentiment,
      strength: r.strength,
      bidirectional: r.bidirectional,
      fromPerspective: r.from_perspective,
      toPerspective: r.to_perspective,
      scenes: sceneIds,  // 등장 장면 ID들 (문자열)
      sourceRef: { chapter: 1 },
    };
  });

  // description에서 다른 엔티티 언급을 찾아 자동 관계 생성
  // edgeCounter는 이미 위에서 관계 등록 시 업데이트됨
  Object.values(entities).forEach((entity: any) => {
    if (!entity.description) return;

    const descLower = entity.description.toLowerCase();

    // 다른 모든 엔티티를 검사해서 description에 언급되어 있는지 확인
    Object.values(entities).forEach((otherEntity: any) => {
      if (entity.id === otherEntity.id) return;

      // 이름이나 별칭이 description에 포함되어 있는지 확인
      const namesToCheck = [otherEntity.name, ...(otherEntity.aliases || [])];
      const isMentioned = namesToCheck.some((name: string) =>
        descLower.includes(name.toLowerCase())
      );

      if (!isMentioned) return;

      // 이미 관계가 존재하는지 확인
      const existingEdge = Object.values(hyperedges).find((edge: any) =>
        (edge.entities.includes(entity.id) && edge.entities.includes(otherEntity.id))
      );

      if (existingEdge) return; // 이미 관계 있음

      // 새 관계 생성
      edgeCounter++;
      const id = `H${String(edgeCounter).padStart(4, '0')}`;

      // 관계 타입 추정
      let relationType = 'related';
      if (entity.category === 'location' || otherEntity.category === 'location') {
        relationType = 'location';
      } else if (entity.category === 'object' || otherEntity.category === 'object') {
        relationType = 'ownership';
      }

      // statement에 실제 description 내용을 포함
      // description에서 해당 인물/엔티티가 언급된 부분을 추출
      let statementText = entity.description;
      // description이 너무 길면 축약
      if (statementText && statementText.length > 200) {
        // 다른 엔티티 이름이 포함된 문장만 추출 시도
        const sentences = statementText.split(/[.!?。]/).filter((s: string) => s.trim());
        const relevantSentences = sentences.filter((s: string) =>
          namesToCheck.some((name: string) => s.toLowerCase().includes(name.toLowerCase()))
        );
        if (relevantSentences.length > 0) {
          statementText = relevantSentences.join('. ').trim();
        } else {
          statementText = statementText.slice(0, 200) + '...';
        }
      }

      hyperedges[id] = {
        id,
        type: relationType,
        subtype: undefined,
        entities: [entity.id, otherEntity.id],
        statement: statementText || `${entity.name}의 설명에 ${otherEntity.name}이(가) 언급됨`,
        timeline: { start: undefined, chapter: 1 },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: true,
        scenes: entity.scenes || [],
        sourceRef: { chapter: 1 },
      };

      console.log(`자동 관계 생성: ${entity.name} - ${otherEntity.name} (description 기반)`);
    });
  });

  // 같은 장면에 등장하는 캐릭터-캐릭터 간 자동 관계 생성 (2번 후처리)
  // LLM이 관계를 추출하지 못한 경우, 같은 장면에 등장하면 "관련" 관계 자동 생성
  const characterEntities = Object.values(entities).filter((e: any) => e.category === 'character');

  for (let i = 0; i < characterEntities.length; i++) {
    const char1 = characterEntities[i] as any;
    if (!char1.scenes || char1.scenes.length === 0) continue;

    for (let j = i + 1; j < characterEntities.length; j++) {
      const char2 = characterEntities[j] as any;
      if (!char2.scenes || char2.scenes.length === 0) continue;

      // 공통 장면 찾기
      const commonScenes = char1.scenes.filter((s: string) => char2.scenes.includes(s));
      if (commonScenes.length === 0) continue;

      // 이미 관계가 존재하는지 확인
      const existingEdge = Object.values(hyperedges).find((edge: any) =>
        edge.entities.includes(char1.id) && edge.entities.includes(char2.id)
      );

      if (existingEdge) continue; // 이미 관계 있음

      // 새 관계 생성
      edgeCounter++;
      const id = `H${String(edgeCounter).padStart(4, '0')}`;

      hyperedges[id] = {
        id,
        type: '관련',
        subtype: undefined,
        entities: [char1.id, char2.id],
        statement: `${char1.name}과(와) ${char2.name}이(가) 동일 장면에 등장 (장면 ${commonScenes.map((s: string) => s.replace('S', '').replace(/^0+/, '')).join(', ')})`,
        timeline: { start: undefined, chapter: 1 },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: true,
        scenes: commonScenes,
        sourceRef: { chapter: 1 },
      };

      console.log(`캐릭터 동시 등장 관계 생성: ${char1.name} ↔ ${char2.name} (장면: ${commonScenes.join(', ')})`);
    }
  }

  // 같은 장면에 등장하는 캐릭터-비캐릭터 엔티티 간 자동 관계 생성
  // 예: "콘크리트"와 "나"가 둘 다 장면 2에 등장하면 위치 관계 생성
  const nonCharacterEntities = Object.values(entities).filter((e: any) => e.category !== 'character');

  nonCharacterEntities.forEach((entity: any) => {
    if (!entity.scenes || entity.scenes.length === 0) return;

    // 이 엔티티와 같은 장면에 등장하는 캐릭터들 찾기
    characterEntities.forEach((char: any) => {
      if (!char.scenes || char.scenes.length === 0) return;

      // 공통 장면이 있는지 확인
      const commonScenes = entity.scenes.filter((s: string) => char.scenes.includes(s));
      if (commonScenes.length === 0) return;

      // 이미 관계가 존재하는지 확인
      const existingEdge = Object.values(hyperedges).find((edge: any) =>
        edge.entities.includes(entity.id) && edge.entities.includes(char.id)
      );

      if (existingEdge) return; // 이미 관계 있음

      // 새 관계 생성
      edgeCounter++;
      const id = `H${String(edgeCounter).padStart(4, '0')}`;

      // 관계 타입 추정
      let relationType = '관련';
      if (entity.category === 'location') {
        relationType = '위치';
      } else if (entity.category === 'item' || entity.category === 'object') {
        relationType = '소유';
      }

      hyperedges[id] = {
        id,
        type: relationType,
        subtype: undefined,
        entities: [char.id, entity.id],
        statement: `${char.name}이(가) ${entity.name}에서/과 함께 등장 (장면 ${commonScenes.map((s: string) => s.replace('S', '').replace(/^0+/, '')).join(', ')})`,
        timeline: { start: undefined, chapter: 1 },
        sentiment: 'neutral',
        strength: 3,
        bidirectional: false,
        scenes: commonScenes,
        sourceRef: { chapter: 1 },
      };

      console.log(`장면 공동 등장 관계 생성: ${char.name} -> ${entity.name} (${relationType}, 장면: ${commonScenes.join(', ')})`);
    });
  });

  // 타임라인 등록
  const timeline = (extracted.timeline || []).map((t: any) => ({
    id: t.time_id,
    name: t.events?.[0] || t.time_expression,
    description: (t.events || []).join(', '),
    storyTime: t.time_expression,
    order: t.order,
    chapter: 1,
    entities: (t.characters || []).map((name: string) => nameToId[name]).filter(Boolean),
    edges: [],
  })).sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

  // 장(Chapter) 정보 처리 - 기존 그래프가 있으면 포함
  const chapters: Record<string, any> = existingGraph ? { ...existingGraph.chapters } : {};

  // 새 장 정보 추가 (번호 이어서)
  (extracted.chapters || []).forEach((c: any) => {
    chapterCounter++;
    const chapterId = `C${String(chapterCounter).padStart(4, '0')}`;
    chapters[chapterId] = {
      id: chapterId,
      number: chapterCounter,
      title: c.title || `제${chapterCounter}장`,
      summary: c.summary || '',
    };
  });

  // 새 장 정보를 위한 번호 매핑 (extracted의 장 번호 -> 실제 장 번호)
  let newChapterNumber = chapterCounter;

  // 장이 없으면 장 정보를 생성하지 않음 (파일명을 장 제목으로 쓰지 않음)
  // LLM이 장/화를 추출하지 못했다면 그냥 장 없이 장면만 표시
  // (이전에는 파일명을 장 제목으로 사용했으나, 사용자가 입력한 제목이 잘못 표시되는 문제 발생)

  // 장면(Scene)을 snapshots로 - 기존 그래프가 있으면 포함
  const snapshots: Record<string, any> = existingGraph ? { ...existingGraph.snapshots } : {};
  const sortedScenes = [...(extracted.scenes || [])].sort((a: any, b: any) => (a.id || 0) - (b.id || 0));

  sortedScenes.forEach((s: any) => {
    const sceneId = `S${String(s.id).padStart(4, '0')}`;

    // 장 번호도 기존 것에 이어서
    const actualChapterNum = s.chapter ? (s.chapter + (existingGraph ? Object.keys(existingGraph.chapters || {}).length : 0)) : newChapterNumber;
    const chapterId = actualChapterNum ? `C${String(actualChapterNum).padStart(4, '0')}` : null;

    // 이 장면에 등장하는 엔티티들 (scenes 배열에 sceneId가 포함된 것)
    const entitiesInScene = Object.values(entities)
      .filter((e: any) => e.scenes?.includes(sceneId))
      .map((e: any) => e.id);

    // 이 장면에 해당하는 관계들
    const activeEdges = Object.values(hyperedges)
      .filter((e: any) => e.scenes?.includes(sceneId))
      .map((e: any) => e.id);

    snapshots[sceneId] = {
      sceneId,
      order: s.id,  // 서술 순서 (청크 병합에서 부여된 글로벌 번호)
      chapter: chapterId,
      chapterNumber: actualChapterNum,
      time: s.time || `장면 ${s.id}`,
      timeMarker: s.time_marker || null,  // 텍스트에 명시된 시간 표현만 (추측 금지)
      location: s.location,
      summary: s.summary,
      events: s.events || [],
      mood: s.mood,
      charactersPresent: entitiesInScene,
      activeEdges,
    };
  });

  // 통계
  const entitiesByCategory: Record<string, number> = {};
  const edgesByType: Record<string, number> = {};

  Object.values(entities).forEach((e: any) => {
    entitiesByCategory[e.category] = (entitiesByCategory[e.category] || 0) + 1;
  });

  Object.values(hyperedges).forEach((e: any) => {
    edgesByType[e.type] = (edgesByType[e.type] || 0) + 1;
  });

  // 소스 파일 정보 생성 - 기존 파일 목록에 추가
  const existingSourceFiles = existingGraph?.metadata?.sourceFiles || [];
  const newSourceFile = (fileName && originalText) ? {
    id: `F${String(existingSourceFiles.length + 1).padStart(4, '0')}`,
    fileName,
    uploadedAt: now,
    text: originalText,
    charCount: originalText.length,
  } : null;
  const sourceFiles = newSourceFile ? [...existingSourceFiles, newSourceFile] : existingSourceFiles;

  // 기존 타임라인과 병합
  const mergedTimeline = existingGraph ? [...(existingGraph.timeline || []), ...timeline] : timeline;

  return {
    metadata: {
      // 기존 메타데이터 유지 (제목, 작가 등)
      ...(existingGraph?.metadata || {}),
      title: existingGraph?.metadata?.title || title,  // 기존 제목 유지
      createdAt: existingGraph?.metadata?.createdAt || now,
      updatedAt: now,
      version: '1.0.0',
      model: existingGraph?.metadata?.model || model,  // 기존 모델 유지
      sourceFiles,
    },
    entities,
    hyperedges,
    chapters,
    timeline: mergedTimeline,
    snapshots,
    stats: {
      totalEntities: Object.keys(entities).length,
      totalEdges: Object.keys(hyperedges).length,
      totalChapters: Object.keys(chapters).length,
      entitiesByCategory: entitiesByCategory as any,
      edgesByType: edgesByType as any,
    },
  };
}

