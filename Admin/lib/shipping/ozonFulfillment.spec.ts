import { describe, expect, it } from "vitest";
import type { AdminOrderDetail } from "@/lib/adminOrderTypes";
import {
  isOzonOrder,
  isStepDone,
  legacyStepsToMigrate,
  OZON_CHECKLIST_STEPS,
  ozonPickupPoint,
  ozonShipmentBlockers,
  ozonShipmentFields,
  ozonStepMark,
} from "./ozonFulfillment";

function order(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: "o1",
    number: "MF-1001",
    status: "PAID",
    phone: "+79990000000",
    customerName: "Анна",
    shippingMethod: "OZON",
    shippingAddress: {
      city: "Москва",
      address: "ул. Тверская, 1",
      apartment: "",
      postalCode: "125009",
      comment:
        "__VSP:carrier=ozon|lon=37.6|lat=55.7|pvz=1011000000123|dropoff=pvz__",
      pvzCode: "1011000000123",
      phone: "+79991112233",
      recipientName: "Анна Петрова",
    },
    items: [
      {
        id: "i1",
        title: "Сыворотка",
        sku: "S1",
        qty: 2,
        unitPrice: 1500,
        lineTotal: 3000,
      },
      {
        id: "i2",
        title: "Подарок",
        sku: "G1",
        qty: 1,
        unitPrice: 0,
        lineTotal: 0,
        isGratitudeGift: true,
      },
    ],
    shipments: [],
    events: [],
    ...over,
  } as AdminOrderDetail;
}

const field = (o: AdminOrderDetail, key: string) =>
  ozonShipmentFields(o).find((f) => f.key === key)?.value;

describe("Ozon fulfillment", () => {
  it("распознаёт заказ Ozon по shippingMethod и по мета адреса", () => {
    expect(isOzonOrder(order())).toBe(true);
    expect(isOzonOrder(order({ shippingMethod: null }))).toBe(true);
    expect(
      isOzonOrder(
        order({
          shippingMethod: "CDEK",
          shippingAddress: { ...order().shippingAddress!, comment: "" },
        }),
      ),
    ).toBe(false);
  });

  it("поля для кабинета Ozon: ПВЗ, получатель из адреса, ценность без подарка", () => {
    const o = order();
    expect(field(o, "number")).toBe("MF-1001");
    expect(field(o, "recipient")).toBe("Анна Петрова");
    expect(field(o, "phone")).toBe("+79991112233");
    expect(field(o, "point")).toBe("1011000000123");
    expect(field(o, "declared")).toBe("3000");
    expect(field(o, "pieces")).toBe("3");
    expect(ozonShipmentBlockers(o)).toEqual([]);
  });

  it("курьер: без ID пункта, с адресом доставки", () => {
    const o = order({
      shippingAddress: {
        ...order().shippingAddress!,
        pvzCode: "",
        apartment: "12",
        comment: "__VSP:carrier=ozon|lon=|lat=|pvz=|dropoff=courier__",
      },
    });
    expect(field(o, "point")).toBeUndefined();
    expect(field(o, "address")).toBe("ул. Тверская, 1, кв./офис 12");
    expect(ozonShipmentBlockers(o)).toEqual([]);
  });

  it("ПВЗ без кода — блокер", () => {
    const o = order({
      shippingAddress: {
        ...order().shippingAddress!,
        pvzCode: "",
        comment: "__VSP:carrier=ozon|lon=|lat=|pvz=|dropoff=pvz__",
      },
    });
    expect(ozonShipmentBlockers(o)[0]).toMatch(/Нет ID пункта Ozon/);
  });

  it("авто-шаги по статусу, треку и письму; ручные — из отметок", () => {
    const step = (id: string) => OZON_CHECKLIST_STEPS.find((s) => s.id === id)!;
    const paid = order();
    expect(isStepDone(step("paid"), paid)).toBe(true);
    expect(isStepDone(step("packing"), paid)).toBe(false);
    expect(isStepDone(step("picked"), paid)).toBe(false);
    const picked = order({
      checklist: {
        ozon: {
          picked: {
            doneAt: "2026-09-27T10:00:00Z",
            doneBy: { id: "u1", name: "Склад" },
          },
        },
      },
    });
    expect(isStepDone(step("picked"), picked)).toBe(true);
    expect(ozonStepMark(step("picked"), picked)?.doneBy?.name).toBe("Склад");
    expect(ozonStepMark(step("paid"), picked)).toBeNull();

    const shipped = order({
      status: "SHIPPED",
      shipments: [
        {
          id: "s1",
          provider: "OZON",
          tracking: "0123456789",
          status: null,
          externalId: null,
          createdAt: "",
        },
      ],
      events: [
        {
          id: "e1",
          type: "TRACKING_SENT",
          message: "",
          actorUserId: null,
          createdAt: "",
        },
      ],
    });
    expect(isStepDone(step("tracked"), shipped)).toBe(true);
    expect(isStepDone(step("notified"), shipped)).toBe(true);
    expect(isStepDone(step("tracked"), order({ status: "SHIPPED" }))).toBe(
      false,
    );
    expect(isStepDone(step("cost"), shipped)).toBe(false);
    const costed = order({
      status: "SHIPPED",
      shipments: [
        {
          id: "s1",
          provider: "OZON",
          tracking: "1",
          status: null,
          externalId: null,
          createdAt: "",
          carrierCostRub: 64,
        },
      ],
    });
    expect(isStepDone(step("cost"), costed)).toBe(true);
  });

  it("перенос отметок из localStorage: только ручные шаги, которых нет на сервере", () => {
    const o = order({
      checklist: {
        ozon: { picked: { doneAt: "2026-09-27T10:00:00Z", doneBy: null } },
      },
    });
    expect(
      legacyStepsToMigrate(
        { picked: true, packed: true, label: false, paid: true, bogus: true },
        o,
      ),
    ).toEqual(["packed"]);
    expect(legacyStepsToMigrate({}, o)).toEqual([]);
  });

  it("пункт Ozon для read-only блока: ID из адреса/мета, курьер без пункта", () => {
    expect(ozonPickupPoint(order())).toEqual({
      courier: false,
      pointId: "1011000000123",
      city: "Москва",
      address: "ул. Тверская, 1",
    });
    const fromMeta = order({
      shippingAddress: { ...order().shippingAddress!, pvzCode: "" },
    });
    expect(ozonPickupPoint(fromMeta).pointId).toBe("1011000000123");
    const courier = order({
      shippingAddress: {
        ...order().shippingAddress!,
        pvzCode: "",
        comment: "__VSP:carrier=ozon|pvz=|dropoff=courier__",
      },
    });
    expect(ozonPickupPoint(courier)).toMatchObject({
      courier: true,
      pointId: "",
    });
  });
});
