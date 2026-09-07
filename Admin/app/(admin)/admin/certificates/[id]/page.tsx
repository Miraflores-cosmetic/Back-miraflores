import { getAdminSession } from '@/lib/getAdminSession';
import { staffCanCertificatesFinance } from '@/lib/adminSections';
import { CertificateDetailClient } from './CertificateDetailClient';

export default async function AdminCertificateDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getAdminSession();
  const canCertificatesFinance =
    session.authenticated && session.staff
      ? staffCanCertificatesFinance(session.staff.sections, session.staff.isSuperAdmin)
      : false;

  return (
    <CertificateDetailClient
      certificateId={params.id}
      canCertificatesFinance={canCertificatesFinance}
    />
  );
}
