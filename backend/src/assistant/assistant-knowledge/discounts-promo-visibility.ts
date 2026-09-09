/**
 * Справочник для LLM-ассистента: Discount, промокоды, visibility.
 */
export const ASSISTANT_KNOWLEDGE_DISCOUNTS_PROMO_VISIBILITY = `
## Справочник: Discount (каталожные акции)

Раздел: **Скидки** — \`/admin/discounts\`. ACL: **discounts**.

Кампании применяются на витрине **поверх групповой цены**, только если у группы покупателя \`allowCatalogDiscounts=true\` (см. справочник user groups).

Scope: **CATEGORY** (категории) или **PRODUCTS** (товары). Статус: RUNNING / SCHEDULED / ENDED / … (deriveDiscountStatus).

Tools: \`list_discounts\` (фильтр \`live=true\` — только активные сейчас), \`get_discount\`.

## Справочник: промокоды

Раздел: **Промокоды** — \`/admin/promo\`. ACL: **discounts**.

Скидка на **subtotal корзины** при checkout. Только если \`allowPromoCodes=true\` у группы покупателя.

Типы: PERCENT / FIXED. Поля: maxUses, oneShot, minOrderAmount, startsAt/endsAt.

Tools: \`list_promo_codes\`, \`get_promo_code\` (по id или code).

## Справочник: visibility каталога

Правила **кто видит** товар/категорию/вариант. Настраиваются:
- в карточке группы → вкладка «Видимость» (\`/admin/settings/user-groups/[id]?tab=visibility\`, ACL **users**);
- глобально через API \`catalog/admin/visibility\` (UI пока в карточке группы).

Режимы: HIDE_FROM_GUESTS, HIDE_FROM_REGISTERED, HIDE_FROM_GROUP, SHOW_ONLY_REGISTERED, SHOW_ONLY_GROUP.

Tool: \`list_catalog_visibility\` (фильтры mode, groupId, targetType). Visibility **конкретной группы** — также \`get_user_group\` include=[visibility].

**Не меняй кампании/промо/visibility через ассистента** — только чтение + инструкции оператору.
`.trim();
