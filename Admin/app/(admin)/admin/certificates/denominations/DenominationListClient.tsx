'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { adminConfirm } from '@/components/admin/AdminModal/adminConfirm';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import {
  AdminSortableTable,
  DragHandleCell,
} from '@/components/admin/AdminSortableTable/AdminSortableTable';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import {
  ProductGalleryEditor,
  type GalleryImage,
} from '@/app/(admin)/admin/catalog/products/ProductGalleryEditor';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminMoney } from '@/lib/adminFormat';
import type { AdminGiftDenomination } from '@/lib/adminGiftCertificateTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

type EditDraft = {
  name: string;
  faceValue: string;
  validityDays: string;
  active: boolean;
};

function toGalleryImages(row: AdminGiftDenomination): GalleryImage[] {
  return (row.images ?? []).map((img) => ({
    id: img.id,
    url: img.url,
    sortOrder: img.sortOrder,
    mediaType: img.mediaType === 'video' ? 'video' : 'image',
  }));
}

function coverUrl(row: AdminGiftDenomination): string | null {
  const imgs = row.images ?? [];
  const first = [...imgs].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return first?.url ?? null;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DenominationListClient({
  createOpen,
  onCreateOpenChange,
}: {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<AdminGiftDenomination[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [editImages, setEditImages] = useState<GalleryImage[]>([]);

  const [name, setName] = useState('');
  const [faceValue, setFaceValue] = useState('1000');
  const [validityDays, setValidityDays] = useState('365');
  const [active, setActive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminBackendJson<AdminGiftDenomination[]>(
        'gift-certificates/admin/denominations',
      );
      setRows(data);
      return data;
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
      setRows([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetCreateForm() {
    setName('');
    setFaceValue('1000');
    setValidityDays('365');
    setActive(true);
  }

  function closeCreate() {
    onCreateOpenChange(false);
    resetCreateForm();
  }

  function startEdit(row: AdminGiftDenomination) {
    setEditingId(row.id);
    setDraft({
      name: row.name,
      faceValue: String(row.faceValue),
      validityDays: row.validityDays != null ? String(row.validityDays) : '',
      active: row.active,
    });
    setEditImages(toGalleryImages(row));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setEditImages([]);
  }

  function onGalleryChange(next: GalleryImage[]) {
    setEditImages(next);
    if (!editingId) return;
    setRows((prev) =>
      prev.map((r) =>
        r.id === editingId
          ? {
              ...r,
              images: next.map((img) => ({
                id: img.id,
                url: img.url,
                sortOrder: img.sortOrder,
                mediaType: img.mediaType,
              })),
            }
          : r,
      ),
    );
  }

  async function onCreate() {
    setSaving(true);
    setError(null);
    try {
      const fv = Math.floor(Number(faceValue));
      const vdRaw = validityDays.trim();
      const body: Record<string, unknown> = {
        name: name.trim() || `${fv} ₽`,
        faceValue: fv,
        active,
      };
      if (vdRaw) body.validityDays = Math.floor(Number(vdRaw));
      else body.validityDays = null;

      const created = await adminBackendJson<AdminGiftDenomination>(
        'gift-certificates/admin/denominations',
        { method: 'POST', body: JSON.stringify(body) },
      );
      setFlash('Номинал создан — можно добавить галерею');
      window.setTimeout(() => setFlash(null), 3000);
      closeCreate();
      await load();
      startEdit(created);
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Ошибка создания');
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(row: AdminGiftDenomination) {
    if (!draft) return;
    const fv = Math.floor(Number(draft.faceValue));
    if (!Number.isFinite(fv) || fv < 1) {
      setError('Сумма: целое ≥ 1');
      return;
    }
    const nm = draft.name.trim();
    if (!nm) {
      setError('Укажите название');
      return;
    }
    const certCount = row._count?.certificates ?? 0;
    if (fv !== row.faceValue && certCount > 0) {
      const ok = await adminConfirm({
        title: 'Изменить номинал',
        message: `У номинала уже ${certCount} сертификат(ов). Их номинал не изменится — обновится только шаблон для новых выпусков и покупок. Продолжить?`,
        confirmLabel: 'Продолжить',
      });
      if (!ok) return;
    }

    setSaving(true);
    setError(null);
    try {
      const vdRaw = draft.validityDays.trim();
      const body: Record<string, unknown> = {
        name: nm,
        faceValue: fv,
        active: draft.active,
        validityDays: vdRaw ? Math.floor(Number(vdRaw)) : null,
      };
      const res = await adminBackendJson<AdminGiftDenomination & { warning?: string | null }>(
        `gift-certificates/admin/denominations/${row.id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      setFlash(res.warning || 'Номинал сохранён');
      window.setTimeout(() => setFlash(null), 4000);
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: AdminGiftDenomination) {
    const ok = await adminConfirm({
      title: 'Удалить номинал',
      message: `Удалить номинал «${row.name}»? Если есть сертификаты — только выключится.`,
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminBackendJson<{
        ok: true;
        deleted: boolean;
        deactivated: boolean;
      }>(`gift-certificates/admin/denominations/${row.id}`, {
        method: 'DELETE',
      });
      if (res.deactivated) {
        setFlash(
          `Номинал «${row.name}» выключен (есть выпущенные сертификаты). Удалить нельзя.`,
        );
      } else if (res.deleted) {
        setFlash(`Номинал «${row.name}» удалён`);
      }
      window.setTimeout(() => setFlash(null), 3500);
      if (editingId === row.id) cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Ошибка удаления');
    } finally {
      setSaving(false);
    }
  }

  async function onReorder(orderedIds: string[]) {
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      return orderedIds
        .map((id, sortOrder) => {
          const row = byId.get(id);
          return row ? { ...row, sortOrder } : null;
        })
        .filter(Boolean) as AdminGiftDenomination[];
    });
    try {
      await adminBackendJson('gift-certificates/admin/denominations/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      });
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось сохранить порядок');
      await load();
    }
  }

  return (
    <>
      <p className={styles.lead}>
        Шаблоны для ручного выпуска и покупки на сайте. Галерея показывается на
        странице /certificates. Уже выпущенные сертификаты хранят свой номинал
        (snapshot) — смена суммы шаблона влияет только на новые выпуски.
      </p>
      {flash ? (
        <p className={styles.lead} style={{ color: '#1f6b36' }}>
          {flash}
        </p>
      ) : null}

      <AdminListShell
        loading={loading}
        error={error}
        onRetry={() => void load()}
        loadingLabel="Загрузка…"
        empty="Номиналов пока нет"
        isEmpty={!loading && rows.length === 0}
        wrapContent={false}
      >
        <AdminSortableTable
          ids={rows.map((r) => r.id)}
          onReorder={(orderedIds) => void onReorder(orderedIds)}
          head={
            <tr>
              <th style={{ width: 36 }} aria-label="Порядок" />
              <th>Фото</th>
              <th>Название</th>
              <th>Сумма</th>
              <th>Срок, дн.</th>
              <th>Сертификатов</th>
              <th>Статус</th>
              <th />
            </tr>
          }
          renderRow={(id, drag) => {
            const row = rows.find((r) => r.id === id)!;
            const isEdit = editingId === row.id && draft;
            if (isEdit && draft && editingId) {
              return (
                <>
                  <DragHandleCell {...drag} />
                  <td colSpan={7}>
                    <form
                      className={styles.form}
                      style={{ margin: 0 }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit(row);
                      }}
                    >
                      <AdminTextField
                        label="Название"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        required
                      />
                      <AdminTextField
                        label="Сумма, ₽"
                        type="number"
                        min={1}
                        value={draft.faceValue}
                        onChange={(e) =>
                          setDraft({ ...draft, faceValue: e.target.value })
                        }
                        required
                      />
                      <AdminTextField
                        label="Срок, дней (пусто = бессрочно)"
                        type="number"
                        min={1}
                        value={draft.validityDays}
                        onChange={(e) =>
                          setDraft({ ...draft, validityDays: e.target.value })
                        }
                      />
                      <label className={styles.labelCheckboxRow}>
                        <AdminCheckbox
                          checked={draft.active}
                          onChange={(e) =>
                            setDraft({ ...draft, active: e.target.checked })
                          }
                        />
                        Активен
                      </label>
                      <ProductGalleryEditor
                        images={editImages}
                        onChange={onGalleryChange}
                        title="Галерея номинала"
                        acceptVideo
                        api={{
                          uploadPath: `gift-certificates/admin/denominations/${editingId}/images`,
                          reorderPath: `gift-certificates/admin/denominations/${editingId}/images/reorder`,
                          deletePath: (imageId) =>
                            `gift-certificates/admin/denomination-images/${imageId}`,
                        }}
                      />
                      <div className={styles.formActions}>
                        <AdminCompactBtn type="submit" variant="accent" disabled={saving}>
                          Сохранить
                        </AdminCompactBtn>
                        <AdminCompactBtn type="button" disabled={saving} onClick={cancelEdit}>
                          Отмена
                        </AdminCompactBtn>
                      </div>
                    </form>
                  </td>
                </>
              );
            }
            const cover = coverUrl(row);
            return (
              <>
                <DragHandleCell {...drag} />
                <td>
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={styles.productListThumb} src={cover} alt="" />
                  ) : (
                    <span className={styles.productListThumbPh} aria-hidden />
                  )}
                </td>
                <td>{row.name}</td>
                <td>{formatAdminMoney(row.faceValue)}</td>
                <td>{row.validityDays ?? '—'}</td>
                <td>{row._count?.certificates ?? 0}</td>
                <td>{row.active ? 'вкл.' : 'выкл.'}</td>
                <td className={styles.tableCellActions}>
                  <div className={styles.bulkGroup}>
                    <AdminCompactBtn
                      type="button"
                      variant="outline"
                      className={styles.iconDangerBtn}
                      disabled={saving}
                      onClick={() => startEdit(row)}
                      aria-label={`Изменить номинал «${row.name}»`}
                      title="Изменить"
                    >
                      <EditIcon />
                    </AdminCompactBtn>
                    <AdminCompactBtn
                      type="button"
                      variant="danger"
                      className={styles.iconDangerBtn}
                      disabled={saving}
                      onClick={() => void remove(row)}
                      aria-label={`Удалить номинал «${row.name}»`}
                      title="Удалить"
                    >
                      <TrashIcon />
                    </AdminCompactBtn>
                  </div>
                </td>
              </>
            );
          }}
        />
      </AdminListShell>

      <AdminModal
        open={createOpen}
        title="Новый номинал"
        onClose={closeCreate}
        footer={
          <AdminModalActions
            onCancel={closeCreate}
            onConfirm={() => void onCreate()}
            confirmLabel={saving ? 'Создаём…' : 'Создать'}
            confirmDisabled={saving}
          />
        }
      >
        <div className={styles.form} style={{ maxWidth: 'none', margin: 0 }}>
          <AdminTextField
            label="Название"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="1000 ₽"
          />
          <AdminTextField
            label="Сумма, ₽"
            type="number"
            min={1}
            value={faceValue}
            onChange={(e) => setFaceValue(e.target.value)}
            required
          />
          <AdminTextField
            label="Срок действия, дней (пусто = бессрочно)"
            type="number"
            min={1}
            value={validityDays}
            onChange={(e) => setValidityDays(e.target.value)}
          />
          <label className={styles.labelCheckboxRow}>
            <AdminCheckbox checked={active} onChange={(e) => setActive(e.target.checked)} />
            Активен
          </label>
        </div>
      </AdminModal>
    </>
  );
}
