/**
 * 크레딧 확인 다이얼로그
 * 과금 작업 전 예상 비용/잔액을 표시하고 사용자 확인을 받음
 */

import { Calculator, AlertTriangle, X } from 'lucide-react';
import { ModalOverlay } from './ModalOverlay';
import { useCreditConfirmation, useStore } from '../store';

function getDialogConfig(level: 'info' | 'caution' | 'warning') {
  switch (level) {
    case 'info':
      return {
        Icon: Calculator,
        iconColor: 'text-blue-500',
        iconBg: 'bg-blue-50',
        proceedColor: 'bg-blue-500 hover:bg-blue-600',
        alertMessage: null,
      };
    case 'caution':
      return {
        Icon: AlertTriangle,
        iconColor: 'text-amber-500',
        iconBg: 'bg-amber-50',
        proceedColor: 'bg-blue-500 hover:bg-blue-600',
        alertMessage: '예상 비용에 비해 넉넉하지 않습니다. 추정은 실제와 다를 수 있습니다.',
      };
    case 'warning':
      return {
        Icon: AlertTriangle,
        iconColor: 'text-red-500',
        iconBg: 'bg-red-50',
        proceedColor: 'bg-red-500 hover:bg-red-600',
        alertMessage: '크레딧이 부족하여 작업이 중단될 수 있습니다.',
      };
  }
}

export function CreditConfirmDialog() {
  const confirmation = useCreditConfirmation();
  const setCreditConfirmation = useStore((s) => s.setCreditConfirmation);

  if (!confirmation) return null;

  const { level, estimatedCredits, balance, operationName, canResume, resolve } = confirmation;
  const config = getDialogConfig(level);

  const handleConfirm = () => {
    setCreditConfirmation(null);
    resolve(true);
  };

  const handleCancel = () => {
    setCreditConfirmation(null);
    resolve(false);
  };

  return (
    <ModalOverlay onClose={handleCancel} maxWidth="sm">
      <div className="p-6">
        {/* 헤더 */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full ${config.iconBg} flex items-center justify-center`}>
              <config.Icon className={`w-5 h-5 ${config.iconColor}`} aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{operationName}</h3>
          </div>
          <button
            onClick={handleCancel}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
            aria-label="닫기"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* 비용 정보 */}
        <div className="space-y-3 mb-4">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">예상 비용</span>
            <span className="font-medium text-gray-900">~{estimatedCredits.toLocaleString()} 크레딧</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">보유 잔액</span>
            <span className="font-medium text-gray-900">{balance.toLocaleString()} 크레딧</span>
          </div>
        </div>

        {/* 경고 메시지 */}
        {config.alertMessage && (
          <div className={`rounded-lg p-3 mb-4 ${level === 'warning' ? 'bg-red-50' : 'bg-amber-50'}`} role="status">
            <p className={`text-sm ${level === 'warning' ? 'text-red-700' : 'text-amber-700'}`}>
              {config.alertMessage}
            </p>
          </div>
        )}

        {/* 이어하기 안내 */}
        {level === 'warning' && (
          <p className="text-xs text-gray-500 mb-4">
            {canResume
              ? '중단되더라도 이어하기로 이전 진행 시점부터 계속할 수 있습니다.'
              : '중단 시 사용된 크레딧은 환불되지 않습니다.'}
          </p>
        )}

        {/* 버튼 */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${config.proceedColor}`}
          >
            진행
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
