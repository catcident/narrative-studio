/**
 * User menu component with logout functionality
 * Displays user name/email and logout button when authenticated
 */

import { signOut, useSession } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { useBillingSubscription } from '../store';

interface UserMenuProps {
  /** Additional container className */
  className?: string;
}

export function UserMenu({ className = '' }: UserMenuProps): React.ReactNode {
  const { data: session } = useSession();
  const subscription = useBillingSubscription();

  if (!session?.user) {
    return null;
  }

  const displayName = session.user.nickname || session.user.name || session.user.email;
  const planCode = subscription?.plan;
  const planBadgeColor = planCode === 'pro' ? 'bg-purple-100 text-purple-700'
    : planCode === 'basic' ? 'bg-blue-100 text-blue-700'
    : 'bg-gray-100 text-gray-700';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm text-gray-600">{displayName}</span>
      {planCode && planCode !== 'free' && (
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${planBadgeColor}`}>
          {planCode === 'pro' ? 'Pro' : planCode === 'basic' ? 'Basic' : planCode!.toUpperCase()}
        </span>
      )}
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
      >
        <LogOut aria-hidden="true" className="w-4 h-4" />
        로그아웃
      </button>
    </div>
  );
}
