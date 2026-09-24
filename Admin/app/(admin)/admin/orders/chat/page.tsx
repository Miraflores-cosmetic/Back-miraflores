import { getAdminSession } from '@/lib/getAdminSession';
import { redirect } from 'next/navigation';
import { staffCanSeeOrdersNav } from '@miraflores/admin-sections';
import { OrderSupportChatClient } from './OrderSupportChatClient';

export default async function AdminOrderSupportChatPage() {
  const session = await getAdminSession();
  if (!session.authenticated) {
    redirect('/admin/login');
  }
  const staff = session.staff;
  if (!staff || !staffCanSeeOrdersNav(staff.sections, staff.isSuperAdmin)) {
    redirect('/admin');
  }

  return (
    <OrderSupportChatClient
      staffUserId={session.user?.id}
      staffAvatarUrl={staff.staffAvatarUrl}
    />
  );
}
