import { Suspense } from 'react';
import { ProductAttributesAdminClient } from './ProductAttributesAdminClient';

export default function AdminProductAttributesSettingsPage() {
  return (
    <Suspense fallback={<p>Загрузка…</p>}>
      <ProductAttributesAdminClient />
    </Suspense>
  );
}
