'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StaffContext } from '@/lib/adminStaffTypes';
import { DEFAULT_STAFF_AVATAR } from './settings/staff/StaffAvatarField';
import {
  ADMIN_NAV,
  filterAdminNav,
  initialOpenGroups,
  isGroupPathActive,
  isNavLinkActive,
  type NavGroupItem,
} from './adminNav';
import { useAdminOrderChatUnreadCount } from '@/hooks/useAdminOrderChatUnreadCount';
import { useAdminUnviewedOrdersCount } from '@/hooks/useAdminUnviewedOrdersCount';
import { staffCanSeeOrdersNav } from '@miraflores/admin-sections';
import styles from './layout.module.css';

function NavChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`${styles.navChevron} ${open ? styles.navChevronOpen : ''}`}
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="6"
      viewBox="0 0 10 6"
      fill="none"
      aria-hidden
    >
      <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function NavGroup({
  item,
  pathname,
  open,
  onToggle,
}: {
  item: NavGroupItem;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.navGroup}>
      <button
        type="button"
        className={`${styles.navLink} ${
          isGroupPathActive(item, pathname) ? styles.navGroupCurrent : ''
        }`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={styles.navLinkLeading}>
          <NavChevron open={open} />
        </span>
        <span className={styles.navLinkLabel}>{item.label}</span>
      </button>
      {open ? (
        <div className={styles.navSub}>
          {item.children.map((child) => {
            const active = isNavLinkActive(pathname, child.href, child.exact);
            return (
              <Link
                key={child.href}
                href={child.href}
                className={`${styles.navLink} ${styles.navSublink} ${
                  active ? styles.navLinkActive : ''
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <span className={styles.navLinkLeading} />
                <span className={styles.navLinkLabel}>{child.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const STAFF_ME_PATH = '/admin/settings/staff/me';

function SidebarProfileMenu({
  profileName,
  avatarSrc,
  roleLabel,
  onLogout,
}: {
  profileName: string;
  avatarSrc: string;
  roleLabel: string;
  onLogout: () => void;
}) {
  const pathname = usePathname() ?? '';
  const profileActive = pathname === STAFF_ME_PATH || pathname.startsWith(`${STAFF_ME_PATH}/`);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.sidebarProfile} ref={rootRef}>
      <button
        type="button"
        className={styles.sidebarProfileTrigger}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <div className={styles.sidebarProfileMain}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarSrc}
            alt={`Аватар: ${profileName}`}
            className={styles.sidebarProfileAvatar}
            width={32}
            height={32}
          />
          <div className={styles.sidebarProfileText}>
            <span className={styles.sidebarProfileName}>{profileName}</span>
            <span className={styles.sidebarProfileRole}>{roleLabel}</span>
          </div>
        </div>
        <svg
          className={`${styles.profileChevron} ${open ? styles.profileChevronOpen : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden
        >
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      {open ? (
        <div className={styles.profileMenu} role="menu">
          <Link
            href={STAFF_ME_PATH}
            role="menuitem"
            className={`${styles.profileMenuItem} ${profileActive ? styles.profileMenuItemActive : ''}`}
            aria-current={profileActive ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            Профиль
          </Link>
          <button
            type="button"
            role="menuitem"
            className={styles.profileMenuItem}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Выйти
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AdminSidebarNav({
  staff,
  email,
}: {
  staff?: StaffContext | null;
  email?: string | null;
}) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [openGroups, setOpenGroups] = useState(() => initialOpenGroups(pathname));

  const visibleNav = useMemo(() => filterAdminNav(ADMIN_NAV, staff), [staff]);

  useEffect(() => {
    // Sync open state to the current route so redirect stubs / foreign URLs
    // do not leave unrelated groups expanded.
    setOpenGroups(initialOpenGroups(pathname));
  }, [pathname]);

  async function logout() {
    const { teardownOrderChatWsForLogout } = await import('@/lib/orderChat/orderChatWsShared');
    teardownOrderChatWsForLogout('admin');
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    router.replace('/admin/login');
    router.refresh();
  }

  const profileName = staff?.staffDisplayName?.trim() || email || 'Админ';
  const avatarSrc = staff?.staffAvatarUrl?.trim() || DEFAULT_STAFF_AVATAR;
  const roleLabel = staff?.isSuperAdmin ? 'Администратор' : 'Модератор';
  const ordersNavVisible =
    !!staff && staffCanSeeOrdersNav(staff.sections, staff.isSuperAdmin);
  const chatUnread = useAdminOrderChatUnreadCount(ordersNavVisible);
  const unviewedOrdersCount = useAdminUnviewedOrdersCount(ordersNavVisible, pathname);

  return (
    <aside className={styles.sidebar}>
      <p className={styles.brand}>
        <Link href="/admin" className={styles.brandLogo}>
          Miraflores
        </Link>
      </p>
      <nav className={styles.nav} aria-label="Админка">
        {visibleNav.map((item, index) => {
          if (item.type === 'divider') {
            return (
              <div
                key={`divider-${index}`}
                className={styles.navDivider}
                role="separator"
              />
            );
          }
          if (item.type === 'link') {
            const active = isNavLinkActive(pathname, item.href, item.exact);
            const showOrdersBadge =
              item.href === '/admin/orders' && unviewedOrdersCount > 0;
            const showOrderChatsBadge =
              item.href === '/admin/orders' && chatUnread.orders > 0;
            const showChatBadge =
              item.href === '/admin/orders/chat' && chatUnread.support > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span className={styles.navLinkLeading} />
                <span className={styles.navLinkLabel}>{item.label}</span>
                {showOrdersBadge ? (
                  <span className={styles.navBadge} aria-label={`Непросмотренных заказов: ${unviewedOrdersCount}`}>
                    {unviewedOrdersCount > 99 ? '99+' : unviewedOrdersCount}
                  </span>
                ) : null}
                {showOrderChatsBadge ? (
                  <span
                    className={`${styles.navBadge} ${styles.navBadgeOutline}`}
                    title="Непрочитанные сообщения в чатах заказов"
                    aria-label={`Непрочитанных в чатах заказов: ${chatUnread.orders}`}
                  >
                    {chatUnread.orders > 99 ? '99+' : chatUnread.orders}
                  </span>
                ) : null}
                {showChatBadge ? (
                  <span
                    className={styles.navBadge}
                    aria-label={`Непрочитанных в чатах поддержки: ${chatUnread.support}`}
                  >
                    {chatUnread.support > 99 ? '99+' : chatUnread.support}
                  </span>
                ) : null}
              </Link>
            );
          }
          return (
            <NavGroup
              key={item.id}
              item={item}
              pathname={pathname}
              open={Boolean(openGroups[item.id])}
              onToggle={() =>
                setOpenGroups((prev) => ({
                  ...prev,
                  [item.id]: !prev[item.id],
                }))
              }
            />
          );
        })}
      </nav>
      <SidebarProfileMenu
        profileName={profileName}
        avatarSrc={avatarSrc}
        roleLabel={roleLabel}
        onLogout={() => void logout()}
      />
    </aside>
  );
}
