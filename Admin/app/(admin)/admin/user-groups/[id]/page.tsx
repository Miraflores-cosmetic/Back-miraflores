import { UserGroupDetailClient } from './UserGroupDetailClient';

export default async function AdminUserGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <UserGroupDetailClient groupId={id} />;
}
