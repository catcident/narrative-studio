# StoryGraph 스토리지 감사 보고서

> 작성일: 2026-02-09
> 대상: narrative-studio (MongoDB + Docker volumes)

## 요약

Oracle Cloud Free Tier (47GB 디스크) 환경에서 MongoDB 데이터 무한 증가를 방지하기 위한 감사.
주요 조치 완료 후 잔여 리스크와 향후 권장사항을 정리한다.

---

## 1. 완료된 조치 (2026-02-09)

### 1-1. 그래프 삭제 시 cascading delete

**파일**: `web/src/app/api/knowledge-graphs/[id]/route.ts`

그래프 삭제 시 3개 연관 컬렉션을 병렬 삭제:
- `knowledgeGraphVersions` (버전 히스토리)
- `entityEmbeddings` (엔티티 임베딩)
- `chunkEmbeddings` (청크 임베딩)

fail-safe: cascade 실패해도 primary delete 성공 응답 유지.

### 1-2. 익명/폴백 사용자 하드 리밋

**파일**: `web/src/app/api/knowledge-graphs/route.ts`

billing 서비스 미응답 또는 익명 사용자일 때 기본 제한:
- `DEFAULT_MAX_SAVED_GRAPHS = 3` (그래프 수)
- `DEFAULT_MAX_VERSIONS = 3` (버전 히스토리 수, FIFO)

유료 사용자는 플랜 features에서 값을 받으므로 영향 없음.

### 1-3. 소설 크기/수량 제한

**파일**: `web/src/app/api/novels/route.ts`

- `MAX_NOVEL_TEXT_LENGTH = 5,000,000` (500만 자)
- `MAX_NOVELS_PER_USER = 20` (사용자당 소설 수)

---

## 2. MongoDB 컬렉션별 상태

### 정상 관리됨 (OK)

| 컬렉션 | 증가 방식 | 제어 메커니즘 |
|--------|----------|-------------|
| `knowledgeGraphs` | 사용자 저장 | `max_saved_graphs` (플랜) / `DEFAULT_MAX_SAVED_GRAPHS=5` (폴백) |
| `knowledgeGraphVersions` | 저장 시 이전 버전 보관 | `max_versions` (플랜) / `DEFAULT_MAX_VERSIONS=10` (폴백), FIFO 삭제 |
| `novels` | 사용자 업로드 | `MAX_NOVELS_PER_USER=20`, `MAX_NOVEL_TEXT_LENGTH=5M자` |
| `entityEmbeddings` | 분석 시 생성 | 그래프 삭제 시 cascade, `deleteMany` 호출로 재분석 시 교체 |
| `chunkEmbeddings` | 분석 시 생성 | 그래프 삭제 시 cascade, `deleteMany` 호출로 재분석 시 교체 |

### 1-4. 버전 히스토리 sourceFiles 텍스트 제거 (2026-02-09)

**파일**: `web/src/lib/versionHistory.ts` (공유 헬퍼)

버전 히스토리 저장 시 `data.metadata.sourceFiles[].text`를 `stripSourceFilesText()`로 제거.
- `id`, `fileName`, `charCount`, `uploadedAt` 메타데이터는 보존
- 복원(restore) 시 현재 그래프의 sourceFiles에서 text 재구성
- 기존 버전(text 포함)은 하위 호환성 유지 — restore 시 text가 있으면 그대로 사용

**저장량 감소**: 버전 히스토리의 ~80-99%

### 1-5. 무제한 플랜 절대 상한 (2026-02-09)

**파일**: `web/src/lib/versionHistory.ts`

플랜에서 `-1`(무제한) 설정 시에도 절대 상한 적용:
- `HARD_LIMIT_SAVED_GRAPHS = 300`
- `HARD_LIMIT_VERSIONS = 50`

`resolveMaxVersions()`, `resolveMaxSavedGraphs()` 헬퍼로 캡 적용.

### 1-6. PUT 핸들러 버전 히스토리 추가 (2026-02-09)

**파일**: `web/src/app/api/knowledge-graphs/[id]/route.ts`

수동 편집(파일 삭제, 텍스트 수정 등) 시에도 버전 히스토리 생성.
기존에는 POST(분석/파일 추가) 시에만 버전이 생성되었음.

### 1-7. Anonymous TTL 인덱스 (2026-02-09)

**파일**: `web/src/lib/mongo.ts`

anonymous 사용자 데이터 30일 자동 만료 (MongoDB TTL 인덱스):
- `knowledgeGraphs` (`updatedAt`, `userId: 'anonymous'`)
- `novels` (`updatedAt`, `userId: 'anonymous'`)
- `knowledgeGraphVersions` (`savedAt`, `userId: 'anonymous'`)

embedding 컬렉션은 `createdAt` 필드 부재로 TTL 미적용 — 부모 그래프 만료 시 고아화되지만 크기가 작아 수용.

### 주의 필요 (MEDIUM)

#### 고아 novels 데이터

**문제**: novels 삭제 시 `knowledgeGraphs.novelId` 참조가 null reference로 남음.

**평가**: 기능 영향 없음 (novelId는 표시용 참조). novels 자체가 `MAX_NOVELS_PER_USER=20`으로 제한되어 있으므로 무한 증가 불가.

**결정**: 수용 (현 상태 유지)

### 낮은 위험 (LOW)

#### MongoDB Docker 볼륨

Docker Compose의 `mongodb_data` named volume은 명시적 정리 없이 증가.
위의 컬렉션별 제한으로 사용자당 최대 저장량이 제한되므로, 사용자 수에 비례하여 선형 증가.

**모니터링 권장**:
```bash
docker system df -v | grep mongodb_data
```

#### 인메모리 캐시

- `balanceCache.ts`: Map 구조, 5분 TTL, 사용자 수에 비례 (KB 단위)
- `rateLimit.ts`: Map 구조, 분/일 윈도우, 자동 만료

**평가**: 메모리 전용, 재시작 시 초기화. 문제 없음.

---

## 3. 향후 권장 작업

| 우선순위 | 작업 | 예상 효과 | 상태 |
|---------|------|----------|------|
| ~~높음~~ | ~~버전 히스토리 sourceFiles text 제거~~ | ~~저장량 ~80% 감소~~ | 완료 (1-4) |
| 보통 | 기존 고아 데이터 일괄 정리 스크립트 | 일회성 정리 (P0-1 이전 축적분) | |
| 보통 | `originalText` 레거시 필드 정리 (mongosh) | 기존 데이터 정리 | 배포 후 실행 |
| 낮음 | MongoDB 디스크 사용량 모니터링 알림 | 운영 가시성 | |
| 낮음 | embedding 컬렉션 `createdAt` 필드 추가 + TTL | anonymous 고아 데이터 정리 | |

---

## 4. 저장량 추정 (조치 완료 후)

### 플랜별 스토리지 제한 (2026-02-09 조정)

| 플랜 | 그래프 수 | 버전 수 |
|------|----------|---------|
| Free | 3 | 3 |
| Basic | 10 | 10 |
| Pro | 30 | 20 |
| Business | 100 | 30 |
| Internal | -1 (HARD_LIMIT 300) | -1 (HARD_LIMIT 50) |

### 사용자당 최대 저장량 (Free 플랜 기준)

| 항목 | 계산 | 크기 |
|------|------|------|
| novels | 20개 x 5MB | ~100MB |
| knowledgeGraphs | 3개 x (5MB텍스트 + 1MB분석) | ~18MB |
| knowledgeGraphVersions (text 제거됨) | 3그래프 x 3버전 x ~0.2MB | ~1.8MB |
| embeddings | 3그래프 x ~2MB | ~6MB |
| **합계** | | **~126MB** |

### 플랜별 heavy-use 최대 저장량 추정

| 플랜 | 최대 저장량 |
|------|-----------|
| Free | ~93MB |
| Basic | ~360MB |
| Pro | ~1.3GB |
| Business | ~5.1GB |
| Internal (HARD_LIMIT) | ~22GB |

> 47GB 디스크 기준 Free 사용자 약 500명, Pro 사용자 약 35명 수용 가능
