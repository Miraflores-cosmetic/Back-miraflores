'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
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
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

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

function formatBirthday(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  if (year && month && day) return `${day}.${month}.${year}`;
  return value;
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
    } catch (e) {
      setUser(null);
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
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
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
              <dt>Имя</dt>
              <dd>{user.displayName?.trim() || '—'}</dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Телефон</dt>
              <dd>{user.phone?.trim() || '—'}</dd>
            </div>
            <div className={styles.detailDlRow}>
              <dt>Дата рождения</dt>
              <dd>{formatBirthday(user.birthday)}</dd>
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
