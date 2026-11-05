# Пробники (sample variants) — витрина и каталог

## PLP / home / коллекции

- В листинг попадают только **sellable** объёмы: `catalogSellableVariantWhere` (`active`, `price > 0`, **`isSample: false`**).
- Товар, у которого **единственный активный вариант — пробник**, в PLP **не показывается** (нет sellable-варианта для карточки).
- **PDP по прямой ссылке** (`/product/:slug`) пробник по-прежнему доступен, если товар активен и вариант виден группе покупателя.

Это ожидаемое поведение, не баг.

## Поиск (header / `GET /search`)

- Subtitle цены товара считается через **`catalogSellablePrices`** по вариантам hit’а; в select вариантов есть **`name`** и **`isSample`**, пробники не задают «от … р.».

## Покупка

- Лимиты и eligibility: `ProductVariant.isSample` (приоритет над «пробник» в имени), см. `sample-purchase.util.ts` и статью правил в настройках корзины.
- **«Уже покупали»** (`findPurchasedSampleVariantIds`): только заказы в **`PAID` / `PACKING` / `SHIPPED` / `DELIVERED`**. **`REFUNDED`** (полный возврат) **не** считается — тот же пробник можно заказать снова. Неоплаченные **`NEW` / `AWAITING_PAYMENT`** и **`CANCELLED`** тоже не блокируют.

## Админка

- Флаг **«Пробник»** на варианте; при PATCH rename **не** пересчитывает `isSample` без явного поля в DTO.
