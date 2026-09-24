'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import { adminConfirm } from '@/components/admin/AdminModal/adminConfirm';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import {
  AdminCompactBtn,
  AdminCompactBtnLink,
} from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminModal } from '@/components/admin/AdminModal/AdminModal';
import { AdminTextArea, AdminTextField, AdminSelect } from '@/components/AdminTextField/AdminTextField';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';
import { formatAdminDateTime } from '@/lib/adminFormat';
import styles from '../../Settings.module.css';
import local from '../emailNotifications.module.css';

type Detail = {
  eventKey: string;
  label: string;
  description: string;
  enabled: boolean;
  subject: string;
  body: string;
  defaultSubject: string;
  defaultBody: string;
  variables: { key: string; label: string }[];
  conditionKeys?: string[];
  updatedAt: string | null;
  isCustomized: boolean;
  lastEditedByEmail?: string | null;
  lastEditedAt?: string | null;
};

type RevisionItem = {
  id: string;
  subject: string;
  body: string;
  enabled: boolean;
  actorEmail: string | null;
  createdAt: string;
};

type PreviewMail = {
  subject: string;
  text: string;
  html: string;
};

type FocusTarget = 'subject' | 'body';
type PreviewTab = 'html' | 'text';

function dedupeVars(vars: { key: string; label: string }[]) {
  const seen = new Set<string>();
  return vars.filter((v) => {
    if (seen.has(v.key)) return false;
    seen.add(v.key);
    return true;
  });
}

export function EmailNotificationEditClient({ eventKey }: { eventKey: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [revisions, setRevisions] = useState<RevisionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [varsOpen, setVarsOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('html');
  const [preview, setPreview] = useState<PreviewMail | null>(null);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [testConfirmOpen, setTestConfirmOpen] = useState(false);
  const [sampleVariant, setSampleVariant] = useState<'full' | 'sparse'>('full');
  const [moreOpen, setMoreOpen] = useState(false);
  const focusRef = useRef<FocusTarget>('body');
  const subjectElRef = useRef<HTMLInputElement | null>(null);
  const bodyElRef = useRef<HTMLTextAreaElement | null>(null);
  const moreWrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, rev] = await Promise.all([
        adminBackendJson<Detail>(
          `settings/admin/email-notifications/${encodeURIComponent(eventKey)}`,
        ),
        adminBackendJson<RevisionItem[]>(
          `settings/admin/email-notifications/${encodeURIComponent(eventKey)}/revisions`,
        ).catch(() => [] as RevisionItem[]),
      ]);
      setDetail(data);
      setRevisions(Array.isArray(rev) ? rev : []);
      setEnabled(data.enabled);
      setSubject(data.subject);
      setBody(data.body);
      setDirty(false);
    } catch (e) {
      setError(
        e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки',
      );
      setDetail(null);
      setRevisions([]);
    } finally {
      setLoading(false);
    }
  }, [eventKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (
        moreWrapRef.current &&
        !moreWrapRef.current.contains(e.target as Node)
      ) {
        setMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  function markDirty() {
    setDirty(true);
  }

  function insertAtFocus(token: string) {
    const target = focusRef.current;
    if (target === 'subject') {
      const el = subjectElRef.current;
      if (el) {
        const start = el.selectionStart ?? subject.length;
        const end = el.selectionEnd ?? start;
        const next = subject.slice(0, start) + token + subject.slice(end);
        setSubject(next);
        markDirty();
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + token.length;
          el.setSelectionRange(pos, pos);
        });
        return;
      }
      setSubject((s) => s + token);
      markDirty();
      return;
    }
    const el = bodyElRef.current;
    if (el) {
      const start = el.selectionStart ?? body.length;
      const end = el.selectionEnd ?? start;
      const next = body.slice(0, start) + token + body.slice(end);
      setBody(next);
      markDirty();
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
      return;
    }
    setBody((b) => b + token);
    markDirty();
  }

  function insertVariable(key: string) {
    insertAtFocus(`{{${key}}}`);
  }

  function insertIfBlock(key: string) {
    const open = `{{#if ${key}}}\n`;
    const close = `\n{{/if}}`;
    focusRef.current = 'body';
    const el = bodyElRef.current;
    if (el) {
      const start = el.selectionStart ?? body.length;
      const end = el.selectionEnd ?? start;
      const selected = body.slice(start, end);
      const next =
        body.slice(0, start) + open + selected + close + body.slice(end);
      setBody(next);
      markDirty();
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + open.length + selected.length;
        el.setSelectionRange(pos, pos);
      });
      return;
    }
    setBody((b) => b + open + close);
    markDirty();
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || saving) return;
    setSaving(true);
    setError(null);
    try {
      const data = await adminBackendJson<Detail>(
        `settings/admin/email-notifications/${encodeURIComponent(eventKey)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, subject, body }),
        },
      );
      setDetail(data);
      setEnabled(data.enabled);
      setSubject(data.subject);
      setBody(data.body);
      setDirty(false);
      const rev = await adminBackendJson<RevisionItem[]>(
        `settings/admin/email-notifications/${encodeURIComponent(eventKey)}/revisions`,
      ).catch(() => [] as RevisionItem[]);
      setRevisions(Array.isArray(rev) ? rev : []);
      showToast('Сохранено');
    } catch (err) {
      showToast(
        err instanceof AdminBackendRequestError
          ? err.message
          : 'Ошибка сохранения',
      );
    } finally {
      setSaving(false);
    }
  }

  async function onPreview() {
    if (previewing) return;
    setPreviewing(true);
    try {
      const data = await adminBackendJson<PreviewMail>(
        `settings/admin/email-notifications/${encodeURIComponent(eventKey)}/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, body, sampleVariant }),
        },
      );
      setPreview(data);
      setPreviewTab('html');
      setPreviewOpen(true);
    } catch (err) {
      showToast(
        err instanceof AdminBackendRequestError
          ? err.message
          : 'Не удалось построить превью',
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function runTestSend() {
    if (testing) return;
    setTesting(true);
    setTestConfirmOpen(false);
    try {
      const res = await adminBackendJson<{ ok: true; to: string }>(
        `settings/admin/email-notifications/${encodeURIComponent(eventKey)}/test-send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, body, sampleVariant }),
        },
      );
      showToast(`Тест отправлен на ${res.to}`);
    } catch (err) {
      showToast(
        err instanceof AdminBackendRequestError
          ? err.message
          : 'Не удалось отправить тест',
      );
    } finally {
      setTesting(false);
    }
  }

  async function resetDefaults() {
    if (!detail) return;
    setMoreOpen(false);
    const ok = await adminConfirm({
      title: 'Текст по умолчанию',
      message:
        'Подставить текст по умолчанию? Несохранённые правки темы и сообщения будут заменены.',
      confirmLabel: 'Подставить',
    });
    if (!ok) return;
    setSubject(detail.defaultSubject);
    setBody(detail.defaultBody);
    markDirty();
  }

  async function confirmLeave(): Promise<boolean> {
    if (!dirty) return true;
    return adminConfirm({
      title: 'Несохранённые изменения',
      message: 'Есть несохранённые изменения. Уйти без сохранения?',
      confirmLabel: 'Уйти',
      danger: true,
    });
  }

  async function onCancel() {
    if (!(await confirmLeave())) return;
    router.push('/admin/settings/email-notifications');
  }

  if (loading) {
    return <p className={catalogStyles.lead}>Загрузка…</p>;
  }

  if (error && !detail) {
    return (
      <div className={local.page}>
        <p className={catalogStyles.error} role="alert">
          {error}{' '}
          <AdminCompactBtn type="button" variant="outline" onClick={() => void load()}>
            Повторить
          </AdminCompactBtn>
        </p>
        <Link href="/admin/settings/email-notifications">← К списку</Link>
      </div>
    );
  }

  if (!detail) return null;

  const allVars = dedupeVars(detail.variables);
  const conditionSet = new Set(
    detail.conditionKeys?.length
      ? detail.conditionKeys
      : allVars.map((v) => v.key).filter((k) =>
          [
            'order.tracking',
            'order.tracking_block',
            'order.pay_url',
            'order.items_text',
            'order.items_html',
            'order.subtotal_label',
            'order.shipping_label',
            'order.discount_label',
            'order.gift_label',
            'order.totals_block',
            'order.changes_summary',
            'order.refund_intro',
            'order.refund_label',
            'gift.items_text',
            'gift.items_html',
            'gift.buyer_email',
            'gift.recipient_email',
          ].includes(k),
        ),
  );

  return (
    <div className={local.page}>
      <form onSubmit={(e) => void onSave(e)}>
        <div className={pn.stickyToolbar}>
          <div className={pn.stickyToolbarMain}>
            <div className={pn.stickyToolbarNav}>
              <AdminCompactBtnLink
                href="/admin/settings/email-notifications"
                variant="outline"
                onClick={(e) => {
                  if (!dirty) return;
                  e.preventDefault();
                  void onCancel();
                }}
              >
                ← Email-уведомления
              </AdminCompactBtnLink>
              {dirty ? (
                <span className={pn.dirtyHintInline}>Несохранённые изменения</span>
              ) : null}
            </div>
            <h1 className={pn.stickyToolbarTitle}>{detail.label}</h1>
            <p className={catalogStyles.muted} style={{ margin: '4px 0 0' }}>
              {detail.description}
            </p>
          </div>
          <div className={pn.stickyToolbarActions}>
            <AdminCompactBtn
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onCancel}
            >
              Отмена
            </AdminCompactBtn>
            <AdminCompactBtn
              type="button"
              variant="outline"
              disabled={previewing || saving}
              onClick={() => void onPreview()}
            >
              {previewing ? 'Превью…' : 'Предпросмотр'}
            </AdminCompactBtn>
            <div className={local.moreWrap} ref={moreWrapRef}>
              <AdminCompactBtn
                type="button"
                variant="neutral"
                disabled={saving || testing}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => setMoreOpen((v) => !v)}
              >
                Ещё
              </AdminCompactBtn>
              {moreOpen ? (
                <div className={local.moreMenu} role="menu">
                  <button
                    type="button"
                    className={local.moreItem}
                    role="menuitem"
                    disabled={testing || saving}
                    onClick={() => {
                      setMoreOpen(false);
                      setTestConfirmOpen(true);
                    }}
                  >
                    {testing ? 'Отправка…' : 'Отправить тест мне'}
                  </button>
                  <button
                    type="button"
                    className={local.moreItem}
                    role="menuitem"
                    disabled={saving}
                    onClick={resetDefaults}
                  >
                    Сбросить к умолчанию
                  </button>
                </div>
              ) : null}
            </div>
            <AdminCompactBtn
              type="submit"
              variant="accent"
              disabled={saving || !dirty}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </AdminCompactBtn>
          </div>
        </div>

        <div className={local.headMeta} style={{ marginBottom: 16 }}>
          <span className={enabled ? local.badgeOn : local.badgeOff}>
            {enabled ? 'Шлётся' : 'Не шлётся'}
          </span>
          {detail.isCustomized ? (
            <span className={local.badgeCustom}>изменён</span>
          ) : (
            <span className={catalogStyles.mutedInline}>по умолчанию</span>
          )}
          {detail.lastEditedByEmail || detail.lastEditedAt ? (
            <span className={local.listMuted}>
              Изменил: {detail.lastEditedByEmail || '—'}
              {detail.lastEditedAt
                ? ` · ${formatAdminDateTime(detail.lastEditedAt)}`
                : ''}
            </span>
          ) : null}
        </div>

        <div className={local.layout}>
          <div className={local.main}>
            <div className={catalogStyles.labelCheckboxRow}>
              <AdminCheckbox
                id="email-notif-enabled"
                className={catalogStyles.adminCheckboxForm}
                checked={enabled}
                onChange={(e) => {
                  const next = e.target.checked;
                  if (!next && enabled) {
                    setDisableConfirmOpen(true);
                    return;
                  }
                  setEnabled(next);
                  markDirty();
                }}
                disabled={saving}
              />
              <label htmlFor="email-notif-enabled">
                Отправлять это письмо покупателям
              </label>
            </div>
            <p className={catalogStyles.muted} style={{ margin: '-6px 0 0' }}>
              Выключено = письмо не уйдёт вовсе (без legacy-fallback). Тема и текст
              сохраняются.
            </p>

            <AdminTextField
              label="Тема"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                markDirty();
              }}
              onFocus={(e) => {
                focusRef.current = 'subject';
                subjectElRef.current = e.currentTarget;
              }}
              disabled={saving}
            />

            <AdminTextArea
              label="Сообщение"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                markDirty();
              }}
              onFocus={(e) => {
                focusRef.current = 'body';
                bodyElRef.current = e.currentTarget;
              }}
              disabled={saving}
              rows={18}
            />

            <p className={catalogStyles.muted} style={{ margin: 0 }}>
              Плейсхолдеры <code>{'{{order.number}}'}</code>. Условия:{' '}
              <code>{'{{#if order.tracking}}…{{/if}}'}</code> — кнопка «#if» в
              справочнике. Rich: <code>{'{{cta.pay}}'}</code>,{' '}
              <code>{'{{block.items}}'}</code>.
            </p>

            <div className={local.formActions}>
              <AdminSelect
                label="Demo-данные"
                value={sampleVariant}
                onChange={(e) =>
                  setSampleVariant(e.target.value as 'full' | 'sparse')
                }
                disabled={previewing || testing || saving}
              >
                <option value="full">Полный пример</option>
                <option value="sparse">Без опциональных (#if пустые)</option>
              </AdminSelect>
            </div>
          </div>

          <aside className={local.aside}>
            <div className={local.asideHead}>
              <p className={styles.settingsEmptyTitle} style={{ margin: 0 }}>
                Справочник переменных
              </p>
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={() => setVarsOpen((v) => !v)}
              >
                {varsOpen ? 'Скрыть' : 'Показать'}
              </AdminCompactBtn>
            </div>
            {varsOpen ? (
              <>
                <p className={catalogStyles.muted} style={{ margin: '8px 0 12px' }}>
                  Клик вставляет <code>{'{{key}}'}</code>. «#if» — обёртку условия
                  в сообщение.
                </p>
                <ul className={local.varList}>
                  {allVars.map((v) => (
                    <li key={v.key} className={local.varRow}>
                      <button
                        type="button"
                        className={local.varBtn}
                        onClick={() => insertVariable(v.key)}
                        title={`Вставить {{${v.key}}}`}
                      >
                        <code>{`{{${v.key}}}`}</code>
                        <span>{v.label}</span>
                      </button>
                      {conditionSet.has(v.key) ? (
                        <button
                          type="button"
                          className={local.ifBtn}
                          onClick={() => insertIfBlock(v.key)}
                          title={`Вставить {{#if ${v.key}}}…{{/if}}`}
                        >
                          #if
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </aside>
        </div>
      </form>

      {revisions.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h2 className={styles.settingsEmptyTitle} style={{ marginBottom: 8 }}>
            История правок
          </h2>
          <p className={catalogStyles.muted} style={{ marginTop: 0 }}>
            Снимки до изменения. Клик восстанавливает тему/текст в редактор (нужно
            сохранить).
          </p>
          <ul className={local.varList}>
            {revisions.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={local.varBtn}
                  onClick={() => {
                    setSubject(r.subject);
                    setBody(r.body);
                    setEnabled(r.enabled);
                    setDirty(true);
                    showToast('Восстановлено в редактор — сохраните, если нужно');
                  }}
                >
                  <code>
                    {formatAdminDateTime(r.createdAt)}
                    {r.actorEmail ? ` · ${r.actorEmail}` : ''}
                  </code>
                  <span>
                    {r.enabled ? 'Вкл.' : 'Выкл.'} · {r.subject.slice(0, 48)}
                    {r.subject.length > 48 ? '…' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <AdminConfirmDialog
        open={disableConfirmOpen}
        title="Выключить письмо?"
        message="Покупатели больше не получат это уведомление. Legacy-fallback тоже не сработает — send полностью глушится. Текст шаблона сохранится."
        confirmLabel="Выключить"
        cancelLabel="Оставить включённым"
        danger
        onConfirm={() => {
          setEnabled(false);
          markDirty();
          setDisableConfirmOpen(false);
        }}
        onCancel={() => setDisableConfirmOpen(false)}
      />

      <AdminConfirmDialog
        open={testConfirmOpen}
        title="Отправить тест себе?"
        message={`На ваш email уйдёт письмо с префиксом [тест]. Подставляются demo-данные (${sampleVariant === 'sparse' ? 'без опциональных полей' : 'полный пример'}), флаг «Шлётся» игнорируется.`}
        confirmLabel="Отправить"
        cancelLabel="Отмена"
        onConfirm={() => void runTestSend()}
        onCancel={() => setTestConfirmOpen(false)}
        confirmDisabled={testing}
      />

      <AdminModal
        open={previewOpen}
        title={`Предпросмотр (${sampleVariant === 'sparse' ? 'без опциональных' : 'полный'})`}
        wide
        onClose={() => setPreviewOpen(false)}
        footer={
          <AdminCompactBtn
            type="button"
            variant="accent"
            onClick={() => setPreviewOpen(false)}
          >
            Закрыть
          </AdminCompactBtn>
        }
      >
        {preview ? (
          <div>
            <p className={local.previewSubject}>
              <span className={catalogStyles.mutedInline}>Тема: </span>
              {preview.subject}
            </p>
            <div className={local.previewTabs} role="tablist" aria-label="Формат превью">
              <button
                type="button"
                role="tab"
                aria-selected={previewTab === 'html'}
                className={`${local.previewTab} ${previewTab === 'html' ? local.previewTabActive : ''}`}
                onClick={() => setPreviewTab('html')}
              >
                HTML
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewTab === 'text'}
                className={`${local.previewTab} ${previewTab === 'text' ? local.previewTabActive : ''}`}
                onClick={() => setPreviewTab('text')}
              >
                Plaintext
              </button>
            </div>
            {previewTab === 'html' ? (
              /* Preview: plain+snippets only. sandbox="" blocks script/same-origin. */
              <iframe
                title="Превью HTML"
                className={local.previewFrame}
                srcDoc={preview.html}
                sandbox=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <pre className={local.previewPlain}>{preview.text}</pre>
            )}
          </div>
        ) : null}
      </AdminModal>
    </div>
  );
}
