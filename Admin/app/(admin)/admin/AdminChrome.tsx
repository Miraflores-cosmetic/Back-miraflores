'use client';

import { usePathname } from 'next/navigation';
import type { StaffContext } from '@/lib/adminStaffTypes';
import { staffCanAssistant } from '@/lib/adminSections';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import { AdminSidebarNav } from './AdminSidebarNav';
import { AdminAssistantHost } from './AdminAssistantPanel';
import { useAdminOrderChatStaffUnreadEvents } from '@/hooks/useAdminOrderChatStaffUnreadEvents';
import styles from './layout.module.css';

export function AdminChrome({
  children,
  email,
  staff,
}: {
  children: React.ReactNode;
  email?: string | null;
  staff?: StaffContext | null;
}) {
  const pathname = usePathname() ?? '';
  const isLogin = pathname === '/admin/login';
  const showAssistant =
    !!staff && staffCanAssistant(staff.sections, staff.isSuperAdmin);
  useAdminOrderChatStaffUnreadEvents(isLogin);

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <div className={styles.body}>
          <AdminSidebarNav staff={staff} email={email} />
          <div className={styles.content}>{children}</div>
        </div>
        <AdminAssistantHost
          enabled={showAssistant}
          staffName={staff?.staffDisplayName?.trim() || email || null}
        />
      </div>
    </ToastProvider>
  );
}
