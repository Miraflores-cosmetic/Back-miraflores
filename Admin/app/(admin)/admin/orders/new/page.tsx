import { getAdminSession } from '@/lib/getAdminSession';
import { staffCanOrdersFinance } from '@/lib/adminSections';
import { OrderCreateWizard } from '../OrderCreateWizard';

export default async function AdminOrderCreatePage() {
  const session = await getAdminSession();
  const canOrdersFinance =
    session.authenticated && session.staff
      ? staffCanOrdersFinance(session.staff.sections, session.staff.isSuperAdmin)
      : false;

  return <OrderCreateWizard canOrdersFinance={canOrdersFinance} />;
}
