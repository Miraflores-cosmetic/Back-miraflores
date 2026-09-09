import { getAdminSession } from '@/lib/getAdminSession';
import { redirect } from 'next/navigation';
import { UserGroupsAdminClient } from './UserGroupsAdminClient';

export default async function AdminUserGroupsPage() {
  const session = await getAdminSession();
  if (!session.authenticated || !session.staff) {
    redirect('/admin/login');
  }

  return (
    <UserGroupsAdminClient showSettingsBack={session.staff.isSuperAdmin} />
  );
}
