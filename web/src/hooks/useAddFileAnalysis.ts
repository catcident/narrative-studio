/**
 * 파일 추가 분석 공유 훅
 * App.tsx (헤더 "파일 추가" 버튼)과 FileUpload (ResumePanel) 양쪽에서 사용
 */

import { useCallback, useState } from 'react';
import { useStore, useBillingSubscription, useModels, useByokEnabled, useAuthEnabled } from '../store';
import { extractKnowledgeGraph, syncPartialAnalysis, hasApiKey } from '../services/extraction';
import { saveKnowledgeGraph } from '../services/storage';
import { createBillingCallback, ensureSufficientBalance, holdCredits, finalizeHold, estimateUsageFromText, checkCreditSufficiency, isBillingTestSubscription } from '../services/billing';
import { requestCreditConfirmation } from '../store';
import { readFileAsText } from '../services/fileReader';
import { DEFAULT_MODEL, getAvailableModelIds } from '../types';

export function useAddFileAnalysis() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const currentDataId = useStore((s) => s.currentDataId);
  const subscription = useBillingSubscription();
  const allModels = useModels();
  const byokEnabled = useByokEnabled();
  const authEnabled = useAuthEnabled();
  const addChunkUsage = useStore((s) => s.addChunkUsage);
  const updateCreditBalance = useStore((s) => s.updateCreditBalance);
  const setShowUsageSummary = useStore((s) => s.setShowUsageSummary);
  const setKnowledgeGraph = useStore((s) => s.setKnowledgeGraph);
  const setError = useStore((s) => s.setError);
  const resetCurrentUsage = useStore((s) => s.resetCurrentUsage);
  const setLoading = useStore((s) => s.setLoading);
  const loadSubscription = useStore((s) => s.loadSubscription);
  const setPartialAnalysis = useStore((s) => s.setPartialAnalysis);

  const [isAdding, setIsAdding] = useState(false);
  const [progress, setProgress] = useState('');

  const execute = useCallback(async (text: string, fileName: string, existingGraphOverride?: typeof knowledgeGraph) => {
    // 최신 상태를 사용하거나 override 사용 (파일 수정 시 삭제 후 최신 상태 전달)
    const graphToUse = existingGraphOverride ?? useStore.getState().knowledgeGraph;
    if (!graphToUse) return;

    setIsAdding(true);
    setLoading(true);
    setError(null);
    resetCurrentUsage();

    try {
      const isUsingPersonalKey = !isBillingTestSubscription(subscription) && byokEnabled && hasApiKey();
      const model = graphToUse.metadata.model || DEFAULT_MODEL;
      let holdToken: string | null = null;

      if (!isUsingPersonalKey) {
        const estimate = subscription ? estimateUsageFromText(text, model, allModels) : null;

        const check = checkCreditSufficiency(subscription, authEnabled, estimate?.estimated_credits);
        if (check.level === 'blocked') throw new Error(check.message);
        if (check.level !== 'ok') {
          const confirmed = await requestCreditConfirmation({
            level: check.level,
            estimatedCredits: estimate?.estimated_credits ?? 0,
            balance: subscription?.creditBalance ?? 0,
            operationName: '파일 분석',
            canResume: true,
          });
          if (!confirmed) return;
        }

        await ensureSufficientBalance(subscription, authEnabled);

        if (subscription && estimate) {
          const holdAmount = check.level === 'warning'
            ? Math.min(estimate.estimated_credits, subscription.creditBalance)
            : estimate.estimated_credits;
          const holdResult = await holdCredits(holdAmount, model, estimate.chunks);
          if (!holdResult.ok) {
            throw new Error(holdResult.status === 402 ? '크레딧이 부족합니다.' : '과금 시스템 오류가 발생했습니다.');
          }
          holdToken = holdResult.data.hold_token;
          if (holdResult.data.balance_after !== null) {
            updateCreditBalance(holdResult.data.balance_after);
          }
        }
      }

      setProgress('추가 분석 중...');
      let updated;
      try {
        updated = await extractKnowledgeGraph({
          text,
          title: graphToUse.metadata.title,
          onProgress: (msg) => setProgress(msg),
          model,
          holdToken,
          fileNames: [fileName],
          existingGraph: graphToUse,
          onChunkBilling: createBillingCallback(addChunkUsage),
          availableModelIds: getAvailableModelIds(allModels),
        });
      } catch (extractionErr: unknown) {
        if (holdToken) {
          const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `추가 분석 중단: ${fileName}`, updateCreditBalance);
          if (settleResult.actualCredits !== null) {
            useStore.getState().setSettledCredits(settleResult.actualCredits);
          }
        }
        throw extractionErr;
      }

      if (holdToken) {
        const settleResult = await finalizeHold(holdToken, useStore.getState().currentUsage.chunks, `추가 분석 완료: ${fileName}`, updateCreditBalance);
        if (settleResult.actualCredits !== null) {
          useStore.getState().setSettledCredits(settleResult.actualCredits);
        }
      }

      setProgress('저장 중...');
      const saved = await saveKnowledgeGraph(
        updated, undefined, currentDataId || undefined,
      );
      setKnowledgeGraph(updated, undefined, saved.id);
      syncPartialAnalysis(setPartialAnalysis, updated.metadata.title);
      setProgress('');
      setShowUsageSummary(true);
    } catch (err: unknown) {
      console.error('[extraction] 파일 추가 오류:', err);
      setError(err instanceof Error ? err.message : '파일 추가 중 오류가 발생했습니다.');
      setProgress('');
      syncPartialAnalysis(setPartialAnalysis);
    } finally {
      setIsAdding(false);
      setLoading(false);
      loadSubscription();
    }
  }, [knowledgeGraph, currentDataId, subscription, addChunkUsage,
      updateCreditBalance, setKnowledgeGraph, setShowUsageSummary,
      setError, resetCurrentUsage, setLoading, loadSubscription, allModels, setPartialAnalysis, byokEnabled, authEnabled]);

  const addFile = useCallback(async (
    file: File,
    onDuplicate?: (fileName: string, text: string) => void,
  ) => {
    if (!knowledgeGraph) return;

    setProgress('파일 읽는 중...');
    try {
      const text = await readFileAsText(file, setProgress);
      if (!text.trim()) throw new Error('파일 내용이 비어있습니다.');

      const existingFileNames = (knowledgeGraph.metadata.sourceFiles || [])
        .map(f => f.fileName);
      if (existingFileNames.includes(file.name)) {
        setProgress('');
        if (onDuplicate) {
          onDuplicate(file.name, text);
          return;
        }
        // onDuplicate 미제공 시 그대로 진행 — merger의 dedup이 중복 엔티티/관계 처리
      }

      await execute(text, file.name);
    } catch (err: unknown) {
      console.error('[extraction] 추가 분석 오류:', err);
      setError(err instanceof Error ? err.message : '추가 분석 중 오류가 발생했습니다.');
      setProgress('');
    }
  }, [knowledgeGraph, execute, setError]);

  return { addFile, execute, isAdding, progress };
}
