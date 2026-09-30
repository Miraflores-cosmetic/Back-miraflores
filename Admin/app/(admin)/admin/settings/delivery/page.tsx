import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/getAdminSession';
import { DeliverySettingsClient } from './DeliverySettingsClient';

export default async function AdminDeliverySettingsPage() {
  const session = await getAdminSession();
  if (!session.authenticated) redirect('/admin/login');
  if (!session.staff?.isSuperAdmin) redirect('/admin');

  return (
    <Suspense fallback={null}>
      <DeliverySettingsClient />
    </Suspense>
  );
}
