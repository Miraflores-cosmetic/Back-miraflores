"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AdminModal } from "@/components/admin/AdminModal/AdminModal";
import { AdminCompactBtn } from "@/components/AdminCompactBtn/AdminCompactBtn";
import {
  AdminBackendRequestError,
  adminBackendJson,
} from "@/lib/adminBackendFetch";
import { formatAdminDateTime } from "@/lib/adminFormat";
import type { AdminOrderDetail } from "@/lib/adminOrderTypes";
import {
  isStepDone,
  legacyStepsToMigrate,
  OZON_CABINET_URL,
  OZON_CHECKLIST_ID,
  OZON_CHECKLIST_STEPS,
  ozonChecklistStorageKey,
  ozonShipmentBlockers,
  ozonShipmentFields,
  ozonStepMark,
} from "@/lib/shipping/ozonFulfillment";
import styles from "./orders.module.css";

function readLegacy(orderId: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(ozonChecklistStorageKey(orderId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

function dropLegacy(orderId: string) {
  try {
    window.localStorage.removeItem(ozonChecklistStorageKey(orderId));
  } catch {
    /* ignore */
  }
}

function putMark(orderId: string, stepId: string, done: boolean) {
  return adminBackendJson<AdminOrderDetail>(
    `orders/admin/${orderId}/checklist`,
    {
      method: "PUT",
      body: JSON.stringify({ checklist: OZON_CHECKLIST_ID, stepId, done }),
    },
  );
}

export function OzonFulfillmentChecklist({
  open,
  order,
  onClose,
  onOrderChange,
}: {
  open: boolean;
  order: AdminOrderDetail;
  onClose: () => void;
  onOrderChange: (order: AdminOrderDetail) => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const migratedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open || migratedFor.current === order.id) return;
    migratedFor.current = order.id;
    const steps = legacyStepsToMigrate(readLegacy(order.id), order);
    if (!steps.length) {
      dropLegacy(order.id);
      return;
    }
    void (async () => {
      try {
        let latest = order;
        for (const stepId of steps)
          latest = await putMark(order.id, stepId, true);
        onOrderChange(latest);
        dropLegacy(order.id);
      } catch {
        migratedFor.current = null;
      }
    })();
  }, [open, order, onOrderChange]);

  const fields = useMemo(() => ozonShipmentFields(order), [order]);
  const blockers = useMemo(() => ozonShipmentBlockers(order), [order]);
  const effective = (step: (typeof OZON_CHECKLIST_STEPS)[number]) =>
    step.id in pending ? pending[step.id] : isStepDone(step, order);
  const doneCount = OZON_CHECKLIST_STEPS.filter(effective).length;

  async function toggle(stepId: string, done: boolean) {
    setSaveError(null);
    setPending((p) => ({ ...p, [stepId]: done }));
    try {
      onOrderChange(await putMark(order.id, stepId, done));
    } catch (e) {
      setSaveError(
        e instanceof AdminBackendRequestError
          ? e.message
          : "Не удалось сохранить отметку",
      );
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[stepId];
        return next;
      });
    }
  }

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(
        () => setCopiedKey((k) => (k === key ? null : k)),
        1500,
      );
    } catch {
      /* ignore */
    }
  }

  const allFieldsText = fields
    .map((f) => `${f.label}: ${f.value || "—"}`)
    .join("\n");

  return (
    <AdminModal
      open={open}
      title={`Ozon: отправка заказа ${order.number}`}
      onClose={onClose}
      size="wide"
    >
      <div className={styles.ozonChecklist}>
        <section>
          <div className={styles.ozonSectionHead}>
            <p className={styles.orderAsideTitle}>Данные для кабинета Ozon</p>
            <div className={styles.ozonHeadActions}>
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={() => void copy("all", allFieldsText)}
              >
                {copiedKey === "all" ? "Скопировано" : "Копировать всё"}
              </AdminCompactBtn>
              <a
                className={styles.orderInlineLink}
                href={OZON_CABINET_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть кабинет Ozon ↗
              </a>
            </div>
          </div>

          {blockers.length ? (
            <ul className={styles.ozonBlockers} role="alert">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}

          <dl className={styles.ozonFields}>
            {fields.map((f) => (
              <div key={f.key} className={styles.ozonFieldRow}>
                <dt>{f.label}</dt>
                <dd>{f.value || "—"}</dd>
                <button
                  type="button"
                  className={styles.ozonCopyBtn}
                  disabled={!f.value}
                  onClick={() => void copy(f.key, f.value)}
                  aria-label={`Скопировать: ${f.label}`}
                >
                  {copiedKey === f.key ? "✓" : "Копировать"}
                </button>
              </div>
            ))}
          </dl>
          <p className={styles.orderHint}>
            Вес и габариты — после упаковки, по факту (весы, линейка).
            Объявленная ценность — сумма оплаченных товаров без доставки.
          </p>
        </section>

        <section>
          <div className={styles.ozonSectionHead}>
            <p className={styles.orderAsideTitle}>Чеклист склада</p>
            <span className={styles.ozonProgress}>
              {doneCount} / {OZON_CHECKLIST_STEPS.length}
            </span>
          </div>
          <ol className={styles.ozonSteps}>
            {OZON_CHECKLIST_STEPS.map((step) => {
              const done = effective(step);
              const mark =
                step.id in pending ? null : ozonStepMark(step, order);
              return (
                <li
                  key={step.id}
                  className={done ? styles.ozonStepDone : undefined}
                >
                  <label className={styles.ozonStepLabel}>
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={Boolean(step.auto) || step.id in pending}
                      onChange={() => void toggle(step.id, !done)}
                    />
                    <span>
                      <span className={styles.ozonStepTitle}>
                        {step.title}
                        {step.auto ? (
                          <span className={styles.ozonAutoTag}>авто</span>
                        ) : null}
                      </span>
                      {step.hint ? (
                        <span className={styles.ozonStepHint}>{step.hint}</span>
                      ) : null}
                      {mark ? (
                        <span className={styles.ozonStepMark}>
                          {mark.doneBy?.name ?? "Отмечено"} ·{" "}
                          {formatAdminDateTime(mark.doneAt)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>
          {saveError ? (
            <p className={styles.ozonBlockers} role="alert">
              {saveError}
            </p>
          ) : null}
          <p className={styles.orderHint}>
            Отметки сохраняются в заказе и видны всем сменам. «Авто» — по
            статусу заказа и истории.
          </p>
        </section>
      </div>
    </AdminModal>
  );
}
