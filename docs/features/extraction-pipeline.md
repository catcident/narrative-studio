# 텍스트 분석 파이프라인

소설 텍스트를 분석하여 지식 그래프를 생성하는 전체 파이프라인입니다.

## 개요

```
텍스트 입력 → 청크 분할 → LLM 분석 → 결과 병합 → 후처리 → 지식 그래프 생성
```

## 파일 구조

```
web/src/services/extraction/
├── index.ts          # 메인 export
├── orchestrator.ts   # 전체 흐름 제어
├── chunker.ts        # 텍스트 청크 분할
├── selector.ts       # 엔티티 선별 (LLM)
├── extractor.ts      # 청크별 추출 (LLM)
├── merger.ts         # 결과 병합 및 그래프 구축
├── prompts.ts        # LLM 프롬프트 정의
└── types.ts          # 타입 정의
```

## 1. 청크 분할 (chunker.ts)

### 알고리즘

```typescript
splitIntoSmartChunksWithSource(text: string, chunkSize: number = 5000)
```

1. **장/화 경계 감지**: `제X장`, `X화`, `Chapter X` 등의 패턴 찾기
2. **문장 끝 기준 분할**: 청크 크기에 도달하면 가장 가까운 문장 끝(`.`, `!`, `?`)에서 분할
3. **파일 인덱스 추적**: 여러 파일 업로드 시 각 청크가 어느 파일에서 왔는지 기록

### 출력

```typescript
{ content: string, sourceFileIndex: number }[]
```

## 2. 엔티티 선별 (selector.ts)

기존 그래프에 엔티티가 많을 때, 현재 청크와 관련된 엔티티만 선별합니다.

### 함수

```typescript
selectRelevantEntities(chunkText: string, graph: AccumulatedGraph, model?: string)
```

### 알고리즘

1. 엔티티가 1개 이하면 선별 스킵
2. 엔티티 요약 생성 (이름, 카테고리, 설명, 관계 최대 5개)
3. 청크 텍스트 미리보기 (앞 1000자)
4. LLM에게 관련 엔티티 이름 목록 요청 (gemini-flash 사용)
5. JSON 배열로 파싱

### 선별 기준 (프롬프트)

- 텍스트에 직접 언급된 엔티티
- 관련 내용이 있는 엔티티 (예: "집에서" → "집")
- 밀접하게 연결된 엔티티 (소유자, 가족 등)
- concept 타입은 관련 내용 언급 시 반드시 선택

## 3. 청크 추출 (extractor.ts)

### 함수

```typescript
extractFromChunk(text: string, chunkNum: number, knownEntities: KnownEntity[], model: string)
```

### 추출 대상

| 항목 | 설명 |
|------|------|
| chapters | 장/화 정보 |
| scenes | 장면 (위치, 시간, 요약, 등장인물) |
| entities | 엔티티 (인물, 장소, 아이템, 개념) |
| relationships | 관계 (from, to, type, description) |

### 엔티티 카테고리

| 카테고리 | 설명 | 예시 |
|----------|------|------|
| character | 대화/행동하는 존재 | 나, 검은 고양이, 흰 수염 노인 |
| location | 공간/장소 | 골목, 집, 방, 공원 |
| item | 물건/도구 | 쓰레기통, 박스, 음식 |
| concept | 추상적 개념 | 세계관 설정, 시간의 역전 |

### 관계 타입 (10가지)

```
가족, 연인, 친구, 적대, 동료, 소속, 위치, 소유, 포함, 관련
```

## 4. 결과 병합 (merger.ts)

### mergeExtractions()

여러 청크의 추출 결과를 하나로 병합합니다.

```typescript
mergeExtractions(extractions: ChunkExtractedData[], chunkSourceFileIndices: number[])
```

#### 병합 규칙

1. **엔티티**: 같은 이름 → 설명 병합, scenes 합집합, aliases 병합
2. **관계**: 같은 (from, type, to) → scenes만 합집합
3. **장면**: 글로벌 번호 부여 (청크별 로컬 → 전체 글로벌)
4. **1인칭 통합**: "나", "나는", "주인공", "화자" → 하나로 통합

### buildKnowledgeGraph()

병합된 결과를 최종 지식 그래프로 변환합니다.

```typescript
buildKnowledgeGraph(extracted, title, model, fileNames, originalText, existingGraph?)
```

#### 처리 순서

1. 기존 그래프가 있으면 엔티티/관계 복사 (추가 분석 시)
2. 기존 ID 최대값 추출 (충돌 방지)
3. 새 엔티티 등록 (같은 이름은 기존 ID 재사용)
4. 새 관계 등록
5. 자동 관계 생성 (description 기반, 동시 등장 기반)
6. 장면 스냅샷 생성
7. 통계 계산

### ID 체계

| 타입 | 형식 | 예시 |
|------|------|------|
| 엔티티 | E0001 | E0001, E0015, E0042 |
| 관계 | H0001 | H0001, H0023 |
| 장면 | S0001 | S0001, S0007 |
| 파일 | F0001 | F0001, F0002 |
| 챕터 | C0001 | C0001, C0002 |

## 5. 후처리

### inferMissingRelationships()

엔티티 설명에서 누락된 관계를 자동 생성합니다.

#### 추론 패턴

1. **소유 관계**: "화자가 피우는 담배" → 화자 -소유→ 담배
2. **위치 관계**: "화자가 걷는 길" → 화자 -위치→ 길
3. **설명 기반**: 설명에 다른 인물 이름 언급 시 관계 생성

### inferCoOccurrenceEdges()

같은 장면에 등장하는 엔티티 간 자동 관계 생성:

- 캐릭터 ↔ 캐릭터: "관련" 타입
- 캐릭터 → location: "위치" 타입
- 캐릭터 → item: "소유" 타입

## 6. 추가 분석 (파일 추가)

기존 그래프에 새 파일을 추가할 때의 동작입니다.

### 핵심 원칙

**LLM 분석은 독립적으로, 병합은 기존 데이터 유지**

```
orchestrator.ts:157
const accumulatedGraph = buildAccumulatedGraph(allExtracted);
// existingGraph를 전달하지 않음 → LLM이 기존 파일 엔티티를 보지 못함
```

### 이유

- 파일 업로드 순서에 따라 결과가 달라지는 것 방지
- 예: 2화 먼저 → 1화 추가 vs 1화만 업로드 → 비슷한 결과

### 병합 시

```typescript
// merger.ts:741-748
if (existingGraph) {
  // 기존 엔티티/관계 복사 (기존 파일 데이터 유지)
  for (const [id, entity] of Object.entries(existingGraph.entities)) {
    entities[id] = { ...entity };
  }
  // ...
}
```

## 7. 오류 처리

### 청크 실패 시

- 타임아웃/API 오류: 스킵하고 계속 진행
- 연속 3회 실패: 분석 중단, 이어하기 가능
- 잔액 부족: 중단, 이어하기 가능

### 이어하기 (Resume)

진행 상황이 localStorage에 저장되어 중단된 지점부터 재개 가능:

```typescript
interface ExtractionProgress {
  title: string;
  totalChunks: number;
  processedChunks: number;
  allExtracted: ChunkExtractedData[];
  knownEntities: KnownEntity[];
  chunks: string[];
  timestamp: number;
  model: string;
  originalText: string;
  fileNames?: string[];
}
```

## 시퀀스 다이어그램

```
User                FileUpload              orchestrator            extractor           merger
 |                      |                        |                      |                  |
 |--upload file-------->|                        |                      |                  |
 |                      |--extractKnowledgeGraph>|                      |                  |
 |                      |                        |--splitIntoChunks---->|                  |
 |                      |                        |                      |                  |
 |                      |                        |  for each chunk:     |                  |
 |                      |                        |--selectEntities----->|                  |
 |                      |                        |<--selectedNames------|                  |
 |                      |                        |--extractFromChunk--->|                  |
 |                      |                        |<--ChunkExtractedData-|                  |
 |                      |                        |                      |                  |
 |                      |                        |--mergeExtractions--------------->|      |
 |                      |                        |<--MergedExtraction----------------|      |
 |                      |                        |--inferMissingRelationships------>|      |
 |                      |                        |--buildKnowledgeGraph------------>|      |
 |                      |                        |<--NovelKnowledgeGraph------------|      |
 |                      |<--knowledgeGraph-------|                      |                  |
 |<--display graph------|                        |                      |                  |
```
