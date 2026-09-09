import { redirect } from 'next/navigation';

export default function LegacyUserGroupsRedirectPage() {
  redirect('/admin/settings/user-groups');
}
