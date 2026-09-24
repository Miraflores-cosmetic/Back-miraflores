import { getAdminSession } from '@/lib/getAdminSession';
import { staffCanOrdersFinance } from '@/lib/adminSections';
import { OrderDetailClient } from '../OrderDetailClient';

export default async function AdminOrderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getAdminSession();
  const canOrdersFinance =
    session.authenticated && session.staff
      ? staffCanOrdersFinance(session.staff.sections, session.staff.isSuperAdmin)
      : false;

  return (
    <OrderDetailClient
      orderId={params.id}
      canOrdersFinance={canOrdersFinance}
      staffUserId={session.authenticated ? session.user.id : null}
      staffAvatarUrl={session.authenticated ? session.staff?.staffAvatarUrl : null}
    />
  );
}
