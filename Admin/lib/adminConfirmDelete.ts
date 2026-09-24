import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { adminConfirm } from '@/components/admin/AdminModal/adminConfirm';

/**
 * confirm → DELETE → optional reload; alert on failure.
 * Shared by useAdminResourceList and paginated product list.
 */
export async function adminConfirmDelete(opts: {
  message: string;
  url: string;
  onDone?: () => void | Promise<void>;
}): Promise<boolean> {
  const ok = await adminConfirm({
    title: 'Удаление',
    message: opts.message,
    confirmLabel: 'Удалить',
    danger: true,
  });
  if (!ok) return false;
  try {
    await adminBackendJson(opts.url, { method: 'DELETE' });
    await opts.onDone?.();
    return true;
  } catch (e) {
    alert(e instanceof AdminBackendRequestError ? e.message : 'Не удалось удалить');
    return false;
  }
}
