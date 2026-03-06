/**
 * 일괄 분석 큐 훅
 * Pro+ 전용: 여러 파일을 큐에 등록 → 순차 자동 분석 → 각각 별도 지식 그래프 저장
 */

import { useCallback, useRef } from 'react';
import { useStore } from '../store';
import { extractKnowledgeGraph, syncPartialAnalysis, hasApiKey } from '../services/extraction';
import { saveKnowledgeGraph } from '../services/storage';
import { ensureSufficientBalance, holdCredits, finalizeHold, estimateUsageFromText, checkCreditSufficiency, isBillingTestSubscription } from '../services/billing';
import { requestCreditConfirmation } from '../store';
import { getAvailableModelIds } from '../types';
import type { ChunkUsage } from '../types';
import type { ChunkBillingCallback } from '../services/extraction';

export function useBatchAnalysis() {
  const setPartialAnalysis = useStore((s) => s.setPartialAnalysis);
  const loadSubscription = useStore((s) => s.loadSubscription);
  const cancelledRef = useRef(false);

  const startProcessing = useCallback(async () => {
    const {
      analysisQueue, updateQueueItem, setQueueProcessing,
    } = useStore.getState();

    const pendingItems = analysisQueue.filter((item) => item.status === 'pending');
    if (pendingItems.length === 0) return;

    cancelledRef.current = false;

    // 배치 시작 전 전체 큐의 총 예상 크레딧으로 사전 체크
    {
      const freshState = useStore.getState();
      const freshSub = freshState.subscription;
      const freshAuth = freshState.authEnabled;
      const freshByok = freshSub?.features?.byok ?? false;
      const freshModels = freshState.models;
      const isPersonalKey = !isBillingTestSubscription(freshSub) && freshByok && hasApiKey();

      if (!isPersonalKey && freshSub) {
        const totalEstimated = pendingItems.reduce((sum, item) => {
          const est = estimateUsageFromText(item.text, item.model, freshModels);
          return sum + est.estimated_credits;
        }, 0);

        const check = checkCreditSufficiency(freshSub, freshAuth, totalEstimated);
        if (check.level === 'blocked') {
          console.error('[batch] 크레딧 부족:', check.message);
          return;
        }
        if (check.level !== 'ok') {
          const confirmed = await requestCreditConfirmation({
            level: check.level,
            estimatedCredits: totalEstimated,
            balance: freshSub.creditBalance,
            operationName: '일괄 분석',
            canResume: true,
          });
          if (!confirmed) return;
        }
      }
    }

    setQueueProcessing(true);

    for (const item of pendingItems) {
      if (cancelledRef.current) {
        updateQueueItem(item.id, { status: 'cancelled' });
        continue;
      }

      updateQueueItem(item.id, { status: 'processing', progress: '준비 중...' });

      try {
        // 매 항목마다 최신 상태 사용 (stale closure 방지)
        const freshState = useStore.getState();
        const freshSubscription = freshState.subscription;
        const freshAuthEnabled = freshState.authEnabled;
        // NOTE: store 셀렉터(useByokEnabled)의 authEnabled===false permissive fallback 미적용.
        // freshSubscription===null이면 billing 가드에서 이미 스킵되므로 현재 기능적 영향 없음.
        const freshByokEnabled = freshSubscription?.features?.byok ?? false;
        const freshModels = freshState.models;

        const isUsingPersonalKey = !isBillingTestSubscription(freshSubscription) && freshByokEnabled && hasApiKey();
        let holdToken: string | null = null;

        // 잔액 확인 + hold (billing 활성 시)
        if (!isUsingPersonalKey) {
          const estimate = freshSubscription ? estimateUsageFromText(item.text, item.model, freshModels) : null;
          const itemCheck = checkCreditSufficiency(freshSubscription, freshAuthEnabled, estimate?.estimated_credits);
          if (itemCheck.level === 'blocked') {
            updateQueueItem(item.id, { status: 'failed', error: itemCheck.message ?? '크레딧 부족' });
            continue;
          }
          await ensureSufficientBalance(freshSubscription, freshAuthEnabled);

          if (freshSubscription && estimate) {
            const holdAmount = itemCheck.level === 'warning'
              ? Math.min(estimate.estimated_credits, freshSubscription.creditBalance)
              : estimate.estimated_credits;
            const holdResult = await holdCredits(holdAmount, item.model, estimate.chunks);
            if (!holdResult.ok) {
              const errorMsg = holdResult.status === 402 ? '크레딧이 부족합니다.' : '과금 시스템 오류';
              updateQueueItem(item.id, { status: 'failed', error: errorMsg });
              continue;
            }
            holdToken = holdResult.data.hold_token;
            if (holdResult.data.balance_after !== null) {
              useStore.getState().updateCreditBalance(holdResult.data.balance_after);
            }
          }
        }

        // 큐 아이템별 사용량 추적
        const itemChunks: ChunkUsage[] = [];
        const onChunkBilling: ChunkBillingCallback = (chunkIndex, billing) => {
          itemChunks.push({
            chunkIndex,
            promptTokens: billing.prompt_tokens,
            completionTokens: billing.completion_tokens,
            model: billing.model,
          });
        };

        let result;
        try {
          result = await extractKnowledgeGraph({
            text: item.text,
            title: item.fileName.replace(/\.[^/.]+$/, ''),
            onProgress: (msg, current, total) => {
              useStore.getState().updateQueueItem(item.id, {
                progress: msg,
                progressCurrent: current,
                progressTotal: total,
              });
            },
            model: item.model,
            holdToken,
            fileNames: [item.fileName],
            onChunkBilling,
            availableModelIds: getAvailableModelIds(freshModels),
          });
        } catch (extractionErr: unknown) {
          if (holdToken) {
            try {
              const settleResult = await finalizeHold(holdToken, itemChunks, `일괄 분석 중단: ${item.fileName}`, useStore.getState().updateCreditBalance);
              if (settleResult.actualCredits !== null) {
                useStore.getState().setSettledCredits(settleResult.actualCredits);
              }
            } catch (holdErr: unknown) {
              console.error('[batch] finalizeHold 오류:', holdErr instanceof Error ? holdErr.message : holdErr);
            }
          }
          throw extractionErr;
        }

        // settle (extraction 완료 후 — 취소 여부와 무관하게 사용량 정산 필요)
        if (holdToken) {
          const desc = cancelledRef.current
            ? `일괄 분석 취소: ${item.fileName}`
            : `일괄 분석 완료: ${item.fileName}`;
          try {
            await finalizeHold(holdToken, itemChunks, desc, useStore.getState().updateCreditBalance);
          } catch (holdErr: unknown) {
            console.error('[batch] finalizeHold 오류:', holdErr instanceof Error ? holdErr.message : holdErr);
          }
        }

        // 저장
        useStore.getState().updateQueueItem(item.id, { progress: '저장 중...' });
        await saveKnowledgeGraph(result);

        useStore.getState().updateQueueItem(item.id, { status: 'completed', progress: '완료' });
        syncPartialAnalysis(setPartialAnalysis);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : '처리 중 오류 발생';
        console.error(`[batch] ${item.fileName} 분석 실패:`, errorMsg);
        useStore.getState().updateQueueItem(item.id, { status: 'failed', error: errorMsg });
        syncPartialAnalysis(setPartialAnalysis);
      }
    }

    useStore.getState().setQueueProcessing(false);
    loadSubscription();
  }, [setPartialAnalysis, loadSubscription]);

  const cancelProcessing = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return { startProcessing, cancelProcessing };
}
