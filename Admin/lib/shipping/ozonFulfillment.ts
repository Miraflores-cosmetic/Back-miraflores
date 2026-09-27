import type { AdminOrderDetail } from "@/lib/adminOrderTypes";
import { parseJcosAddressMeta } from "@/lib/shipping/addressShippingMeta";

/**
 * Ручной fulfillment Ozon Доставки: отправление создаётся в кабинете Ozon,
 * номер отправления вносится в «Трек» карточки заказа. Регламент — docs/runbooks/ozon-fulfillment.md.
 */
export const OZON_CABINET_URL =
  process.env.NEXT_PUBLIC_OZON_CABINET_URL?.trim() || "https://seller.ozon.ru/";

const AFTER_PAID = new Set(["PAID", "PACKING", "SHIPPED", "DELIVERED"]);
const AFTER_PACKING = new Set(["PACKING", "SHIPPED", "DELIVERED"]);
const AFTER_SHIPPED = new Set(["SHIPPED", "DELIVERED"]);

type OzonOrderInput = Pick<
  AdminOrderDetail,
  | "id"
  | "number"
  | "status"
  | "phone"
  | "customerName"
  | "shippingAddress"
  | "shippingMethod"
  | "items"
  | "shipments"
  | "events"
  | "checklist"
>;

export function isOzonOrder(
  order: Pick<AdminOrderDetail, "shippingMethod" | "shippingAddress">,
): boolean {
  if ((order.shippingMethod || "").toUpperCase() === "OZON") return true;
  return (
    parseJcosAddressMeta(order.shippingAddress?.comment ?? "").meta?.carrier ===
    "ozon"
  );
}

export type OzonPickupPoint = {
  courier: boolean;
  /** map_point_id Ozon (не код ПВЗ СДЭК) */
  pointId: string;
  city: string;
  address: string;
};

/** Пункт Ozon, выбранный покупателем, — только для чтения (смена — через «Изменить адрес»). */
export function ozonPickupPoint(
  order: Pick<AdminOrderDetail, "shippingAddress">,
): OzonPickupPoint {
  const a = order.shippingAddress;
  const meta = parseJcosAddressMeta(a?.comment ?? "").meta;
  return {
    courier: meta?.dropoff === "courier",
    pointId: (a?.pvzCode || meta?.pvzId || "").trim(),
    city: (a?.city || "").trim(),
    address: (a?.address || "").trim(),
  };
}

export type OzonShipmentField = { key: string; label: string; value: string };

/** Поля для формы отправления в кабинете Ozon — в порядке заполнения. */
export function ozonShipmentFields(order: OzonOrderInput): OzonShipmentField[] {
  const a = order.shippingAddress;
  const meta = parseJcosAddressMeta(a?.comment ?? "").meta;
  const courier = meta?.dropoff === "courier";
  const pointId = (a?.pvzCode || meta?.pvzId || "").trim();
  const paidLines = order.items.filter((i) => !i.isGratitudeGift);
  const declared = paidLines.reduce((sum, i) => sum + i.lineTotal, 0);
  const pieces = order.items.reduce((sum, i) => sum + i.qty, 0);
  const street = [a?.address, a?.apartment ? `кв./офис ${a.apartment}` : ""]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(", ");

  const fields: OzonShipmentField[] = [
    { key: "number", label: "Номер заказа продавца", value: order.number },
    {
      key: "recipient",
      label: "Получатель",
      value: (a?.recipientName || order.customerName || "").trim(),
    },
    {
      key: "phone",
      label: "Телефон получателя",
      value: (a?.phone || order.phone || "").trim(),
    },
    {
      key: "dropoff",
      label: "Способ",
      value: courier ? "Курьер до двери" : "Пункт выдачи Ozon",
    },
  ];
  if (!courier) {
    fields.push({
      key: "point",
      label: "ID пункта Ozon (map_point_id)",
      value: pointId,
    });
  }
  fields.push(
    { key: "city", label: "Город", value: (a?.city || "").trim() },
    {
      key: "address",
      label: courier ? "Адрес доставки" : "Адрес пункта",
      value: street,
    },
  );
  if (a?.postalCode?.trim()) {
    fields.push({ key: "postal", label: "Индекс", value: a.postalCode.trim() });
  }
  fields.push(
    {
      key: "declared",
      label: "Объявленная ценность, ₽",
      value: String(Math.round(declared)),
    },
    { key: "pieces", label: "Товаров в посылке, шт", value: String(pieces) },
  );
  return fields;
}

/** Чего не хватает, чтобы оформить отправление в Ozon. */
export function ozonShipmentBlockers(order: OzonOrderInput): string[] {
  const out: string[] = [];
  const byKey = new Map(ozonShipmentFields(order).map((f) => [f.key, f.value]));
  if (byKey.has("point") && !byKey.get("point"))
    out.push("Нет ID пункта Ozon — уточните ПВЗ у клиента и измените адрес.");
  if (!byKey.get("recipient")) out.push("Нет имени получателя.");
  if (!byKey.get("phone")) out.push("Нет телефона получателя.");
  if (!byKey.get("address")) out.push("Нет адреса.");
  return out;
}

export type OzonChecklistStep = {
  id: string;
  title: string;
  hint?: string;
  /** Отмечается автоматически по данным заказа; вручную не переключается. */
  auto?: (order: OzonOrderInput) => boolean;
};

export const OZON_CHECKLIST_STEPS: OzonChecklistStep[] = [
  {
    id: "paid",
    title: "Оплата получена",
    hint: "Статус «Оплачен». Неоплаченные заказы не собираем.",
    auto: (o) => AFTER_PAID.has(o.status),
  },
  {
    id: "packing",
    title: "Заказ взят в сборку",
    hint: "Кнопка «В сборку» — клиент видит, что заказ собирается.",
    auto: (o) => AFTER_PACKING.has(o.status),
  },
  {
    id: "picked",
    title: "Собрано по составу",
    hint: "Сверить артикулы, оттенки и количество; проверить сроки годности и целостность. Подарок благодарности — в посылку.",
  },
  {
    id: "packed",
    title: "Упаковано, взвешено, измерено",
    hint: "Стекло — в пузырчатую плёнку, жидкости — в зип-пакет. Записать вес (г) и габариты Д×Ш×В (см) для формы Ozon.",
  },
  {
    id: "created",
    title: "Отправление создано в кабинете Ozon",
    hint: "Данные — в блоке выше. Пункт выбирать по ID, не по адресу.",
  },
  {
    id: "label",
    title: "Этикетка распечатана и наклеена",
    hint: "Этикетка Ozon на самую большую грань; номер заказа — маркером на коробке.",
  },
  {
    id: "handed",
    title: "Передано в Ozon",
    hint: "Сдать в пункт приёма или курьеру Ozon; сохранить акт/подтверждение.",
  },
  {
    id: "tracked",
    title: "Трек внесён, заказ «Отправлен»",
    hint: "Номер отправления Ozon → поле «Трек» → «Заказ отправлен».",
    auto: (o) =>
      AFTER_SHIPPED.has(o.status) &&
      Boolean(o.shipments?.[0]?.tracking?.trim()),
  },
  {
    id: "notified",
    title: "Клиенту отправлен трек",
    hint: "Кнопка «Отправить трек-номер» (письмо на email заказа).",
    auto: (o) => o.events.some((e) => e.type === "TRACKING_SENT"),
  },
  {
    id: "cost",
    title: "Стоимость из кабинета внесена",
    hint: "Сумма списания Ozon за отправление → «Отправления» в карточке заказа. Нужна для сверки тарифной сетки.",
    auto: (o) => o.shipments?.[0]?.carrierCostRub != null,
  },
];

/** Ручные отметки хранятся на сервере (OrderChecklistMark), общие для всех смен. */
export const OZON_CHECKLIST_ID = "ozon";

/** Старый ключ localStorage — отметки переносятся на сервер при открытии чеклиста. */
export function ozonChecklistStorageKey(orderId: string): string {
  return `mf:ozon-checklist:${orderId}`;
}

export function ozonStepMark(
  step: OzonChecklistStep,
  order: Pick<AdminOrderDetail, "checklist">,
) {
  return step.auto
    ? null
    : (order.checklist?.[OZON_CHECKLIST_ID]?.[step.id] ?? null);
}

export function isStepDone(
  step: OzonChecklistStep,
  order: OzonOrderInput,
): boolean {
  return step.auto ? step.auto(order) : Boolean(ozonStepMark(step, order));
}

/** Шаги из старого localStorage, которых ещё нет на сервере. */
export function legacyStepsToMigrate(
  legacy: Record<string, boolean>,
  order: Pick<AdminOrderDetail, "checklist">,
): string[] {
  return OZON_CHECKLIST_STEPS.filter(
    (s) =>
      !s.auto &&
      legacy[s.id] === true &&
      !order.checklist?.[OZON_CHECKLIST_ID]?.[s.id],
  ).map((s) => s.id);
}
