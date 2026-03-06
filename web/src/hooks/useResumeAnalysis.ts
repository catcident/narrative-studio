/**
 * 이어하기(Resume) 분석 공유 훅
 * App.tsx (PartialAnalysisBanner)와 FileUpload (ResumePanel) 양쪽에서 사용
 */

import { useCallback, useState } from 'react';
import { useStore, useBillingSubscription, useModels, useByokEnabled, useAuthEnabled } from '../store';
import { extractKnowledgeGraph, loadProgress, clearProgress, syncPartialAnalysis, hasApiKey } from '../services/extraction';
import { saveKnowledgeGraph } from '../services/storage';
import { createBillingCallback, ensureSufficientBalance, holdCredits, finalizeHold, estimateUsageLocally, checkCreditSufficiency, isBillingTestSubscription } from '../services/billing';
import { requestCreditConfirmation } from '../store';
import { DEFAULT_MODEL, getAvailableModelIds } from '../types';
import { CHUNK_SIZE, CHUNK_OVERLAP } from '@/lib/modelCosts';

export function useResumeAnalysis() {
  const subscription = useBillingSubscription();
  const allModels = useModels();
  const byokEnabled = useByokEnabled();
  const authEnabled = useAuthEnabled();
  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const setError = useStore((s) => s.setError);
  const setLoading = useStore((s) => s.setLoading);
  const addChunkUsage = useStore((s) => s.addChunkUsage);
  const updateCreditBalance = useStore((s) => s.updateCreditBalance);
  const resetCurrentUsage = useStore((s) => s.resetCurrentUsage);
  const setShowUsageSummary = useStore((s) => s.setShowUsageSummary);
  const loadSubscription = useStore((s) => s.loadSubscription);
  const setPartialAnalysis = useStore((s) => s.setPartialAnalysis);

  const [isResuming, setIsResuming] = useState(false);
  const [progress, setProgress] = useState('');

  const resume = useCallback(async () => {
    const savedProgress = loadProgress();
    if (!savedProgress) return;

    // 만료 모델 감지
    const savedModelId = savedProgress.model;
    const invalidSavedModel = savedModelId
      ? !allModels.some((m) => m.id === savedModelId && m.available !== false)
      : false;

    setIsResuming(true);
    setLoading(true);
    setError(null);
    resetCurrentUsage();
    setProgress(`이어하기: ${savedProgress.processedChunks}/${savedProgress.totalChunks}부터...`);

    try {
      const isUsingPersonalKey = !isBillingTestSubscription(subscription) && byokEnabled && hasApiKey();

      // 만료 모델이면 DEFAULT_MODEL로 대체
      const resumeModel = invalidSavedModel ? DEFAULT_MODEL : (savedProgress.model || DEFAULT_MODEL);

      // 남은 청크에 대해서만 잔액 확인 + hold
      let holdToken: string | null = null;
      if (!isUsingPersonalKey) {
        const remainingChunks = savedProgress.totalChunks - savedProgress.processedChunks;
        const estimate = subscription && remainingChunks > 0
          ? estimateUsageLocally(remainingChunks * (CHUNK_SIZE - CHUNK_OVERLAP), resumeModel, allModels)
          : null;

        const check = checkCreditSufficiency(subscription, authEnabled, estimate?.estimated_credits);
        if (check.level === 'blocked') throw new Error(check.message);
        if (check.level !== 'ok') {
          const confirmed = await requestCreditConfirmation({
            level: check.level,
            estimatedCredits: estimate?.estimated_credits ?? 0,
            balance: subscription?.creditBalance ?? 0,
            operationName: '이어하기',
            canResume: true,
          });
          if (!confirmed) {
            setIsResuming(false);
            setLoading(false);
            return;
          }
        }

        await ensureSufficientBalance(subscription, authEnabled);

        if (subscription && estimate) {
          const holdAmount = check.level === 'warning'
            ? Math.min(estimate.estimated_credits, subscription.creditBalance)
            : estimate.estimated_credits;
          const holdResult = await holdCredits(holdAmount, resumeModel, remainingChunks);
          if (!holdResult.ok) {
            throw new Error(holdResult.status === 402 ? '크레딧이 부족합니다.' : '과금 시스템 오류가 발생했습니다.');
          }
          holdToken = holdResult.data.hold_token;
          if (holdResult.data.balance_after !== null) {
            updateCreditBalance(holdResult.data.balance_after);
          }
        }
      }

      const resumeData = invalidSavedModel
        ? { ...savedProgress, model: DEFAULT_MODEL }
        : savedProgress;

      let newKnowledgeGraph;
      try {
        newKnowledgeGraph = await extractKnowledgeGraph({
          text: '',
          title: savedProgress.title,
          onProgress: (msg) => setProgress(msg),
          resumeFrom: resumeData,
          holdToken,
          onChunkBilling: createBillingCallback(addChunkUsage),
          availableModelIds: getAvailableModelIds(allModels),
        });
      } catch (extractionErr: unknown) {
        if (holdToken) {
          const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `이어하기 중단: ${savedProgress.title}`, updateCreditBalance);
          if (settleResult.actualCredits !== null) {
            useStore.getState().setSettledCredits(settleResult.actualCredits);
          }
        }
        throw extractionErr;
      }

      if (holdToken) {
        const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `이어하기 완료: ${savedProgress.title}`, updateCreditBalance);
        if (settleResult.actualCredits !== null) {
          useStore.getState().setSettledCredits(settleResult.actualCredits);
        }
      }

      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      setKnowledgeGraph(newKnowledgeGraph, undefined, saved.id);
      setProgress('');
      setShowUsageSummary(true);
      syncPartialAnalysis(setPartialAnalysis, newKnowledgeGraph.metadata.title);
    } catch (err: unknown) {
      console.error('[extraction] resume error:', err);
      setError(err instanceof Error ? err.message : '이어하기 중 오류가 발생했습니다.');
      setProgress('');
      syncPartialAnalysis(setPartialAnalysis);
    } finally {
      setIsResuming(false);
      setLoading(false);
      loadSubscription();
    }
  }, [subscription, allModels, setKnowledgeGraph, setError, setLoading,
      addChunkUsage, updateCreditBalance, resetCurrentUsage,
      setShowUsageSummary, loadSubscription, setPartialAnalysis, byokEnabled, authEnabled]);

  const clearSavedProgress = useCallback(() => {
    clearProgress();
    setPartialAnalysis(null);
  }, [setPartialAnalysis]);

  return { resume, clearSavedProgress, isResuming, progress };
}
