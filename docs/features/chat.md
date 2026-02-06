# 소설 채팅 기능

분석된 소설에 대해 AI와 대화하는 기능입니다.

## 파일 구조

```
web/src/
├── components/ChatView.tsx    # 채팅 UI 컴포넌트
└── services/chat.ts           # 채팅 서비스 로직
```

## 1. 아키텍처

```
사용자 질문 → 의도 분석 → 데이터 검색 → 선별 → 컨텍스트 생성 → LLM 응답
```

### 처리 파이프라인

```
[1단계] LLM 의도 분석
    ↓
[2단계] 데이터 수집 (엔티티 + 청크)
    ↓
[3단계] LLM 선별 (필요한 것만)
    ↓
[4단계] 컨텍스트 생성
    ↓
[5단계] 스트리밍 응답
```

## 2. 의도 분석 (analyzeQueryWithLLM)

사용자 질문을 분석하여 검색 전략을 결정합니다.

### 분석 결과

```typescript
interface LLMQueryAnalysis {
  keywords: string[];           // 검색 키워드 (최대 5개)
  wantsCategoryList: boolean;   // 카테고리 전체 목록 요청 여부
  targetCategory: string | null; // 요청된 카테고리
}
```

### 예시

| 질문 | 분석 결과 |
|------|-----------|
| "아이템 뭐있어?" | `{ keywords: [], wantsCategoryList: true, targetCategory: "item" }` |
| "김철수가 누구야?" | `{ keywords: ["김철수"], wantsCategoryList: false, targetCategory: null }` |
| "주인공이 얻은 검이 뭐야?" | `{ keywords: ["주인공", "검"], wantsCategoryList: false, targetCategory: null }` |

### 폴백

LLM 분석 실패 시 `fallbackExtractKeywords()`로 단순 키워드 추출:
- 불용어 제거 ("뭐", "는", "해줘" 등)
- 2글자 이상 단어만 추출
- 최대 5개

## 3. 데이터 수집

### 엔티티 검색

```typescript
// 1. 카테고리 전체 목록 요청
if (queryAnalysis.wantsCategoryList && queryAnalysis.targetCategory) {
  // 해당 카테고리의 모든 엔티티 ID
}

// 2. 키워드 기반 직접 매칭
const directMatches = findMentionedEntityIds(keywords, entities);

// 3. 임베딩 검색 (graphId가 있으면)
const entityResults = await searchSimilarEntities(graphId, keywords, apiKey, 10);
```

### 청크 검색

```typescript
// 임베딩 기반 원본 텍스트 검색
const chunkResults = await searchSimilarChunks(graphId, query, apiKey, 3);
```

### 키워드 확장 (동의어)

```typescript
const SYNONYM_MAP = {
  '박스': ['상자', '박스', '골판지'],
  '집': ['집', '거처', '잠자리', '보금자리'],
  '칼': ['칼', '검', '도검', '무기'],
  // ...
};
```

## 4. LLM 선별 (selectRelevantData)

수집된 데이터가 많으면 LLM으로 필요한 것만 선별합니다.

### 선별 조건

```typescript
if (entities.length > 10 || chunks.length > 3) {
  // LLM 선별 수행
}
```

### 선별 결과

```typescript
interface SelectionResult {
  selectedEntityIds: string[];      // 최대 15개
  selectedChunkIndices: number[];   // 최대 3개
}
```

## 5. 컨텍스트 생성

### extractRelevantContext()

질문에서 언급된 엔티티와 관계를 추출합니다.

#### 포함 내용

1. **언급된 엔티티 정보**
   - 이름, 카테고리, 설명, 별칭

2. **직접 관계** (가장 중요)
   - 언급된 엔티티들 간의 관계

3. **연결된 다른 관계**
   - 언급된 엔티티와 연결된 모든 관계

4. **키워드 관련 추가 정보**
   - hyperedge statement에서 키워드 검색

5. **관련 장면**
   - 언급된 엔티티가 등장하는 장면

6. **원본 텍스트 발췌**
   - 임베딩 검색 결과 또는 키워드 매칭

### buildSystemPrompt()

시스템 프롬프트를 동적으로 생성합니다.

#### 시나리오별 처리

| 시나리오 | 처리 |
|----------|------|
| 카테고리 목록 요청 | 해당 카테고리 엔티티 전체 (최대 40개) |
| 전체 요약 요청 | 카테고리별 엔티티 요약 + 주요 관계 |
| 특정 엔티티 검색 | 찾은 엔티티 상세 + 관련 관계 |
| 검색 결과 없음 | 주요 등장인물만 표시 |

## 6. 대화 세션 관리

### 세션 구조

```typescript
interface ChatSession {
  id: string;           // "session_1234567890_abc123"
  graphId: string;      // 연결된 그래프 ID
  title: string;        // "대화 2024. 1. 15 10:30"
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;      // 첫 메시지 미리보기
}
```

### 저장소

```
localStorage
├── chat_sessions                    # 세션 목록
└── chat_messages_{sessionId}        # 세션별 메시지
```

### 주요 함수

| 함수 | 설명 |
|------|------|
| `getChatSessions()` | 전체 세션 목록 |
| `getSessionsForGraph(graphId)` | 특정 그래프의 세션 |
| `createSession(graphId, title)` | 새 세션 생성 |
| `updateSession(sessionId, messages)` | 세션 업데이트 |
| `deleteSession(sessionId)` | 세션 삭제 |

## 7. UI 컴포넌트 (ChatView)

### 상태

```typescript
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [input, setInput] = useState('');
const [isLoading, setIsLoading] = useState(false);
const [streamingContent, setStreamingContent] = useState('');
const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
const [showHistoryPanel, setShowHistoryPanel] = useState(false);
const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
```

### 기능

1. **메시지 전송**
   - Enter: 전송
   - Shift+Enter: 줄바꿈

2. **스트리밍 응답**
   - 타이핑 효과로 답변 표시
   - 깜빡이는 커서 애니메이션

3. **모델 선택**
   - 드롭다운으로 LLM 모델 변경

4. **대화 기록**
   - 세션 목록 표시
   - 세션 전환/삭제
   - 새 대화 시작

5. **대화 초기화**
   - ConfirmDialog로 확인 후 삭제

### 추천 질문

빈 대화 화면에서 제안:
- "주인공은 누구야?"
- "등장인물들 관계 설명해줘"
- "이 소설의 주제는 뭐야?"
- "가장 중요한 장면은?"

## 8. API

### POST /api/chat

```typescript
{
  model: string;          // LLM 모델 ID
  messages: Message[];    // 대화 히스토리
  apiKey?: string;        // 사용자 API 키 (BYOK)
  stream?: boolean;       // 스트리밍 여부 (기본: true)
}
```

### 응답 (스트리밍)

```
data: {"choices":[{"delta":{"content":"안녕"}}]}
data: {"choices":[{"delta":{"content":"하세요"}}]}
data: [DONE]
```

## 9. 엔티티 하이라이트

### extractMentionedEntities()

AI 답변에서 언급된 엔티티를 추출하여 그래프에서 하이라이트합니다.

```typescript
// 답변에서 언급된 엔티티 추출
const mentionedIds = extractMentionedEntities(response, knowledgeGraph.entities);

// store에 저장 → 그래프 뷰에서 하이라이트
setChatMentionedEntities(mentionedIds);
```

### 매칭 방식

1. 엔티티 이름이 답변에 포함
2. 엔티티 별칭이 답변에 포함

## 10. 의도 감지 (detectQueryIntent)

로컬 폴백용 의도 분석입니다.

### 감지 항목

| 항목 | 키워드 |
|------|--------|
| `wantsCharacters` | 등장인물, 인물, 캐릭터, 주인공 |
| `wantsItems` | 아이템, 물건, 무기, 장비 |
| `wantsLocations` | 장소, 지역, 위치, 마을 |
| `wantsRelationships` | 관계, 사이, 어떤 관계 |
| `wantsSummary` | 요약, 줄거리, 내용 |
| `wantsCategoryList` | 뭐있어, 목록, 전부 |

## 11. 시퀀스 다이어그램

```
User        ChatView        chat.ts         API          LLM
 |              |               |             |            |
 |--질문입력--->|               |             |            |
 |              |--handleSend-->|             |            |
 |              |               |--의도분석--->|--LLM호출-->|
 |              |               |<--keywords--|<-----------|
 |              |               |             |            |
 |              |               |--임베딩검색->|            |
 |              |               |<--결과------|            |
 |              |               |             |            |
 |              |               |--선별요청--->|--LLM호출-->|
 |              |               |<--선별결과--|<-----------|
 |              |               |             |            |
 |              |               |--컨텍스트+질문->|--LLM--->|
 |              |<--스트리밍----|<--스트리밍---|<--응답----|
 |<--UI업데이트-|               |             |            |
```
