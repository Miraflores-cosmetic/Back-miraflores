import { redirect } from 'next/navigation';

export default async function LegacyUserGroupDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/settings/user-groups/${id}`);
}
