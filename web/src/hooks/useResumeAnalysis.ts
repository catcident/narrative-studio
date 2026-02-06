/**
 * 이어하기(Resume) 분석 공유 훅
 * App.tsx (PartialAnalysisBanner)와 FileUpload (ResumePanel) 양쪽에서 사용
 */

import { useCallback, useState } from 'react';
import { useStore, useBillingSubscription, useModels } from '../store';
import { extractKnowledgeGraph, loadProgress, clearProgress, syncPartialAnalysis } from '../services/extraction';
import { saveKnowledgeGraph } from '../services/storage';
import { createBillingCallback, ensureSufficientBalance } from '../services/billing';
import { DEFAULT_MODEL, getAvailableModelIds } from '../types';

export function useResumeAnalysis() {
  const subscription = useBillingSubscription();
  const allModels = useModels();
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
      await ensureSufficientBalance(subscription);

      // 만료 모델이면 DEFAULT_MODEL로 대체 (extractKnowledgeGraph 내부에서도 동일한 폴백)
      const resumeData = invalidSavedModel
        ? { ...savedProgress, model: DEFAULT_MODEL }
        : savedProgress;

      const newKnowledgeGraph = await extractKnowledgeGraph({
        text: '',
        title: savedProgress.title,
        onProgress: (msg) => setProgress(msg),
        resumeFrom: resumeData,
        onChunkBilling: createBillingCallback(addChunkUsage, updateCreditBalance),
        availableModelIds: getAvailableModelIds(allModels),
      });

      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(newKnowledgeGraph);

      setKnowledgeGraph(newKnowledgeGraph, undefined, saved.id);
      setProgress('');
      setShowUsageSummary(true);
      syncPartialAnalysis(setPartialAnalysis);
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
      setShowUsageSummary, loadSubscription, setPartialAnalysis]);

  const clearSavedProgress = useCallback(() => {
    clearProgress();
    setPartialAnalysis(null);
  }, [setPartialAnalysis]);

  return { resume, clearSavedProgress, isResuming, progress };
}
