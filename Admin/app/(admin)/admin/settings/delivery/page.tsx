import { Suspense } from 'react';
import { DeliverySettingsClient } from './DeliverySettingsClient';

export default function AdminDeliverySettingsPage() {
  return (
    <Suspense fallback={null}>
      <DeliverySettingsClient />
    </Suspense>
  );
}
