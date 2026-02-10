/**
 * 개별 로어북 추출 훅
 * 기존 그래프에 로어북만 추가/갱신하는 기능 제공
 */

import { useState, useCallback } from 'react';
import { useStore, useBillingSubscription, useModels, useByokEnabled, useAuthEnabled } from '../store';
import { extractLorebookOnly } from '../services/extraction';
import { hasApiKey, getByokMode } from '../services/extraction';
import { createBillingCallback, ensureSufficientBalance, holdCredits, finalizeHold, estimateLorebookOnlyCost } from '../services/billing';
import { saveKnowledgeGraph } from '../services/storage';
import { getAvailableModelIds } from '../types';
import type { NovelKnowledgeGraph, Lorebook } from '../types';

interface UseLorebookExtractionResult {
  extractLorebook: (knowledgeGraph: NovelKnowledgeGraph) => Promise<void>;
  isExtracting: boolean;
  progress: string;
  progressCurrent: number;
  progressTotal: number;
}

export function useLorebookExtraction(): UseLorebookExtractionResult {
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState('');
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

  const subscription = useBillingSubscription();
  const allModels = useModels();
  const byokEnabled = useByokEnabled();
  const authEnabled = useAuthEnabled();

  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const addChunkUsage = useStore((s) => s.addChunkUsage);
  const updateCreditBalance = useStore((s) => s.updateCreditBalance);
  const loadSubscription = useStore((s) => s.loadSubscription);
  const resetCurrentUsage = useStore((s) => s.resetCurrentUsage);
  const setError = useStore((s) => s.setError);

  const extractLorebook = useCallback(async (knowledgeGraph: NovelKnowledgeGraph) => {
    if (isExtracting) return;

    setIsExtracting(true);
    setError(null);
    resetCurrentUsage();
    setProgress('로어북 추출 준비 중...');

    try {
      const model = knowledgeGraph.metadata.model;
      const isUsingPersonalKey = byokEnabled && hasApiKey();

      // 텍스트 길이 계산 (sourceFiles에서)
      const charCount = (knowledgeGraph.metadata.sourceFiles ?? [])
        .reduce((sum, sf) => sum + sf.charCount, 0);

      if (charCount === 0) {
        throw new Error('원본 텍스트가 없어 로어북을 추출할 수 없습니다.');
      }

      // Billing hold
      let holdToken: string | null = null;
      if (!isUsingPersonalKey) {
        const estimate = subscription && model
          ? estimateLorebookOnlyCost(charCount, model, allModels)
          : null;
        await ensureSufficientBalance(subscription, authEnabled, estimate?.credits);

        if (subscription && estimate) {
          const holdResult = await holdCredits(estimate.credits, model ?? '', estimate.chunks);
          if (!holdResult.ok) {
            throw new Error(holdResult.status === 402 ? '크레딧이 부족합니다.' : '과금 시스템 오류가 발생했습니다.');
          }
          holdToken = holdResult.data.hold_token;
          if (holdResult.data.balance_after !== null) {
            updateCreditBalance(holdResult.data.balance_after);
          }
        }
      }

      let lorebook: Lorebook;
      try {
        lorebook = await extractLorebookOnly({
          knowledgeGraph,
          model,
          onProgress: (msg, current, total) => {
            setProgress(msg);
            if (current !== undefined) setProgressCurrent(current);
            if (total !== undefined) setProgressTotal(total);
          },
          onChunkBilling: createBillingCallback(addChunkUsage),
          availableModelIds: getAvailableModelIds(allModels),
          byokMode: getByokMode(),
          creditBalance: subscription?.creditBalance ?? null,
        });
      } catch (extractionErr: unknown) {
        if (holdToken) {
          await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `로어북 추출 중단: ${knowledgeGraph.metadata.title}`, updateCreditBalance);
        }
        throw extractionErr;
      }

      // Billing settle
      if (holdToken) {
        const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `로어북 추출 완료: ${knowledgeGraph.metadata.title}`, updateCreditBalance);
        if (settleResult.actualCredits !== null) {
          useStore.getState().setSettledCredits(settleResult.actualCredits);
        }
      }

      // 기존 그래프에 로어북 덮어쓰기
      const updatedGraph: NovelKnowledgeGraph = {
        ...knowledgeGraph,
        lorebook,
      };

      setProgress('저장 중...');
      await saveKnowledgeGraph(updatedGraph);
      setKnowledgeGraph(updatedGraph);
      setProgress('');
    } catch (err: unknown) {
      console.error('[lorebook-extraction] error:', err);
      setError(err instanceof Error ? err.message : '로어북 추출 중 오류가 발생했습니다.');
    } finally {
      setIsExtracting(false);
      setProgress('');
      setProgressCurrent(0);
      setProgressTotal(0);
      loadSubscription();
    }
  }, [isExtracting, subscription, allModels, byokEnabled, authEnabled, addChunkUsage, updateCreditBalance, loadSubscription, resetCurrentUsage, setKnowledgeGraph, setError]);

  return { extractLorebook, isExtracting, progress, progressCurrent, progressTotal };
}
