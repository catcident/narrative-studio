# 지식 그래프 구조

소설 분석 결과를 저장하는 데이터 구조입니다.

## 파일 위치

```
web/src/types.ts    # 타입 정의
```

## 전체 구조

```typescript
interface NovelKnowledgeGraph {
  metadata: Metadata;
  entities: Record<string, Entity>;
  hyperedges: Record<string, HyperEdge>;
  chapters?: Record<string, Chapter>;
  timeline: TimelinePoint[];
  snapshots: Record<string, SceneSnapshot>;
  stats: Stats;
}
```

## 1. 메타데이터 (metadata)

```typescript
interface Metadata {
  id?: string;           // 저장 후 할당되는 고유 ID
  title: string;         // 소설 제목
  author?: string;       // 저자
  createdAt: string;     // ISO 타임스탬프
  updatedAt: string;     // ISO 타임스탬프
  version: string;       // 스키마 버전
  model?: string;        // 분석에 사용된 LLM 모델 ID
  sourceFiles?: SourceFile[];  // 업로드된 파일 목록
}
```

### SourceFile (업로드 파일)

```typescript
interface SourceFile {
  id: string;           // "F0001" 형식
  fileName: string;     // "01화.md"
  uploadedAt: string;   // ISO 타임스탬프
  text: string;         // 원본 텍스트
  charCount: number;    // 문자 수
}
```

## 2. 엔티티 (entities)

소설에 등장하는 인물, 장소, 물건 등입니다.

```typescript
interface Entity {
  id: string;              // "E0001" 형식
  name: string;            // 이름
  aliases?: string[];      // 별명 목록
  category: EntityCategory;
  description?: string;    // 설명
  attributes?: Record<string, any>;
  firstMention?: SourceRef;
  mentions?: SourceRef[];
  scenes?: string[];       // 등장 장면 ID 목록 ["S0001", "S0003"]
  importance?: number;     // 중요도 1~10
  sourceFile?: string;     // 처음 등장한 파일명
}
```

### 엔티티 카테고리

| 카테고리 | 설명 | 예시 |
|----------|------|------|
| `character` | 대화/행동하는 존재 | 나, 검은 고양이, 노인 |
| `location` | 공간/장소 | 골목, 집, 방, 공원 |
| `item` | 물건/도구 | 쓰레기통, 박스, 음식 |
| `organization` | 단체/조직 | 회사, 학교, 마을 |
| `creature` | 생물체 (character 아닌) | 괴물, 동물 떼 |
| `event` | 사건 | 전쟁, 축제, 사고 |
| `concept` | 추상적 개념 | 세계관 설정, 시간의 역전 |
| `time_period` | 시대/기간 | 조선시대, 2차 대전 |
| `status` | 상태 | 부상, 실종 |
| `emotion` | 감정 | 분노, 슬픔 |

## 3. 관계 (hyperedges)

엔티티 간의 관계입니다.

```typescript
interface HyperEdge {
  id: string;              // "H0001" 형식
  type: RelationType;      // 관계 타입
  entities: string[];      // 연결된 엔티티 ID ["E0001", "E0002"]
  statement: string;       // 관계 설명
  quote?: string;          // 원문 인용
  subtype?: string;        // 세부 타입
  bidirectional?: boolean; // 양방향 여부
  fromPerspective?: string;
  toPerspective?: string;
  timeline?: {
    start?: string;
    end?: string;
    chapter?: number;
  };
  sentiment?: 'positive' | 'negative' | 'neutral' | 'complex';
  strength?: number;       // 관계 강도
  sourceRef?: SourceRef;
  scenes?: string[];       // 등장 장면 ID 목록
  sourceFile?: string;     // 관계가 발생한 파일명
}
```

### 관계 타입

| 한글 | 영어 (하위호환) | 설명 |
|------|----------------|------|
| `가족` | `family` | 혈연/입양 관계 |
| `연인` | `romantic` | 연애 관계 |
| `친구` | `friendship` | 우정 관계 |
| `적대` | `rivalry` | 적대적 관계 |
| `동료` | `subordinate` | 협력 관계 |
| `주인` | `mentor` | 주종 관계 |
| `위치` | `located_at` | 공간적 위치 |
| `소유` | `owns` | 소유 관계 |
| `소속` | `belongs_to` | 소속 관계 |
| `포함` | `rules` | 포함 관계 |
| `관련` | `related_to` | 기타 관련 |

## 4. 장면 (snapshots)

스토리의 시간순 장면입니다.

```typescript
interface SceneSnapshot {
  sceneId: string;         // "S0001" 형식
  order: number;           // 서술 순서 (1, 2, 3...)
  chapter: string | null;  // 챕터 제목
  chapterNumber: number | null;
  time: string;            // 시간대 설명
  timeMarker: string | null;  // 명시된 시간 표현 ("10년 전", "다음 날")
  location: string;        // 장소
  summary: string;         // 장면 요약
  events: string[];        // 주요 이벤트 목록
  mood?: string;           // 분위기
  charactersPresent: string[];  // 등장 인물 이름 목록
  activeEdges: string[];   // 활성 관계 ID 목록
  sourceFile?: string;     // 원본 파일명
  sourceFileId?: string;   // 원본 파일 ID ("F0001")
}
```

### 장면 순서 (order)

- 텍스트에 나온 순서대로 1부터 부여
- 파일이 여러 개면 파일 순서대로 이어짐
- 예: 파일1(장면 1-4) → 파일2(장면 5-8)

### timeMarker vs time

| 필드 | 설명 | 예시 |
|------|------|------|
| `time` | LLM이 추론한 시간대 | "저녁", "과거" |
| `timeMarker` | 텍스트에 명시된 표현 | "10년 전", "다음 날 아침" |

`timeMarker`는 회상/플래시백 감지에 사용됩니다.

## 5. 챕터 (chapters)

소설의 장/화 구조입니다.

```typescript
interface Chapter {
  id: string;        // "C0001" 형식
  number: number;    // 챕터 번호
  title: string;     // 챕터 제목
  summary?: string;  // 챕터 요약
}
```

## 6. 통계 (stats)

```typescript
interface Stats {
  totalEntities: number;
  totalEdges: number;
  totalChapters?: number;
  entitiesByCategory: Record<EntityCategory, number>;
  edgesByType: Record<RelationType, number>;
}
```

## 7. ID 체계

| 타입 | 접두사 | 형식 | 예시 |
|------|--------|------|------|
| 엔티티 | E | E0001 | E0001, E0015, E0042 |
| 관계 | H | H0001 | H0001, H0023 |
| 장면 | S | S0001 | S0001, S0007 |
| 파일 | F | F0001 | F0001, F0002 |
| 챕터 | C | C0001 | C0001, C0002 |

### ID 생성 규칙

```typescript
// merger.ts
const generateId = (prefix: string, num: number) =>
  `${prefix}${String(num).padStart(4, '0')}`;
```

- 새 엔티티/관계 추가 시 기존 최대 ID + 1
- 파일 삭제 시 파일 ID만 재정렬 (엔티티/관계 ID는 유지)

## 8. 데이터 예시

```json
{
  "metadata": {
    "title": "나의 소설",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:35:00Z",
    "version": "1.0",
    "model": "google/gemini-2.0-flash-001",
    "sourceFiles": [
      {
        "id": "F0001",
        "fileName": "1화.md",
        "uploadedAt": "2024-01-15T10:30:00Z",
        "text": "어느 날 철수는...",
        "charCount": 5000
      }
    ]
  },
  "entities": {
    "E0001": {
      "id": "E0001",
      "name": "철수",
      "category": "character",
      "description": "주인공. 20대 남성.",
      "scenes": ["S0001", "S0002"],
      "importance": 10
    },
    "E0002": {
      "id": "E0002",
      "name": "영희",
      "category": "character",
      "description": "철수의 친구.",
      "scenes": ["S0002"],
      "importance": 7
    }
  },
  "hyperedges": {
    "H0001": {
      "id": "H0001",
      "type": "친구",
      "entities": ["E0001", "E0002"],
      "statement": "철수와 영희는 어릴 때부터 친구",
      "scenes": ["S0002"],
      "sentiment": "positive"
    }
  },
  "snapshots": {
    "S0001": {
      "sceneId": "S0001",
      "order": 1,
      "chapter": "1화",
      "chapterNumber": 1,
      "time": "아침",
      "timeMarker": null,
      "location": "철수의 방",
      "summary": "철수가 아침에 일어난다",
      "events": ["기상"],
      "charactersPresent": ["철수"],
      "activeEdges": [],
      "sourceFileId": "F0001"
    }
  },
  "stats": {
    "totalEntities": 2,
    "totalEdges": 1,
    "entitiesByCategory": { "character": 2 },
    "edgesByType": { "친구": 1 }
  }
}
```

## 9. 저장 위치

### 서버 (MongoDB)

```
knowledge_graphs 컬렉션
└── userId: string
└── data: NovelKnowledgeGraph
└── versions: Version[]  // 버전 히스토리
```

### 로컬 (IndexedDB)

```
knowledge-graphs 스토어
└── id: string (kg_ 접두사)
└── data: NovelKnowledgeGraph
```

서버 저장 실패 시 로컬에 자동 폴백됩니다.
