/**
 * User menu component with logout functionality
 * Displays user name/email and logout button when authenticated
 */

import { signOut, useSession } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { useBillingSubscription } from '../store';
import { clearUserScopedStorage } from '../lib/userScopedStorage';

interface UserMenuProps {
  /** Additional container className */
  className?: string;
}

function getPlanBadgeColor(planCode: string): string {
  switch (planCode) {
    case 'business': return 'bg-amber-100 text-amber-700';
    case 'pro': return 'bg-purple-100 text-purple-700';
    case 'basic': return 'bg-blue-100 text-blue-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function getPlanLabel(planCode: string, planName?: string): string {
  switch (planCode) {
    case 'business': return 'Business';
    case 'pro': return 'Pro';
    case 'basic': return 'Basic';
    default: return planName ?? planCode.toUpperCase();
  }
}

export function UserMenu({ className = '' }: UserMenuProps): React.ReactNode {
  const { data: session } = useSession();
  const subscription = useBillingSubscription();

  if (!session?.user) {
    return null;
  }

  const displayName = session.user.nickname || session.user.name || session.user.email;
  const planCode = subscription?.plan;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="hidden xl:inline text-sm text-gray-600">{displayName}</span>
      {planCode && planCode !== 'free' && (
        <span className={`hidden xl:inline text-xs px-1.5 py-0.5 rounded font-medium ${getPlanBadgeColor(planCode)}`}>
          {getPlanLabel(planCode, subscription?.planName)}
        </span>
      )}
      <button
        onClick={() => { clearUserScopedStorage(); signOut({ callbackUrl: '/login' }); }}
        aria-label="로그아웃"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
      >
        <LogOut aria-hidden="true" className="w-4 h-4" />
        <span className="hidden xl:inline">로그아웃</span>
      </button>
    </div>
  );
}
