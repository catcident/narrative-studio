# 파일 검증 기능

소설 파일들 간의 일관성을 검증하는 기능입니다.

## 파일 구조

```
web/src/
├── services/validation.ts         # 검증 서비스
├── components/SourceTextView.tsx  # 검증 UI
├── store.ts                       # 검증 상태 관리
└── types.ts                       # 검증 타입 정의
```

## 1. 개요

- 각 파일의 추출된 그래프를 이전 파일들과 비교
- 세계관, 캐릭터, 시간축 등의 일관성 검증
- 시각적 상태 표시 (녹색/빨간색/노란색)
- 의존성 체인 관리 (이전 파일 실패 시 이후 파일 재검증 필요)

## 2. 검증 상태

| 상태 | 아이콘 | 색상 | 설명 |
|------|--------|------|------|
| `pending` | ShieldQuestion | 회색 | 검증 대기 중 |
| `validating` | Loader2 | 파란색 | 검증 진행 중 |
| `passed` | ShieldCheck | 녹색 | 검증 통과 |
| `failed` | ShieldAlert | 빨간색 | 검증 실패 (이슈 발견) |
| `invalidated` | AlertTriangle | 노란색 | 이전 파일 실패로 재검증 필요 |

## 3. 검증 규칙

### 첫 번째 파일
- 비교 대상이 없으므로 항상 `passed`
- 기준 파일로 사용됨

### N번째 파일 (N > 1)
- 파일 1 ~ (N-1)과 비교
- 다음 항목들을 검증:
  1. **캐릭터 일관성**: 성격, 외모, 능력, 배경
  2. **세계관 일관성**: 마법 체계, 사회 구조, 역사
  3. **시간축 일관성**: 사건 순서, 시간 경과
  4. **장소 일관성**: 지명, 위치 관계
  5. **관계 일관성**: 캐릭터 간 관계
  6. **아이템 일관성**: 아이템 특성, 위치

## 4. 의존성 체인

```
파일 1 (passed) → 파일 2 (failed) → 파일 3 (invalidated) → 파일 4 (invalidated)
```

- 파일 2가 실패하면, 파일 3, 4는 자동으로 `invalidated` 상태
- 파일 2를 수정 후 다시 검증하면 파일 3, 4도 재검증 필요

## 5. 타입 정의

### ValidationStatus

```typescript
type ValidationStatus = 'pending' | 'validating' | 'passed' | 'failed' | 'invalidated';
```

### ValidationIssue

```typescript
interface ValidationIssue {
  id: string;
  type: ValidationIssueType;
  severity: 'error' | 'warning';
  description: string;
  entityIds?: string[];
  sceneIds?: string[];
  previousFileId?: string;
  suggestion?: string;
}
```

### FileValidationResult

```typescript
interface FileValidationResult {
  fileId: string;
  status: ValidationStatus;
  validatedAt: string | null;
  issues: ValidationIssue[];
  comparedWith: string[];  // 비교한 파일 ID 목록
}
```

## 6. 서비스 API

### validateFile(graph, fileId, context)

단일 파일 검증

```typescript
const result = await validateFile(knowledgeGraph, 'F0002', {
  apiKey: 'sk-...',
  model: 'google/gemini-2.0-flash-001',
  onProgress: (fileId, status) => console.log(fileId, status),
});
// result: FileValidationResult
```

### validateAllFiles(graph, context)

모든 파일 순차 검증

```typescript
const results = await validateAllFiles(knowledgeGraph, context);
// results: Map<string, FileValidationResult>
```

### invalidateFilesAfter(results, sourceFiles, failedFileId)

특정 파일 이후의 모든 파일을 `invalidated`로 설정

```typescript
const newResults = invalidateFilesAfter(currentResults, sourceFiles, 'F0002');
```

## 7. 스토어 상태

```typescript
interface AppState {
  // 검증 관련
  validationResults: Map<string, FileValidationResult>;
  isValidating: boolean;
  validatingFileId: string | null;

  // 액션
  setValidationResults: (results: Map<string, FileValidationResult>) => void;
  updateValidationResult: (fileId: string, result: FileValidationResult) => void;
  setIsValidating: (isValidating: boolean) => void;
  setValidatingFileId: (fileId: string | null) => void;
  clearValidationResults: () => void;
}
```

## 8. UI 동작

### 검증 시작
1. 파일 헤더의 방패 아이콘 클릭
2. API 키 확인 (없으면 경고)
3. LLM 호출하여 검증 수행
4. 결과에 따라 아이콘 업데이트

### 이슈 보기
1. 빨간색 방패 아이콘 클릭
2. 파일 아래에 이슈 목록 표시
3. 각 이슈의 심각도, 타입, 설명, 제안 표시

### 재검증
- 녹색 아이콘 클릭: 다시 검증
- 노란색 아이콘 클릭: 재검증 필요한 파일 검증

## 9. LLM 프롬프트

### 시스템 프롬프트
```
당신은 소설의 일관성을 검증하는 전문가입니다.
이전 파일들의 설정과 현재 파일의 설정을 비교하여 불일치나 오류를 찾아주세요.
...
```

### 응답 형식
```json
{
  "issues": [
    {
      "type": "character_inconsistency",
      "severity": "error",
      "description": "김철수의 나이가 1화에서는 25세, 2화에서는 30세로 불일치",
      "suggestion": "1화의 25세로 통일"
    }
  ]
}
```

## 10. 파일 관리 연동

### 파일 삭제 시
- 해당 파일의 검증 결과 제거
- 파일 ID 재매핑 적용

### 파일 순서 변경 시
- 모든 검증 결과 초기화 (첫 파일만 passed)
- 전체 재검증 필요

## 11. 시퀀스 다이어그램

```
User        SourceTextView     validation.ts      /api/chat        LLM
 |               |                  |                 |              |
 |--검증 클릭--->|                  |                 |              |
 |               |--validateFile-->|                 |              |
 |               |                  |--프롬프트 생성--|              |
 |               |                  |--POST--------->|              |
 |               |                  |                 |--분석 요청-->|
 |               |                  |                 |<--JSON 응답--|
 |               |                  |<--이슈 파싱----|              |
 |               |<--결과 반환-----|                 |              |
 |               |--스토어 업데이트-|                 |              |
 |<--UI 업데이트-|                  |                 |              |
```

## 12. 주의사항

1. **API 키 필요**: 검증에는 LLM API 호출이 필요합니다
2. **비용 발생**: 파일당 API 호출 비용 발생
3. **순차 검증**: 파일 N은 항상 1~(N-1)과 비교
4. **상태 영속성**: 현재는 세션 중에만 유지 (새로고침 시 초기화)
