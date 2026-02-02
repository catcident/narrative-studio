# Character Relationship Chart

소설 인물 관계도를 하이퍼그래프 기반 온톨로지로 구축하는 도구입니다.
Story-Forge 프로젝트의 기능 모듈로 사용됩니다.

## 특징

- **하이퍼그래프 구조**: 하나의 관계가 2개 이상의 엔티티를 연결 가능
- **시간축 관리**: 타임라인과 스냅샷으로 시점별 관계 상태 추적
- **설정 일관성 검사**: 새 내용과 기존 설정 간 충돌 감지
- **저렴한 LLM 사용**: Gemini Flash Lite 등 저비용 모델 지원

## 설치

```bash
npm install
```

## 환경 설정

```bash
cp .env.example .env
# .env 파일에 API 키 설정
```

## 사용법

### 1. 하이퍼그래프 모델 테스트 (API 키 불필요)

```bash
npm test
```

### 2. 텍스트에서 온톨로지 추출

```bash
# 환경변수 설정 후
npm run extract example/sample-novel.txt --title "마법사의 여정" --chapter 1
```

### 3. 코드에서 사용

```typescript
import { HyperGraph, ExtractionService, createLLMClient } from 'character-relationship-chart';

// 그래프 생성
const graph = new HyperGraph('나의 소설', '작가명');

// LLM 클라이언트 생성
const llm = createLLMClient();

// 추출 서비스 생성
const extractor = new ExtractionService(graph, llm);

// 텍스트에서 추출
const result = await extractor.extractAndRegister(novelText, {
  title: '나의 소설',
  chapter: 1,
});

// 결과 확인
console.log(result.entities);  // 추출된 엔티티
console.log(result.edges);     // 추출된 관계

// JSON으로 저장
const ontology = graph.toJSON();
fs.writeFileSync('ontology.json', JSON.stringify(ontology, null, 2));
```

## 엔티티 카테고리

| 카테고리 | 설명 |
|---------|------|
| character | 인물 (주인공, 조연, 악역 등) |
| location | 장소 (왕국, 도시, 던전 등) |
| organization | 조직 (길드, 국가, 가문 등) |
| item | 아이템 (무기, 도구, 보물 등) |
| creature | 생물 (동물, 몬스터, 정령 등) |
| event | 사건 (전쟁, 축제, 재해 등) |
| concept | 개념 (마법 체계, 규칙 등) |
| time_period | 시간 (시대, 날짜, 기간 등) |
| status | 상태/직위 |

## 관계 유형

### 인물 관계
- `family`: 가족 관계
- `romantic`: 연인/부부
- `friendship`: 친구/동료
- `rivalry`: 라이벌/적대
- `mentor`: 스승-제자
- `subordinate`: 상하 관계

### 소속/소유
- `belongs_to`: 소속
- `owns`: 소유
- `rules`: 통치/지배

### 위치/시간
- `located_at`: 위치
- `occurred_at`: 발생 장소/시간
- `during`: 기간 동안

### 행위/상태
- `participates`: 참여
- `causes`: 야기
- `transforms`: 변화
- `knows`: 인지
- `has_status`: 상태 보유

## 지원 모델

| 모델 키 | 모델 ID | 비고 |
|--------|---------|------|
| gemini-2.0-flash-lite | google/gemini-2.0-flash-lite-001 | 기본값, 가장 저렴 |
| gemini-flash | google/gemini-2.0-flash-001 | |
| gpt-4o-mini | openai/gpt-4o-mini | |
| claude-haiku | anthropic/claude-3-haiku | |

## 라이선스

MIT
