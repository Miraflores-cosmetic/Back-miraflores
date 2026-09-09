import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/getAdminSession';
import { filterSettingsHubLinks } from '@/lib/settingsHub';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import styles from './Settings.module.css';

export default async function AdminSettingsPage() {
  const session = await getAdminSession();
  if (!session.authenticated || !session.staff) {
    redirect('/admin/login');
  }

  /** Hub — только суперадмин; модератор с `settings` ходит по deep link (FAQ, SEO…). */
  if (!session.staff.isSuperAdmin) {
    redirect('/admin');
  }

  const links = filterSettingsHubLinks(session.staff);

  return (
    <div>
      <h1 className={catalogStyles.title}>Настройки</h1>
      {links.length === 0 ? (
        <p className={catalogStyles.lead}>Нет доступных разделов.</p>
      ) : (
        <div className={styles.kpiGrid}>
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.kpi} ${styles.kpiClickable}`}
            >
              <p className={styles.kpiValue}>{item.label}</p>
              {item.aclBadge ? (
                <span className={styles.kpiBadge}>доступ: {item.aclBadge}</span>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
