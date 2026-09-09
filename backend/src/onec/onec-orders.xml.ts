import type { Order, OrderItem, Payment, ProductVariant } from '@prisma/client';

type OrderForXml = Order & {
  items: (OrderItem & {
    variant: Pick<ProductVariant, 'onecId'> | null;
  })[];
  payments: Payment[];
};

/** Строки для 1С: без подарков благодарности и без номенклатуры без onecId. */
export function orderItemsForOnecExport(
  items: OrderForXml['items'],
): OrderForXml['items'] {
  return items.filter(
    (item) => !item.isGratitudeGift && Boolean(item.variant?.onecId?.trim()),
  );
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateTime(d: Date): { date: string; time: string; full: string } {
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return {
    date: `${y}-${mo}-${day}`,
    time: `${h}:${mi}:${s}`,
    full: `${y}-${mo}-${day}T${h}:${mi}:${s}`,
  };
}

function statusLabel(status: string): string {
  switch (status) {
    case 'PAID':
      return 'Оплачен';
    case 'PACKING':
      return 'Комплектуется';
    case 'SHIPPED':
      return 'Отгружен';
    case 'DELIVERED':
      return 'Доставлен';
    case 'CANCELLED':
      return 'Отменён';
    case 'REFUNDED':
      return 'Возврат';
    default:
      return status;
  }
}

type ShippingAddress = {
  city?: string;
  address?: string;
  apartment?: string;
  region?: string;
  district?: string;
  postalCode?: string;
  comment?: string;
  phone?: string;
  recipientName?: string;
  pvzCode?: string;
};

function asShipping(raw: unknown): ShippingAddress {
  if (!raw || typeof raw !== 'object') return {};
  return raw as ShippingAddress;
}

/**
 * CommerceML документы заказов для Битрикс-обмена (type=sale, mode=query).
 */
export function buildOrdersCommerceMl(orders: OrderForXml[]): string {
  const now = formatDateTime(new Date());
  const docs = orders.map((order) => buildDocument(order)).join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<КоммерческаяИнформация ВерсияСхемы="2.05" ДатаФормирования="${now.full}">\n` +
    `${docs}` +
    `</КоммерческаяИнформация>\n`
  );
}

function buildDocument(order: OrderForXml): string {
  const created = formatDateTime(order.createdAt);
  const ship = asShipping(order.shippingAddress);
  const name = xmlEscape(
    order.customerName?.trim() || ship.recipientName?.trim() || order.email,
  );
  const phone = xmlEscape(order.phone || ship.phone || '');
  const email = xmlEscape(order.email);
  const paid = order.payments.some((p) => p.status === 'SUCCEEDED');
  const addressParts = [
    ship.postalCode,
    ship.region,
    ship.district,
    ship.city,
    ship.address,
    ship.apartment ? `кв. ${ship.apartment}` : null,
    ship.pvzCode ? `ПВЗ ${ship.pvzCode}` : null,
  ].filter(Boolean);
  const address = xmlEscape(addressParts.join(', '));

  const products = orderItemsForOnecExport(order.items)
    .map((item) => {
      const onecId = item.variant!.onecId!.trim();
      const idXml = `<Ид>${xmlEscape(onecId)}</Ид>\n`;
      return (
        `      <Товар>\n` +
        `        ${idXml}` +
        `        <Артикул>${xmlEscape(item.sku)}</Артикул>\n` +
        `        <Наименование>${xmlEscape(item.title)}</Наименование>\n` +
        `        <ЦенаЗаЕдиницу>${item.unitPrice}</ЦенаЗаЕдиницу>\n` +
        `        <Количество>${item.qty}</Количество>\n` +
        `        <Сумма>${item.lineTotal}</Сумма>\n` +
        `        <Единица>шт</Единица>\n` +
        `      </Товар>`
      );
    })
    .join('\n');

  if (order.shippingCost > 0) {
    // доставка как отдельная строка без onecId — 1С обычно мапит по имени/реквизиту
  }

  const shippingProduct =
    order.shippingCost > 0
      ? `\n      <Товар>\n` +
        `        <Ид>DELIVERY</Ид>\n` +
        `        <Наименование>Доставка</Наименование>\n` +
        `        <ЦенаЗаЕдиницу>${order.shippingCost}</ЦенаЗаЕдиницу>\n` +
        `        <Количество>1</Количество>\n` +
        `        <Сумма>${order.shippingCost}</Сумма>\n` +
        `        <Единица>шт</Единица>\n` +
        `      </Товар>`
      : '';

  const note = order.customerNote?.trim() || ship.comment?.trim() || '';

  return (
    `  <Документ>\n` +
    `    <Ид>${xmlEscape(order.id)}</Ид>\n` +
    `    <Номер>${xmlEscape(order.number)}</Номер>\n` +
    `    <Дата>${created.date}</Дата>\n` +
    `    <Время>${created.time}</Время>\n` +
    `    <ХозОперация>Заказ товара</ХозОперация>\n` +
    `    <Роль>Продавец</Роль>\n` +
    `    <Валюта>руб</Валюта>\n` +
    `    <Курс>1</Курс>\n` +
    `    <Сумма>${order.total}</Сумма>\n` +
    `    <Контрагенты>\n` +
    `      <Контрагент>\n` +
    `        <Ид>${xmlEscape(order.userId || order.guestId || order.id)}</Ид>\n` +
    `        <Наименование>${name}</Наименование>\n` +
    `        <Роль>Покупатель</Роль>\n` +
    `        <ПолноеНаименование>${name}</ПолноеНаименование>\n` +
    `        <Фамилия>${name}</Фамилия>\n` +
    `        <Контакты>\n` +
    `          <Контакт>\n` +
    `            <Тип>ТелефонРабочий</Тип>\n` +
    `            <Значение>${phone}</Значение>\n` +
    `          </Контакт>\n` +
    `          <Контакт>\n` +
    `            <Тип>ЭлектроннаяПочта</Тип>\n` +
    `            <Значение>${email}</Значение>\n` +
    `          </Контакт>\n` +
    `        </Контакты>\n` +
    `        <АдресРегистрации>\n` +
    `          <Представление>${address}</Представление>\n` +
    `        </АдресРегистрации>\n` +
    `      </Контрагент>\n` +
    `    </Контрагенты>\n` +
    `    <Товары>\n` +
    `${products}${shippingProduct}\n` +
    `    </Товары>\n` +
    `    <ЗначенияРеквизитов>\n` +
    `      <ЗначениеРеквизита>\n` +
    `        <Наименование>Заказ оплачен</Наименование>\n` +
    `        <Значение>${paid ? 'true' : 'false'}</Значение>\n` +
    `      </ЗначениеРеквизита>\n` +
    `      <ЗначениеРеквизита>\n` +
    `        <Наименование>Статус заказа</Наименование>\n` +
    `        <Значение>${xmlEscape(statusLabel(order.status))}</Значение>\n` +
    `      </ЗначениеРеквизита>\n` +
    `      <ЗначениеРеквизита>\n` +
    `        <Наименование>Метод доставки</Наименование>\n` +
    `        <Значение>${xmlEscape(order.shippingMethod || '')}</Значение>\n` +
    `      </ЗначениеРеквизита>\n` +
    (note
      ? `      <ЗначениеРеквизита>\n` +
        `        <Наименование>Комментарий покупателя</Наименование>\n` +
        `        <Значение>${xmlEscape(note)}</Значение>\n` +
        `      </ЗначениеРеквизита>\n`
      : '') +
    `    </ЗначенияРеквизитов>\n` +
    `  </Документ>\n`
  );
}
