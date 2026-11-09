'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { adminConfirmDelete } from '@/lib/adminConfirmDelete';
import { formatAdminDateTime, formatAdminMoney } from '@/lib/adminFormat';
import type {
  AdminRetailUserDetail,
  AdminRetailUserQuiz,
} from '@/lib/adminUserTypes';
import type { AdminUserGroup, AdminUserGroupListResponse } from '@/lib/adminUserGroupTypes';
import { orderStatusLabel } from '@/lib/orderStatusLabels';
import {
  formatPhoneE164,
  formatPhoneInputValue,
  isValidEmail,
  isValidPhone,
  ruPhoneDigits,
} from '@/lib/phone';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

type ProfileForm = {
  email: string;
  displayName: string;
  phone: string;
  birthday: string;
};

type ProfileFieldErrors = {
  email?: string;
  phone?: string;
  birthday?: string;
};

function profileFromUser(u: AdminRetailUserDetail): ProfileForm {
  return {
    email: u.email,
    displayName: u.displayName?.trim() || '',
    phone: u.phone ? formatPhoneInputValue(u.phone) : '',
    birthday: u.birthday ?? '',
  };
}

const ORDERS_LIMIT = 50;

const AGE_LABELS: Record<string, string> = {
  young: 'До 30',
  mature: '30+',
};

const YES_NO_LABELS: Record<string, string> = {
  yes: 'Да',
  no: 'Нет',
};

const ISSUE_LABELS: Record<string, string> = {
  comedones: 'Комедоны',
  blackheads: 'Чёрные точки',
  clear_skin: 'Чистая кожа',
};

const TASK_LABELS: Record<string, string> = {
  sensitivity: 'Чувствительность',
  dryness: 'Сухость',
  wrinkles: 'Морщины',
  post_acne: 'Постакне',
  dark_circles: 'Тёмные круги',
  good_skin: 'Хорошее состояние',
};

function formatAddressLine(a: {
  city: string;
  address: string;
  apartment: string | null;
  region: string | null;
  district: string | null;
  postalCode: string | null;
}): string {
  return [
    a.region,
    a.city,
    a.district,
    a.address,
    a.apartment ? `кв./оф. ${a.apartment}` : null,
    a.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
}

function labelOf(id: string | null | undefined, map: Record<string, string>): string {
  if (!id) return '—';
  return map[id] ?? id;
}

function listLabels(ids: string[] | undefined, map: Record<string, string>): string {
  if (!ids?.length) return '—';
  return ids.map((id) => map[id] ?? id).join(', ');
}

function quizHasData(quiz: AdminRetailUserQuiz | undefined): boolean {
  if (!quiz) return false;
  return Boolean(quiz.saved) || quiz.stats.eventsCount > 0;
}

export function UserDetailClient({ userId }: { userId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<'info' | 'orders' | 'quiz'>('info');
  const [ordersPage, setOrdersPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AdminRetailUserDetail | null>(null);
  const [assignableGroups, setAssignableGroups] = useState<AdminUserGroup[]>([]);
  const [groupSaving, setGroupSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileForm | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<ProfileFieldErrors>({});
  const [profileError, setProfileError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const sp = new URLSearchParams({
        ordersPage: String(ordersPage),
        ordersLimit: String(ORDERS_LIMIT),
      });
      const row = await adminBackendJson<AdminRetailUserDetail>(
        `users/admin/${userId}?${sp}`,
      );
      setUser(row);
      setProfile(profileFromUser(row));
      setProfileErrors({});
      setProfileError(null);
    } catch (e) {
      setUser(null);
      setProfile(null);
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [userId, ordersPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await adminBackendJson<AdminUserGroupListResponse>(
          'user-groups/admin?limit=100&active=1',
        );
        setAssignableGroups(res.items.filter((g) => g.assignable));
      } catch {
        setAssignableGroups([]);
      }
    })();
  }, []);

  async function onGroupChange(nextGroupId: string) {
    setGroupSaving(true);
    try {
      await adminBackendJson(`users/admin/${userId}/group`, {
        method: 'PATCH',
        body: JSON.stringify({
          groupId: nextGroupId === '' ? null : nextGroupId,
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось сменить группу');
    } finally {
      setGroupSaving(false);
    }
  }

  const profileDirty = useMemo(() => {
    if (!user || !profile) return false;
    const base = profileFromUser(user);
    return (
      profile.email.trim() !== base.email.trim() ||
      profile.displayName.trim() !== base.displayName.trim() ||
      formatPhoneE164(profile.phone) !== formatPhoneE164(base.phone) ||
      (profile.birthday || '') !== (base.birthday || '')
    );
  }, [user, profile]);

  function validateProfile(form: ProfileForm): ProfileFieldErrors {
    const next: ProfileFieldErrors = {};
    const email = form.email.trim();
    if (!email) next.email = 'Укажите email';
    else if (!isValidEmail(email)) next.email = 'Укажите корректный email';
    if (form.phone.trim() && !isValidPhone(form.phone)) {
      next.phone = 'Укажите корректный телефон';
    }
    if (form.birthday.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(form.birthday.trim())) {
      next.birthday = 'Некорректная дата';
    }
    return next;
  }

  async function onSaveProfile() {
    if (!profile) return;
    const fieldErrors = validateProfile(profile);
    setProfileErrors(fieldErrors);
    setProfileError(null);
    if (Object.keys(fieldErrors).length > 0) return;

    setProfileSaving(true);
    try {
      await adminBackendJson(`users/admin/${userId}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({
          email: profile.email.trim(),
          displayName: profile.displayName.trim() || null,
          phone: profile.phone.trim() ? formatPhoneE164(profile.phone) : null,
          birthday: profile.birthday.trim() || null,
        }),
      });
      setProfileErrors({});
      await load();
    } catch (e) {
      setProfileError(
        e instanceof AdminBackendRequestError
          ? e.message
          : 'Не удалось сохранить профиль',
      );
    } finally {
      setProfileSaving(false);
    }
  }

  function onResetProfile() {
    if (!user) return;
    setProfile(profileFromUser(user));
    setProfileErrors({});
    setProfileError(null);
  }

  async function onDelete() {
    const ok = await adminConfirmDelete({
      message:
        'Удалить пользователя? Аккаунт будет деактивирован и обезличен. Заказы сохранятся.',
      url: `users/admin/${userId}`,
    });
    if (ok) {
      router.push('/admin/users');
      router.refresh();
    }
  }

  if (loading && !user) return <p className={styles.muted}>Загрузка пользователя…</p>;
  if (error || !user) {
    return (
      <>
        <p className={styles.backRow}>
          <AdminCompactBtnLink href="/admin/users" variant="outline">
            ← К списку
          </AdminCompactBtnLink>
        </p>
        <p className={styles.error} role="alert">
          {error ?? 'Не найден'}
        </p>
      </>
    );
  }

  const quiz = user.quiz;
  const saved = quiz?.saved ?? null;

  return (
    <>
      <p className={styles.backRow}>
        <AdminCompactBtnLink href="/admin/users" variant="outline">
          ← К списку
        </AdminCompactBtnLink>
      </p>
      <div className={styles.detailTitleRow}>
        <h1 className={styles.title}>{user.displayName?.trim() || user.email}</h1>
        <div className={styles.detailTitleActions}>
          <AdminCompactBtn type="button" variant="danger" onClick={() => void onDelete()}>
            Удалить
          </AdminCompactBtn>
        </div>
      </div>

      <AdminTabs
        ariaLabel="Разделы пользователя"
        variant="underline"
        activeId={tab}
        onChange={(id) => setTab(id as 'info' | 'orders' | 'quiz')}
        items={[
          { id: 'info', label: 'Инфо' },
          { id: 'orders', label: `Заказы (${user.orderCount})` },
          {
            id: 'quiz',
            label: quizHasData(quiz) ? 'Квиз' : 'Квиз (нет)',
          },
        ]}
      />

      {tab === 'info' ? (
        <>
          <dl className={styles.detailDl}>
            <div className={styles.detailDlRow}>
              <dt>Имя</dt>
              <dd>
                <AdminTextField
                  value={profile?.displayName ?? ''}
                  disabled={profileSaving}
                  autoComplete="name"
                  onChange={(e) =>
                    setProfile((p) => (p ? { ...p, displayName: e.target.value } : p))
                  }
                />
              </dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Телефон</dt>
              <dd>
                <AdminTextField
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={profile?.phone ?? ''}
                  disabled={profileSaving}
                  error={profileErrors.phone}
                  onChange={(e) =>
                    setProfile((p) =>
                      p ? { ...p, phone: formatPhoneInputValue(e.target.value) } : p,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key !== 'Backspace' || !profile) return;
                    const digits = ruPhoneDigits(profile.phone);
                    if (digits.length <= 1) {
                      e.preventDefault();
                      setProfile((p) => (p ? { ...p, phone: '' } : p));
                    }
                  }}
                  onBlur={() => {
                    if (!profile?.phone.trim()) return;
                    const next = formatPhoneInputValue(profile.phone);
                    if (next !== profile.phone) {
                      setProfile((p) => (p ? { ...p, phone: next } : p));
                    }
                  }}
                />
              </dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Дата рождения</dt>
              <dd>
                <AdminTextField
                  type="date"
                  value={profile?.birthday ?? ''}
                  disabled={profileSaving}
                  error={profileErrors.birthday}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) =>
                    setProfile((p) => (p ? { ...p, birthday: e.target.value } : p))
                  }
                />
              </dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Email</dt>
              <dd>
                <AdminTextField
                  type="email"
                  autoComplete="email"
                  value={profile?.email ?? ''}
                  disabled={profileSaving}
                  error={profileErrors.email}
                  onChange={(e) => {
                    setProfile((p) => (p ? { ...p, email: e.target.value } : p));
                    if (profileErrors.email) {
                      setProfileErrors((prev) => ({ ...prev, email: undefined }));
                    }
                  }}
                />
              </dd>
            </div>
            {(profileDirty || profileError) && (
              <div className={styles.detailFormActions}>
                <AdminCompactBtn
                  type="button"
                  variant="accent"
                  disabled={profileSaving || !profileDirty}
                  onClick={() => void onSaveProfile()}
                >
                  {profileSaving ? 'Сохранение…' : 'Сохранить'}
                </AdminCompactBtn>
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  disabled={profileSaving || !profileDirty}
                  onClick={onResetProfile}
                >
                  Отменить
                </AdminCompactBtn>
              </div>
            )}
            {profileError ? (
              <p className={styles.error} role="alert">
                {profileError}
              </p>
            ) : null}
            <div className={styles.detailDlRow}>
              <dt>Группа</dt>
              <dd>
                <select
                  className={styles.input}
                  disabled={groupSaving}
                  value={user.groupId ?? ''}
                  onChange={(e) => void onGroupChange(e.target.value)}
                >
                  <option value="">Розница (зарег.) — по умолчанию</option>
                  {assignableGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Поздравления</dt>
              <dd>{user.marketingConsent ? 'Да' : 'Нет'}</dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Маркетинг</dt>
              <dd>
                {user.marketingConsent
                  ? `Согласие${
                      user.marketingConsentAt
                        ? ` · ${formatAdminDateTime(user.marketingConsentAt)}`
                        : ''
                    }`
                  : 'Нет'}
              </dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Подписка (форма Home)</dt>
              <dd>
                {user.newsletter?.active
                  ? [
                      'Да',
                      user.newsletter.name ? `ФИО: ${user.newsletter.name}` : null,
                      `источник: ${user.newsletter.source}`,
                      `с ${formatAdminDateTime(user.newsletter.subscribedAt)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : user.newsletter
                    ? `Отписан${
                        user.newsletter.unsubscribedAt
                          ? ` · ${formatAdminDateTime(user.newsletter.unsubscribedAt)}`
                          : ''
                      }`
                    : 'Нет'}
              </dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Согласие на ПДн</dt>
              <dd>
                {user.privacyConsentAt
                  ? formatAdminDateTime(user.privacyConsentAt)
                  : '—'}
              </dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Регистрация</dt>
              <dd>{formatAdminDateTime(user.createdAt)}</dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Заказов</dt>
              <dd>{user.orderCount}</dd>
            </div>
          </dl>

          <h2 className={styles.sectionTitle}>Доставка</h2>
          {user.addresses.length === 0 ? (
            <p className={styles.muted}>Адресов нет</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Адрес</th>
                  <th>Получатель</th>
                  <th>Телефон</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {user.addresses.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {formatAddressLine(a)}
                      {a.comment ? (
                        <>
                          <br />
                          <span className={styles.mutedInline}>{a.comment}</span>
                        </>
                      ) : null}
                    </td>
                    <td>{a.recipientName?.trim() || '—'}</td>
                    <td>{a.phone?.trim() || '—'}</td>
                    <td className={styles.mutedInline}>
                      {a.isDefault ? 'по умолчанию' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}

      {tab === 'orders' ? (
        <div className={styles.tabPanel}>
          {user.orders.length === 0 ? (
            <p className={styles.muted}>Заказов пока нет</p>
          ) : (
            <>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Номер</th>
                    <th>Статус</th>
                    <th>Сумма</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {user.orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/admin/orders/${o.id}`}>{o.number}</Link>
                      </td>
                      <td>{orderStatusLabel(o.status)}</td>
                      <td>{formatAdminMoney(o.total)}</td>
                      <td className={styles.mutedInline}>
                        {formatAdminDateTime(o.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <AdminListPagination
                page={user.ordersPage}
                total={user.ordersTotal}
                limit={user.ordersLimit}
                onPageChange={setOrdersPage}
                disabled={loading}
              />
            </>
          )}
        </div>
      ) : null}

      {tab === 'quiz' ? (
        <div className={styles.tabPanel}>
          {!quizHasData(quiz) ? (
            <p className={styles.muted}>
              Нет сохранённого результата и событий квиза с привязкой к аккаунту.
            </p>
          ) : (
            <>
              <h2 className={styles.sectionTitle}>Последний результат</h2>
              {!saved ? (
                <p className={styles.muted}>В ЛК результат ещё не сохранён.</p>
              ) : (
                <dl className={styles.detailDl}>
                  <div className={styles.detailDlRow}>
                    <dt>Завершён</dt>
                    <dd>{formatAdminDateTime(saved.completedAt)}</dd>
                  </div>
                  <div className={styles.detailDlRow}>
                    <dt>Зона</dt>
                    <dd>{saved.zone}</dd>
                  </div>
                  <div className={styles.detailDlRow}>
                    <dt>Возраст</dt>
                    <dd>{labelOf(saved.answers.skin_age, AGE_LABELS)}</dd>
                  </div>
                  <div className={styles.detailDlRow}>
                    <dt>SPF ежедневно</dt>
                    <dd>{labelOf(saved.answers.spf, YES_NO_LABELS)}</dd>
                  </div>
                  <div className={styles.detailDlRow}>
                    <dt>Проблемы кожи</dt>
                    <dd>{listLabels(saved.answers.skin_issues, ISSUE_LABELS)}</dd>
                  </div>
                  <div className={styles.detailDlRow}>
                    <dt>Задачи ухода</dt>
                    <dd>{listLabels(saved.answers.skin_tasks, TASK_LABELS)}</dd>
                  </div>
                  <div className={styles.detailDlRow}>
                    <dt>Отёчность</dt>
                    <dd>{labelOf(saved.answers.swelling, YES_NO_LABELS)}</dd>
                  </div>
                  <div className={styles.detailDlRow}>
                    <dt>Приоритет</dt>
                    <dd>{saved.result.priority ?? '—'}</dd>
                  </div>
                  <div className={styles.detailDlRow}>
                    <dt>Блоки результата</dt>
                    <dd>
                      {saved.result.blockKeys.length
                        ? saved.result.blockKeys.join(', ')
                        : '—'}
                    </dd>
                  </div>
                </dl>
              )}

              <h2 className={styles.sectionTitle}>События / воронка</h2>
              <dl className={styles.detailDl}>
                <div className={styles.detailDlRow}>
                  <dt>Событий</dt>
                  <dd>{quiz.stats.eventsCount}</dd>
                </div>
                <div className={styles.detailDlRow}>
                  <dt>Сессий</dt>
                  <dd>{quiz.stats.sessionsCount}</dd>
                </div>
                <div className={styles.detailDlRow}>
                  <dt>Последняя активность</dt>
                  <dd>
                    {quiz.stats.lastActivityAt
                      ? formatAdminDateTime(quiz.stats.lastActivityAt)
                      : '—'}
                  </dd>
                </div>
                <div className={styles.detailDlRow}>
                  <dt>Зона (из событий)</dt>
                  <dd>{quiz.stats.lastZone ?? '—'}</dd>
                </div>
              </dl>

              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Шаг</th>
                    <th>Просмотр</th>
                    <th>Завершение</th>
                  </tr>
                </thead>
                <tbody>
                  {quiz.funnel.map((step) => (
                    <tr key={step.key}>
                      <td>
                        {step.label}
                        {step.zone ? (
                          <>
                            {' '}
                            <span className={styles.mutedInline}>({step.zone})</span>
                          </>
                        ) : null}
                      </td>
                      <td>{step.viewed ? 'да' : '—'}</td>
                      <td>{step.completed ? 'да' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
