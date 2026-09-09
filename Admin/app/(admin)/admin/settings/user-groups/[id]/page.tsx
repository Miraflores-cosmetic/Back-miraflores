import { getAdminSession } from '@/lib/getAdminSession';
import { redirect } from 'next/navigation';
import { UserGroupDetailClient } from './UserGroupDetailClient';

export default async function AdminUserGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAdminSession();
  if (!session.authenticated || !session.staff) {
    redirect('/admin/login');
  }

  const { id } = await params;
  return (
    <UserGroupDetailClient groupId={id} showSettingsBack={session.staff.isSuperAdmin} />
  );
}
