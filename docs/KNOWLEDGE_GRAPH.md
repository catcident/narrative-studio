# 지식 그래프 구조 (Knowledge Graph Structure)

이 문서는 소설 분석 결과로 생성되는 지식 그래프의 데이터 구조를 설명합니다.

## 전체 구조

```typescript
interface NovelKnowledgeGraph {
  meta: KnowledgeGraphMeta;            // 메타데이터
  entities: Record<string, Entity>;     // 엔티티 (인물, 장소 등)
  hyperedges: Record<string, HyperEdge>; // 관계
  snapshots: Record<string, Snapshot>;   // 장면 스냅샷
  chapters: Record<string, Chapter>;     // 장(Chapter) 정보
}
```

---

## 1. 메타데이터 (Meta)

```typescript
interface KnowledgeGraphMeta {
  title: string;        // 작품 제목
  author?: string;      // 작가
  createdAt: string;    // 생성 시간 (ISO 8601)
  updatedAt: string;    // 수정 시간
  version: number;      // 버전 번호
  stats: {
    entityCount: number;   // 엔티티 수
    edgeCount: number;     // 관계 수
    snapshotCount: number; // 장면 수
    chapterCount: number;  // 장 수
  };
}
```

---

## 2. 엔티티 (Entity)

소설에 등장하는 모든 개체를 표현합니다.

```typescript
interface Entity {
  id: string;              // 고유 ID (예: "E0001")
  name: string;            // 이름 (예: "홍길동")
  aliases: string[];       // 별칭 (예: ["길동이", "의적"])
  category: EntityCategory; // 카테고리
  description: string;     // 설명
  attributes: Record<string, any>; // 추가 속성
  scenes: string[];        // 등장 장면 ID 목록
  firstMention: {
    chapter: number;       // 첫 등장 장
  };
  importance: number;      // 중요도 (1-10)
}
```

### 엔티티 카테고리

| 카테고리 | 설명 | 예시 |
|---------|------|------|
| `character` | 인물 | 주인공, 조연, 악역 |
| `location` | 장소 | 왕국, 도시, 집, 방 |
| `organization` | 조직 | 길드, 회사, 가문, 국가 |
| `item` | 아이템 | 무기, 도구, 보물 |
| `creature` | 생물 | 동물, 몬스터, 정령 |
| `event` | 사건 | 전쟁, 축제, 재해 |
| `concept` | 개념 | 마법 체계, 규칙 |
| `time_period` | 시간 | 시대, 과거 |
| `status` | 상태/직위 | 왕, 기사 |
| `emotion` | 감정 | 사랑, 증오 |

### 인물 속성 예시

```json
{
  "id": "E0001",
  "name": "춘향",
  "aliases": ["춘향이", "성춘향"],
  "category": "character",
  "description": "남원 기생 월매의 딸",
  "attributes": {
    "gender": "여성",
    "age": "16세",
    "occupation": "퇴기의 딸",
    "personality": "정절을 지키는 여인",
    "appearance": "절세미인"
  },
  "scenes": ["S0001", "S0002", "S0003"],
  "firstMention": { "chapter": 1 },
  "importance": 10
}
```

---

## 3. 하이퍼엣지 (HyperEdge)

두 개 이상의 엔티티 간의 관계를 표현합니다.

```typescript
interface HyperEdge {
  id: string;              // 고유 ID (예: "H0001")
  type: RelationType;      // 관계 유형
  subtype?: string;        // 세부 유형
  entities: string[];      // 연결된 엔티티 ID 목록 [from, to]
  statement: string;       // 관계 설명
  timeline?: {
    start?: string;        // 시작 시점
    end?: string;          // 종료 시점
    chapter?: number;      // 관련 장
  };
  sentiment?: Sentiment;   // 감정 (positive/negative/neutral)
  strength?: number;       // 강도 (1-10)
  bidirectional?: boolean; // 쌍방향 여부
  fromPerspective?: string; // from 관점에서의 설명
  toPerspective?: string;   // to 관점에서의 설명
  scenes: string[];        // 등장 장면 ID 목록
  sourceRef: {
    chapter: number;       // 출처 장
  };
}
```

### 관계 유형

#### 인물 관계
| 유형 | 한글 | 설명 |
|------|------|------|
| `family` | 가족 | 부모-자녀, 형제, 친척 |
| `romantic` | 연인 | 연인, 부부, 약혼 |
| `friendship` | 친구 | 친구, 동료 |
| `rivalry` | 적대 | 라이벌, 원수 |
| `mentor` | 스승 | 스승-제자 |
| `subordinate` | 부하 | 상사-부하 |
| `trust` | 신뢰 | 신뢰 관계 |

#### 소속/소유
| 유형 | 한글 | 설명 |
|------|------|------|
| `belongs_to` | 소속 | 조직에 소속 |
| `owns` | 소유 | 아이템/재산 소유 |
| `ownership` | 소유 | 소유 관계 |
| `rules` | 지배 | 통치, 지배 |

#### 위치/시간
| 유형 | 한글 | 설명 |
|------|------|------|
| `located_at` | 위치 | 장소에 위치 |
| `location` | 위치 | 장소 관련 |
| `occurred_at` | 발생 | 사건 발생 장소 |
| `during` | 기간 | 특정 기간 동안 |

#### 기타
| 유형 | 한글 | 설명 |
|------|------|------|
| `related` | 관련 | 일반적 관련 |
| `knows_about` | 인지 | 알고 있음 |
| `participates` | 참여 | 사건에 참여 |
| `causes` | 원인 | 야기함 |
| `transforms` | 변화 | 변화시킴 |

### 감정 (Sentiment)

| 값 | 설명 | 그래프 표시 |
|------|------|------------|
| `positive` | 긍정적 | 실선, 초록 계열 |
| `negative` | 부정적 | 점선, 빨강 계열 |
| `neutral` | 중립 | 짧은 점선, 회색 |
| `complex` | 복합 | 긴-짧은 점선 |

### 관계 예시

```json
{
  "id": "H0001",
  "type": "romantic",
  "subtype": "연인",
  "entities": ["E0001", "E0002"],
  "statement": "춘향과 이몽룡은 서로 사랑하는 연인 관계",
  "timeline": {
    "start": "오월 단오날",
    "chapter": 1
  },
  "sentiment": "positive",
  "strength": 10,
  "bidirectional": true,
  "fromPerspective": "이몽룡을 깊이 사랑함",
  "toPerspective": "춘향에게 백년가약을 맹세함",
  "scenes": ["S0003", "S0004", "S0005"],
  "sourceRef": { "chapter": 1 }
}
```

---

## 4. 스냅샷 (Snapshot)

특정 장면의 상태를 저장합니다.

```typescript
interface Snapshot {
  id: string;              // 고유 ID (예: "S0001")
  sceneNumber: number;     // 장면 번호
  chapterId?: string;      // 장 ID
  time?: string;           // 시간 정보 (예: "다음 날 아침")
  location?: string;       // 장소 (예: "광한루")
  summary?: string;        // 장면 요약
  mood?: string;           // 분위기 (예: "긴장감")
  activeEntities: string[];  // 등장 엔티티 ID 목록
  activeEdges: string[];     // 활성 관계 ID 목록
}
```

### 스냅샷 예시

```json
{
  "id": "S0003",
  "sceneNumber": 3,
  "chapterId": "C0001",
  "time": "오월 단오날",
  "location": "광한루",
  "summary": "이몽룡이 광한루에서 그네 타는 춘향을 처음 만남",
  "mood": "설렘",
  "activeEntities": ["E0001", "E0002", "E0005"],
  "activeEdges": ["H0001", "H0005"]
}
```

---

## 5. 장 (Chapter)

소설의 장(Chapter) 정보를 저장합니다.

```typescript
interface Chapter {
  id: string;           // 고유 ID (예: "C0001")
  number: number;       // 장 번호
  title: string;        // 제목
  summary?: string;     // 요약
}
```

---

## 6. 자동 관계 생성

분석 시 엔티티의 `description`에서 다른 엔티티가 언급되면 자동으로 관계가 생성됩니다.

### 규칙
1. 엔티티 A의 설명에 엔티티 B의 이름/별칭이 포함됨
2. A와 B 사이에 기존 관계가 없음
3. 새 관계 생성:
   - 장소 관련: `location` 타입
   - 아이템 관련: `ownership` 타입
   - 기타: `related` 타입

### 예시
- 엔티티 "광한루" 설명: "이몽룡과 춘향이 처음 만난 곳"
- → 자동으로 "광한루 - 이몽룡" (location), "광한루 - 춘향" (location) 관계 생성

---

## 7. 병합 (Merge)

파일 추가 분석 시 기존 데이터와 새 데이터를 병합합니다.

### 엔티티 병합 규칙
1. 이름 또는 별칭이 일치하면 같은 엔티티로 판단
2. 기존 엔티티 ID 유지
3. 새 장면, 속성 추가

### 관계 병합 규칙
1. 동일한 엔티티 쌍 + 동일한 타입 → 기존 관계 유지
2. 새 관계는 새 ID로 추가
3. 장면 목록 병합

### 장면/장 병합
1. 새 장면은 기존 마지막 장면 이후에 추가
2. 장면 번호 재계산

---

## 8. JSON 예시

```json
{
  "meta": {
    "title": "춘향전",
    "author": "작자미상",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T11:45:00Z",
    "version": 2,
    "stats": {
      "entityCount": 20,
      "edgeCount": 36,
      "snapshotCount": 24,
      "chapterCount": 1
    }
  },
  "entities": {
    "E0001": {
      "id": "E0001",
      "name": "춘향",
      "aliases": ["춘향이", "성춘향"],
      "category": "character",
      "description": "남원 기생 월매의 딸. 이몽룡과 사랑에 빠진다.",
      "attributes": {
        "gender": "여성",
        "age": "16세",
        "occupation": "퇴기의 딸"
      },
      "scenes": ["S0001", "S0002", "S0003"],
      "firstMention": { "chapter": 1 },
      "importance": 10
    }
  },
  "hyperedges": {
    "H0001": {
      "id": "H0001",
      "type": "romantic",
      "entities": ["E0001", "E0002"],
      "statement": "사랑하는 연인 관계",
      "sentiment": "positive",
      "strength": 10,
      "bidirectional": true,
      "scenes": ["S0003", "S0004"],
      "sourceRef": { "chapter": 1 }
    }
  },
  "snapshots": {
    "S0001": {
      "id": "S0001",
      "sceneNumber": 1,
      "time": "숙종대왕 즉위 초년",
      "location": "남원부",
      "summary": "월매가 춘향을 낳음",
      "activeEntities": ["E0001", "E0003"],
      "activeEdges": ["H0005"]
    }
  },
  "chapters": {
    "C0001": {
      "id": "C0001",
      "number": 1,
      "title": "제1장",
      "summary": "춘향과 이몽룡의 만남"
    }
  }
}
```
