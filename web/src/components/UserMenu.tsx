/**
 * User menu component with logout functionality
 * Displays user name/email and logout button when authenticated
 */

import { signOut, useSession } from 'next-auth/react';
import { LogOut } from 'lucide-react';

interface UserMenuProps {
  /** Additional container className */
  className?: string;
}

export function UserMenu({ className = '' }: UserMenuProps): React.ReactNode {
  const { data: session } = useSession();

  if (!session?.user) {
    return null;
  }

  const displayName = session.user.nickname || session.user.name || session.user.email;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm text-gray-600">{displayName}</span>
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
