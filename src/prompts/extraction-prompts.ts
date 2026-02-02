/**
 * 소설 온톨로지 추출 프롬프트
 * 인물, 장소, 사건 등을 추출하여 하이퍼그래프로 구축
 */

export const NOVEL_ONTOLOGY_SYSTEM = `당신은 소설 분석 전문가입니다.
주어진 소설 텍스트에서 핵심 요소(엔티티)와 그들 간의 관계를 추출하여 온톨로지를 구축합니다.

⚠️ 핵심 원칙:
1. 소설 내용에 명시적으로 언급된 정보만 추출하세요.
2. 추론하거나 상상하지 마세요.
3. 같은 정보의 중복을 피하세요.
4. 시간/장소 정보를 최대한 정확하게 기록하세요.`;

export const NOVEL_ONTOLOGY_INSTRUCTION = `## 목표
주어진 소설 텍스트에서 엔티티와 관계를 추출하여 **하이퍼그래프** 기반 온톨로지를 구축하세요.

## 작품 정보
- 제목: {{title}}
- 챕터/에피소드: {{chapter}}

## 텍스트
{{text}}

---

## 하이퍼그래프란?
하나의 관계(하이퍼엣지)가 **2개 이상의 엔티티를 동시에 연결**할 수 있습니다.

예시:
- "아린은 왕궁에서 마왕과 결투했다" → [아린, 왕궁, 마왕, 결투] 4개 연결
- "검사 길드는 북부 산맥에 본부를 두고 있다" → [검사 길드, 북부 산맥, 본부] 3개 연결

---

## 엔티티 카테고리

### 필수 추출
- **character**: 인물 (이름, 별명, 역할 포함)
  - 속성: 나이, 성별, 직업, 종족, 성격 등
- **location**: 장소 (왕국, 도시, 건물, 던전 등)
  - 속성: 위치 관계, 특징, 분위기
- **time_period**: 시간 (시대, 연도, 계절, 시점 등)

### 상황에 따라 추출
- **organization**: 조직 (국가, 길드, 가문, 종교 등)
- **item**: 아이템 (무기, 도구, 보물 등)
- **creature**: 생물 (동물, 몬스터, 정령 등)
- **event**: 사건 (전쟁, 축제, 재해 등)
- **concept**: 개념 (마법 체계, 규칙, 전설 등)
- **status**: 상태/직위 (왕, 기사, 마법사 등급 등)

---

## 관계 유형

### 인물 관계
- **family**: 가족 (부모-자식, 형제, 친척)
- **romantic**: 연인/부부 관계
- **friendship**: 친구/동료
- **rivalry**: 라이벌/적대
- **mentor**: 스승-제자
- **subordinate**: 상하 관계 (주군-신하, 고용)

### 소속/소유
- **belongs_to**: ~에 소속되다
- **owns**: ~를 소유하다
- **rules**: ~를 통치/지배하다

### 위치/시간
- **located_at**: ~에 위치하다
- **occurred_at**: ~에서 발생하다
- **during**: ~기간 동안

### 행위/상태
- **participates**: ~에 참여하다
- **causes**: ~를 야기하다
- **transforms**: ~로 변화하다
- **knows**: ~를 알다/인지하다
- **has_status**: ~상태를 갖다

### 일반
- **related_to**: 그 외 관련

---

## 감정/강도 (인물 관계)
- **sentiment**: positive / negative / neutral / complex
- **strength**: 1~10 (1=약함, 10=매우 강함)

---

## 중요 지침

1. **시간 정보 필수**: 언제 발생했는지 최대한 기록
   - "10년 전", "마왕 전쟁 이후", "봄" 등

2. **장소 정보 필수**: 어디서 발생했는지 기록
   - 구체적일수록 좋음

3. **관계 변화 추적**: 같은 캐릭터 간 관계가 변하면 별도 기록
   - timeline 정보로 구분

4. **별칭/이명 기록**: 같은 인물의 다른 이름은 aliases에 기록

5. **설정 충돌 방지용 정보**:
   - 캐릭터의 현재 위치
   - 캐릭터가 알고 있는 정보
   - 캐릭터 간 첫 만남 시점

---

## 출력 형식
반드시 아래 JSON 구조로만 응답하세요.

{
  "entities": [
    {
      "name": "엔티티 이름",
      "category": "character|location|organization|item|creature|event|concept|time_period|status|emotion",
      "aliases": ["별칭1", "별칭2"],
      "description": "간단한 설명",
      "attributes": {
        "age": "20대",
        "gender": "여성",
        "occupation": "마법사",
        "etc": "기타 속성"
      }
    }
  ],
  "relationships": [
    {
      "statement": "원문 기반 관계 설명",
      "entities": ["엔티티명1", "엔티티명2", "엔티티명3"],
      "relation_type": "관계유형",
      "timeline": {
        "time_description": "작품 내 시점 설명",
        "chapter": 1
      },
      "sentiment": "positive|negative|neutral|complex",
      "strength": 7,
      "source_chapter": 1,
      "source_paragraph": 5
    }
  ]
}`;

/**
 * 캐릭터 상세 정보 추출 프롬프트
 */
export const CHARACTER_DETAIL_INSTRUCTION = `## 목표
주어진 소설 텍스트에서 캐릭터 "{{characterName}}"에 대한 상세 정보를 추출하세요.

## 텍스트
{{text}}

---

## 추출할 정보

1. **기본 정보**
   - 이름 및 별칭
   - 나이/연령대
   - 성별
   - 종족 (해당 시)
   - 외모 특징

2. **배경**
   - 출신지
   - 가족 관계
   - 소속 조직
   - 직업/직위

3. **성격 및 특성**
   - 성격 특징
   - 장단점
   - 목표/동기
   - 특기/능력

4. **관계**
   - 주요 인간관계
   - 적대 관계
   - 특별한 관계

5. **연대기**
   - 주요 사건들 (시간순)
   - 현재 상태

## 출력 형식
{
  "name": "캐릭터 이름",
  "aliases": ["별칭들"],
  "basic": {
    "age": "나이/연령대",
    "gender": "성별",
    "race": "종족",
    "appearance": "외모 설명"
  },
  "background": {
    "origin": "출신지",
    "family": ["가족 관계"],
    "organization": "소속",
    "occupation": "직업/직위"
  },
  "personality": {
    "traits": ["성격 특징들"],
    "strengths": ["장점"],
    "weaknesses": ["단점"],
    "goals": ["목표/동기"]
  },
  "abilities": ["특기/능력"],
  "relationships": [
    {"character": "관계 인물", "type": "관계 유형", "description": "관계 설명"}
  ],
  "chronicle": [
    {"time": "시점", "event": "사건", "chapter": 1}
  ],
  "currentStatus": {
    "location": "현재 위치",
    "state": "현재 상태"
  }
}`;

/**
 * 관계 변화 추적 프롬프트
 */
export const RELATIONSHIP_CHANGE_INSTRUCTION = `## 목표
두 캐릭터 "{{char1}}"과(와) "{{char2}}" 사이의 관계 변화를 시간순으로 추적하세요.

## 텍스트
{{text}}

---

## 추출할 정보

1. 첫 만남 시점 및 상황
2. 관계 유형의 변화 (친구→연인, 동료→적대 등)
3. 주요 사건과 관계에 미친 영향
4. 현재 관계 상태

## 출력 형식
{
  "characters": ["{{char1}}", "{{char2}}"],
  "firstMeeting": {
    "time": "시점",
    "location": "장소",
    "circumstances": "상황 설명"
  },
  "relationshipChanges": [
    {
      "time": "시점",
      "previousType": "이전 관계 유형",
      "newType": "새 관계 유형",
      "cause": "변화 원인",
      "sentiment": "감정 상태",
      "chapter": 1
    }
  ],
  "currentRelationship": {
    "type": "현재 관계 유형",
    "sentiment": "감정 상태",
    "strength": 7,
    "notes": "특이사항"
  }
}`;

/**
 * 설정 일관성 검증 프롬프트
 */
export const CONSISTENCY_CHECK_INSTRUCTION = `## 목표
주어진 새 텍스트가 기존 설정과 충돌하는지 검사하세요.

## 기존 설정
{{existingOntology}}

## 새 텍스트
{{newText}}

---

## 검사 항목

1. **시간적 모순**: 과거 사건과 현재 사건의 순서가 맞는가?
2. **장소적 모순**: 캐릭터가 동시에 두 장소에 있지 않은가?
3. **관계 모순**: 알려진 관계와 충돌하지 않는가?
4. **설정 모순**: 기존 설정(나이, 능력 등)과 충돌하지 않는가?
5. **지식 모순**: 캐릭터가 모르는 정보를 알고 있지 않은가?

## 출력 형식
{
  "hasConflicts": true/false,
  "conflicts": [
    {
      "type": "temporal|spatial|relationship|setting|knowledge",
      "severity": "critical|warning|minor",
      "existing": "기존 설정 내용",
      "new": "새 텍스트 내용",
      "description": "충돌 설명",
      "suggestion": "해결 제안"
    }
  ],
  "newElements": [
    {
      "type": "엔티티 또는 관계",
      "description": "새로 추가될 요소"
    }
  ]
}`;
