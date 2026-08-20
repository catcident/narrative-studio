import type { ClientSession, Db } from 'mongodb';
import { fetchStorygraphSubscription } from '@/lib/billingBackend';

// ── 절대 상한 (플랜 설정과 무관한 하드 리밋) ──
const HARD_LIMIT_SAVED_GRAPHS = 300;
const HARD_LIMIT_VERSIONS = 50;

// ── 폴백 기본값 (billing 서비스 장애/anonymous 시) ──
export const DEFAULT_MAX_SAVED_GRAPHS = 3;
export const DEFAULT_MAX_VERSIONS = 3;

// ── 상한 적용 헬퍼 ──

/** 플랜 값에 절대 상한을 적용. -1(무제한)이면 HARD_LIMIT으로 캡. */
export function resolveMaxVersions(planValue: number): number {
  if (planValue === -1) return HARD_LIMIT_VERSIONS;
  return Math.min(planValue, HARD_LIMIT_VERSIONS);
}

/** 플랜 값에 절대 상한을 적용. -1(무제한)이면 HARD_LIMIT으로 캡. */
export function resolveMaxSavedGraphs(planValue: number): number {
  if (planValue === -1) return HARD_LIMIT_SAVED_GRAPHS;
  return Math.min(planValue, HARD_LIMIT_SAVED_GRAPHS);
}

// ── 플랜 features 조회 ──

interface StorageLimits {
  maxVersions: number;
  maxSavedGraphs: number;
}

/** subscription API에서 스토리지 제한을 조회. side effect를 피하기 위해 read-only helper를 사용하며, 실패 시 DEFAULT 폴백. */
export async function fetchStorageLimits(accessToken: string | undefined): Promise<StorageLimits> {
  if (!accessToken) {
    return {
      maxVersions: DEFAULT_MAX_VERSIONS,
      maxSavedGraphs: DEFAULT_MAX_SAVED_GRAPHS,
    };
  }

  try {
    const subscription = await fetchStorygraphSubscription(accessToken);
    const features = subscription?.features;
    if (features) {
      return {
        maxVersions: resolveMaxVersions(features.max_versions ?? DEFAULT_MAX_VERSIONS),
        maxSavedGraphs: resolveMaxSavedGraphs(features.max_saved_graphs ?? DEFAULT_MAX_SAVED_GRAPHS),
      };
    }
  } catch (err: unknown) {
    console.warn('[storage] subscription 조회 실패, 기본 제한 적용:', err instanceof Error ? err.message : err);
  }
  return {
    maxVersions: DEFAULT_MAX_VERSIONS,
    maxSavedGraphs: DEFAULT_MAX_SAVED_GRAPHS,
  };
}

// ── sourceFiles text 제거 ──

/**
 * data 객체에서 metadata.sourceFiles[].text를 제거한 사본을 반환.
 * id, fileName, charCount, uploadedAt 메타데이터는 보존.
 */
export function stripSourceFilesText(data: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(data);

  const metadata = clone.metadata as Record<string, unknown> | undefined;
  if (!metadata) return clone;

  const sourceFiles = metadata.sourceFiles as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(sourceFiles)) return clone;

  for (const file of sourceFiles) {
    delete file.text;
  }

  return clone;
}

// ── 버전 히스토리 저장 + FIFO ──

interface SaveVersionHistoryParams {
  db: Db;
  existingDoc: {
    _id: { toString(): string };
    version?: number;
    updatedAt?: Date;
    createdAt?: Date;
    data?: Record<string, unknown>;
    title?: string;
  };
  note: string;
  maxVersions: number;
  userId: string;
  addedFiles?: string | null;
  session: ClientSession;
}

/**
 * 기존 문서를 버전 히스토리에 저장하고 FIFO 정리 수행.
 * sourceFiles text는 제거된 상태로 저장됨.
 */
export async function saveVersionHistory({
  db,
  existingDoc,
  note,
  maxVersions,
  userId,
  addedFiles,
  session,
}: SaveVersionHistoryParams): Promise<void> {
  const versionsCollection = db.collection('knowledgeGraphVersions');
  const graphDocId = existingDoc._id.toString();
  const now = new Date();

  // text 제거한 사본 저장
  const strippedData = existingDoc.data
    ? stripSourceFilesText(existingDoc.data as Record<string, unknown>)
    : existingDoc.data;

  await versionsCollection.insertOne({
    dataId: graphDocId,
    version: existingDoc.version ?? 1,
    savedAt: existingDoc.updatedAt || existingDoc.createdAt || now,
    note,
    data: strippedData,
    addedFiles: addedFiles || null,
    userId,
  }, { session });

  // FIFO: 오래된 버전부터 삭제
  const versionCount = await versionsCollection.countDocuments({ dataId: graphDocId }, { session });
  if (versionCount > maxVersions) {
    const excess = versionCount - maxVersions;
    const oldestVersions = await versionsCollection
      .find({ dataId: graphDocId }, { session })
      .sort({ savedAt: 1 })
      .limit(excess)
      .toArray();
    if (oldestVersions.length > 0) {
      await versionsCollection.deleteMany({
        _id: { $in: oldestVersions.map(v => v._id) },
      }, { session });
    }
  }
}
