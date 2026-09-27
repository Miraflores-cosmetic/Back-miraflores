/**
 * Яндекс Доставка скрыта (выбор перевозчика, служба отправки, витрина). Вернуть:
 * NEXT_PUBLIC_YANDEX_DELIVERY_ENABLED=true (+ YANDEX_DELIVERY_ENABLED на бэкенде).
 * Заказы/адреса, уже оформленные через Яндекс, отображаются и редактируются как раньше.
 */
export const YANDEX_DELIVERY_ENABLED =
  process.env.NEXT_PUBLIC_YANDEX_DELIVERY_ENABLED === 'true';
