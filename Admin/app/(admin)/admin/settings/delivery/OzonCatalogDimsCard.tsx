"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminCompactBtn } from "@/components/AdminCompactBtn/AdminCompactBtn";
import { useToast } from "@/components/Toast/ToastProvider";
import catalogStyles from "@/app/(admin)/admin/catalog/catalogAdmin.module.css";
import {
  AdminBackendRequestError,
  adminBackendJson,
} from "@/lib/adminBackendFetch";
import {
  buildDimsPatch,
  initialDimsDraft,
  type VariantDimsDraft,
} from "@/lib/shipping/variantDimsEdit";
import styles from "./delivery.module.css";

type EditState = {
  id: string;
  draft: VariantDimsDraft;
  error: string | null;
  saving: boolean;
};

const DRAFT_FIELDS: Array<{ key: keyof VariantDimsDraft; label: string }> = [
  { key: "length", label: "Длина, мм" },
  { key: "width", label: "Ширина, мм" },
  { key: "height", label: "Высота, мм" },
];

type Suggestion = {
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  source: "sibling" | "catalog" | "ladder";
};

type AuditRow = {
  id: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  volumeMl: number | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  issues: string[];
  suggestion: Suggestion | null;
};

type DimsAudit = {
  summary: {
    active: number;
    complete: number;
    missing: number;
    suspicious: number;
    withSuggestion: number;
  };
  rows: AuditRow[];
};

const SOURCE_LABEL: Record<Suggestion["source"], string> = {
  sibling: "как у другого варианта товара",
  catalog: "типично для этого объёма",
  ladder: "оценка по объёму",
};

function dimsText(
  l: number | null,
  w: number | null,
  h: number | null,
): string {
  return l != null && w != null && h != null ? `${l}×${w}×${h}` : "—";
}

/** Вес и габариты вариантов → оплачиваемый вес Ozon. Предложения берутся из самого каталога. */
export function OzonCatalogDimsCard() {
  const { showToast } = useToast();
  const [audit, setAudit] = useState<DimsAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);

  function startEdit(r: AuditRow) {
    setEdit({
      id: r.id,
      draft: initialDimsDraft(r, r.suggestion),
      error: null,
      saving: false,
    });
  }

  function setDraft(key: keyof VariantDimsDraft, value: string) {
    setEdit((e) =>
      e ? { ...e, draft: { ...e.draft, [key]: value }, error: null } : e,
    );
  }

  async function saveEdit(r: AuditRow) {
    if (!edit) return;
    const built = buildDimsPatch(r, edit.draft);
    if ("error" in built) {
      setEdit({ ...edit, error: built.error });
      return;
    }
    setEdit({ ...edit, saving: true, error: null });
    try {
      const data = await adminBackendJson<DimsAudit>(
        `delivery/ozon/admin/catalog-dims/${r.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(built.patch),
        },
      );
      setAudit(data);
      setSelected(
        (prev) =>
          new Set(
            [...prev].filter((id) =>
              data.rows.some((x) => x.id === id && x.suggestion),
            ),
          ),
      );
      setEdit(null);
      const still = data.rows.find((x) => x.id === r.id);
      showToast(
        still
          ? `Сохранено, но осталось: ${still.issues.join(", ")}`
          : `${r.productName}: габариты в порядке`,
      );
    } catch (e) {
      setEdit((cur) =>
        cur && cur.id === r.id
          ? {
              ...cur,
              saving: false,
              error:
                e instanceof AdminBackendRequestError
                  ? e.message
                  : "Не удалось сохранить",
            }
          : cur,
      );
    }
  }

  const load = useCallback(async () => {
    try {
      const data = await adminBackendJson<DimsAudit>(
        "delivery/ozon/admin/catalog-dims",
      );
      setAudit(data);
      setSelected(
        new Set(data.rows.filter((r) => r.suggestion).map((r) => r.id)),
      );
      setError(null);
    } catch (e) {
      setError(
        e instanceof AdminBackendRequestError
          ? e.message
          : "Не удалось загрузить аудит каталога",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (audit ? (showAll ? audit.rows : audit.rows.slice(0, 30)) : []),
    [audit, showAll],
  );
  const suggestable = audit?.rows.filter((r) => r.suggestion) ?? [];

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (!selected.size) return;
    if (
      !window.confirm(
        `Записать вес/габариты в ${selected.size} вариант(ов) каталога?`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await adminBackendJson<{
        updated: number;
        skipped: string[];
      }>("delivery/ozon/admin/catalog-dims/apply", {
        method: "POST",
        body: JSON.stringify({ variantIds: [...selected] }),
      });
      showToast(`Обновлено вариантов: ${res.updated}`);
      await load();
    } catch (e) {
      showToast(
        e instanceof AdminBackendRequestError
          ? e.message
          : "Не удалось применить",
      );
    } finally {
      setBusy(false);
    }
  }

  const pct =
    audit && audit.summary.active
      ? Math.round((audit.summary.complete / audit.summary.active) * 100)
      : null;

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logoMuted}`} aria-hidden>
          кг
        </span>
        <div className={styles.cardHeadText}>
          <h2 className={styles.cardTitle}>Габариты каталога</h2>
          <p className={styles.cardSub}>
            Вес и размеры вариантов определяют оплачиваемый вес Ozon. Пустые и
            ошибочные значения заменяются оценкой по объёму — чем полнее
            каталог, тем точнее цена доставки.
          </p>
        </div>
        {pct != null ? (
          <span
            className={`${styles.pill} ${pct >= 90 ? styles.pillOk : styles.pillIdle}`}
          >
            Заполнено {pct}%
          </span>
        ) : null}
      </header>

      {error ? (
        <div className={catalogStyles.errorBanner} role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {audit ? (
        <>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>Активных вариантов</span>
              <span className={styles.tileValue}>{audit.summary.active}</span>
            </div>
            <div className={`${styles.tile} ${styles.tileGood}`}>
              <span className={styles.tileLabel}>Заполнены корректно</span>
              <span className={styles.tileValue}>{audit.summary.complete}</span>
            </div>
            <div
              className={`${styles.tile} ${audit.summary.missing ? styles.tileBad : ""}`}
            >
              <span className={styles.tileLabel}>Не заполнены</span>
              <span className={styles.tileValue}>{audit.summary.missing}</span>
            </div>
            <div
              className={`${styles.tile} ${audit.summary.suspicious ? styles.tileBad : ""}`}
            >
              <span className={styles.tileLabel}>Подозрительные</span>
              <span className={styles.tileValue}>
                {audit.summary.suspicious}
              </span>
            </div>
          </div>

          {audit.rows.length ? (
            <>
              <div className={styles.toolbarRow}>
                <AdminCompactBtn
                  type="button"
                  variant="accent"
                  disabled={busy || !selected.size}
                  onClick={() => void apply()}
                >
                  {busy
                    ? "Сохраняем…"
                    : `Применить предложения (${selected.size})`}
                </AdminCompactBtn>
                {suggestable.length ? (
                  <AdminCompactBtn
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setSelected(
                        selected.size === suggestable.length
                          ? new Set()
                          : new Set(suggestable.map((r) => r.id)),
                      )
                    }
                  >
                    {selected.size === suggestable.length
                      ? "Снять все"
                      : "Выбрать все"}
                  </AdminCompactBtn>
                ) : null}
                <span className={styles.hint}>
                  Меняются только пустые/ошибочные поля. Проверьте предложения —
                  точные значения лучше взять с весов и линейки и внести через
                  «Править» (вес в граммах, размеры упаковки в мм).
                </span>
              </div>

              <div className={catalogStyles.tableWrap}>
                <table
                  className={`${catalogStyles.table} ${styles.tableCompact}`}
                >
                  <thead>
                    <tr>
                      <th aria-label="Выбрать" />
                      <th>Товар / вариант</th>
                      <th className={styles.num}>Объём</th>
                      <th className={styles.num}>Вес, г</th>
                      <th className={styles.num}>Д×Ш×В, мм</th>
                      <th>Проблема</th>
                      <th>Предложение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const editing = edit?.id === r.id ? edit : null;
                      return (
                        <tr key={r.id}>
                          <td>
                            {r.suggestion ? (
                              <input
                                type="checkbox"
                                className={catalogStyles.adminCheckboxInTable}
                                checked={selected.has(r.id)}
                                onChange={() => toggle(r.id)}
                                aria-label={`Применить для ${r.productName} ${r.variantName}`}
                              />
                            ) : null}
                          </td>
                          <td>
                            <Link
                              href={`/admin/catalog/products/${r.productId}/variants/${r.id}`}
                            >
                              {r.productName}
                            </Link>
                            <span className={styles.suggestSource}>
                              {r.variantName} · {r.sku}
                            </span>
                          </td>
                          <td className={styles.num}>
                            {r.volumeMl != null ? `${r.volumeMl} мл` : "—"}
                          </td>
                          <td className={styles.num}>
                            {editing ? (
                              <input
                                className={styles.dimInput}
                                inputMode="numeric"
                                value={editing.draft.weight}
                                onChange={(e) =>
                                  setDraft("weight", e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void saveEdit(r);
                                  if (e.key === "Escape") setEdit(null);
                                }}
                                aria-label="Вес, г"
                                disabled={editing.saving}
                                autoFocus
                              />
                            ) : (
                              (r.weightGrams ?? "—")
                            )}
                          </td>
                          <td className={styles.num}>
                            {editing ? (
                              <span className={styles.dimInputs}>
                                {DRAFT_FIELDS.map((f, i) => (
                                  <span key={f.key}>
                                    {i ? "×" : null}
                                    <input
                                      className={styles.dimInput}
                                      inputMode="numeric"
                                      value={editing.draft[f.key]}
                                      onChange={(e) =>
                                        setDraft(f.key, e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") void saveEdit(r);
                                        if (e.key === "Escape") setEdit(null);
                                      }}
                                      aria-label={f.label}
                                      disabled={editing.saving}
                                    />
                                  </span>
                                ))}
                              </span>
                            ) : (
                              dimsText(r.lengthMm, r.widthMm, r.heightMm)
                            )}
                          </td>
                          <td>
                            {r.issues.map((i) => (
                              <span
                                key={i}
                                className={`${styles.issue} ${i.startsWith("нет ") ? styles.issueMuted : ""}`}
                              >
                                {i}
                              </span>
                            ))}
                          </td>
                          <td className={styles.suggest}>
                            {r.suggestion ? (
                              <>
                                {[
                                  r.suggestion.weightGrams != null
                                    ? `${r.suggestion.weightGrams} г`
                                    : null,
                                  r.suggestion.lengthMm != null
                                    ? `${dimsText(r.suggestion.lengthMm, r.suggestion.widthMm, r.suggestion.heightMm)} мм`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                                <span className={styles.suggestSource}>
                                  {SOURCE_LABEL[r.suggestion.source]}
                                </span>
                              </>
                            ) : (
                              <span className={styles.suggestSource}>
                                укажите объём или заполните вручную
                              </span>
                            )}
                            {editing ? (
                              <>
                                <span className={styles.rowActions}>
                                  <AdminCompactBtn
                                    type="button"
                                    variant="accent"
                                    disabled={editing.saving}
                                    onClick={() => void saveEdit(r)}
                                  >
                                    {editing.saving
                                      ? "Сохраняем…"
                                      : "Сохранить"}
                                  </AdminCompactBtn>
                                  <AdminCompactBtn
                                    type="button"
                                    variant="outline"
                                    disabled={editing.saving}
                                    onClick={() => setEdit(null)}
                                  >
                                    Отмена
                                  </AdminCompactBtn>
                                </span>
                                {editing.error ? (
                                  <span
                                    className={styles.editError}
                                    role="alert"
                                  >
                                    {editing.error}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className={styles.rowActions}>
                                <AdminCompactBtn
                                  type="button"
                                  variant="outline"
                                  disabled={busy || Boolean(edit?.saving)}
                                  onClick={() => startEdit(r)}
                                >
                                  Править
                                </AdminCompactBtn>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {audit.rows.length > rows.length ? (
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  onClick={() => setShowAll(true)}
                >
                  Показать все ({audit.rows.length})
                </AdminCompactBtn>
              ) : null}
            </>
          ) : (
            <p className={styles.testOk}>
              Все активные варианты заполнены корректно.
            </p>
          )}
        </>
      ) : !error ? (
        <p className={catalogStyles.lead}>Загрузка…</p>
      ) : null}
    </section>
  );
}
