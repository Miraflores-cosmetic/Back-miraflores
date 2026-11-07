import { Suspense } from 'react';
import { ReferralAdminClient } from './ReferralAdminClient';

export default function AdminReferralSettingsPage() {
  return (
    <Suspense fallback={<p>Загрузка…</p>}>
      <ReferralAdminClient />
    </Suspense>
  );
}
