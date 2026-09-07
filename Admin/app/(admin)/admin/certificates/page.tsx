import { Suspense } from 'react';
import { getAdminSession } from '@/lib/getAdminSession';
import {
  staffCanCertificatesCatalog,
  staffCanCertificatesFinance,
} from '@/lib/adminSections';
import { CertificatesHubClient } from './CertificatesHubClient';

export default async function AdminCertificatesPage() {
  const session = await getAdminSession();
  const staff = session.authenticated ? session.staff : null;
  const canCertificatesCatalog = staff
    ? staffCanCertificatesCatalog(staff.sections, staff.isSuperAdmin)
    : false;
  const canCertificatesFinance = staff
    ? staffCanCertificatesFinance(staff.sections, staff.isSuperAdmin)
    : false;

  return (
    <Suspense fallback={<p>Загрузка…</p>}>
      <CertificatesHubClient
        canCertificatesCatalog={canCertificatesCatalog}
        canCertificatesFinance={canCertificatesFinance}
      />
    </Suspense>
  );
}
