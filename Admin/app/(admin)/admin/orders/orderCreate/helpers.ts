import type { AdminRetailUser } from '@/lib/adminUserTypes';
import { isValidEmail, isValidPhone } from '@/lib/phone';
import type {
  ClientMode,
  DraftLine,
  OrderCreateStepId,
  ShippingDraft,
} from './types';

/** Совпадает с backend `gift-denom:<id>`. */
export const GIFT_DENOM_CART_PREFIX = 'gift-denom:';

export function newLineKey() {
  return `l-${Math.random().toString(36).slice(2, 10)}`;
}

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `admin-wizard-${crypto.randomUUID()}`;
  }
  return `admin-wizard-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function userLabel(u: Pick<AdminRetailUser, 'displayName' | 'email'>) {
  return u.displayName?.trim() || u.email;
}

/** Merge key для позиций wizard (variant + shade). */
export function draftLineMergeKey(
  variantId: string,
  shadeId?: string | null,
): string {
  return `${variantId.trim()}\0${shadeId?.trim() || ''}`;
}

export function isGiftDenomVariantId(variantId: string): boolean {
  return variantId.trim().startsWith(GIFT_DENOM_CART_PREFIX);
}

/** Корзина только из digital gift-denom — доставка на BE не нужна. */
export function isGiftOnlyDraftLines(lines: DraftLine[]): boolean {
  if (lines.length < 1) return false;
  return lines.every((l) => isGiftDenomVariantId(l.variantId));
}

export function linesHaveGiftDenom(lines: DraftLine[]): boolean {
  return lines.some((l) => isGiftDenomVariantId(l.variantId));
}

export function linesHavePhysical(lines: DraftLine[]): boolean {
  return lines.some((l) => !isGiftDenomVariantId(l.variantId));
}

/** BE: нельзя мешать gift-denom и physical. */
export function catalogGiftMixBlockedReason(
  lines: DraftLine[],
  adding: 'catalog' | 'gift',
): string | null {
  if (adding === 'gift' && linesHavePhysical(lines)) {
    return 'Нельзя добавить сертификат к обычным товарам — оформите отдельно';
  }
  if (adding === 'catalog' && linesHaveGiftDenom(lines)) {
    return 'Нельзя добавить товар к электронным сертификатам — оформите отдельно';
  }
  return null;
}

export function giftDenomCartVariantId(denominationId: string): string {
  return `${GIFT_DENOM_CART_PREFIX}${denominationId}`;
}

export function draftLineFromGiftDenom(denom: {
  id: string;
  name: string;
  faceValue: number;
}): DraftLine {
  const face = Math.max(0, Math.floor(denom.faceValue));
  return {
    key: newLineKey(),
    variantId: giftDenomCartVariantId(denom.id),
    shadeId: null,
    shadeName: null,
    title: `Подарочный сертификат «${denom.name}»`,
    sku: `GIFT_CERTIFICATE:${denom.id}`,
    catalogPrice: face,
    unitPrice: face,
    qty: 1,
  };
}

/**
 * После POST create: какой диалог показать.
 * awaiting_link без URL и без paymentError → warning follow-up (не silent redirect).
 */
export function resolveCreateOrderUiFollowUp(opts: {
  payMode: string;
  orderId: string;
  orderNumber: string;
  paymentLink: string | null | undefined;
  paymentError?: string | null;
}):
  | { kind: 'payment_link'; orderId: string; number: string; url: string }
  | { kind: 'follow_up'; orderId: string; number: string; message: string }
  | { kind: 'redirect'; orderId: string } {
  const link = opts.paymentLink?.trim() || null;
  if (link) {
    return {
      kind: 'payment_link',
      orderId: opts.orderId,
      number: opts.orderNumber,
      url: link,
    };
  }
  if (opts.paymentError?.trim()) {
    return {
      kind: 'follow_up',
      orderId: opts.orderId,
      number: opts.orderNumber,
      message: opts.paymentError.trim(),
    };
  }
  if (opts.payMode === 'awaiting_link') {
    return {
      kind: 'follow_up',
      orderId: opts.orderId,
      number: opts.orderNumber,
      message:
        'Платёжная ссылка не создана. Заказ уже есть — откройте карточку и выпустите ссылку вручную.',
    };
  }
  return { kind: 'redirect', orderId: opts.orderId };
}

/** Stub адреса для gift-only create/preview (как storefront digital). */
export function giftOnlyShippingStub(): {
  city: string;
  address: string;
  apartment: string;
  region: string;
  district: string;
  postalCode: string;
  phone: string;
  recipientName: string;
  pvzCode: string;
  comment: string;
} {
  return {
    city: '—',
    address: 'Электронный сертификат',
    apartment: '',
    region: '',
    district: '',
    postalCode: '',
    phone: '',
    recipientName: '',
    pvzCode: '',
    comment: 'digital-gift',
  };
}

export type Step1FieldErrors = {
  userId?: string;
  customerName?: string;
  email?: string;
  phone?: string;
};

export function step1FieldErrors(opts: {
  clientMode: ClientMode;
  userId: string | null;
  customerName: string;
  email: string;
  phone: string;
}): Step1FieldErrors {
  const out: Step1FieldErrors = {};
  if (opts.clientMode === 'user' && !opts.userId) {
    out.userId =
      'Выберите пользователя из списка или переключитесь на «Гость»';
  }
  if (!opts.customerName.trim()) out.customerName = 'Укажите имя клиента';
  if (!opts.email.trim()) out.email = 'Укажите email';
  else if (!isValidEmail(opts.email)) out.email = 'Укажите корректный email';
  if (!isValidPhone(opts.phone)) out.phone = 'Укажите корректный телефон';
  return out;
}

export function stepNextBlockedReason(opts: {
  step: OrderCreateStepId;
  clientMode: ClientMode;
  userId: string | null;
  customerName: string;
  email: string;
  phone: string;
  lines: DraftLine[];
  promoCode: string;
  giftCertificateCode: string;
  shipping: ShippingDraft | null;
  giftOnly?: boolean;
  previewBusy?: boolean;
  previewError?: string | null;
  hasPreview?: boolean;
}): string | null {
  const {
    step,
    clientMode,
    userId,
    customerName,
    email,
    phone,
    lines,
    promoCode,
    giftCertificateCode,
    shipping,
  } = opts;
  const giftOnly = Boolean(opts.giftOnly ?? isGiftOnlyDraftLines(lines));

  if (step === 1) {
    const fe = step1FieldErrors({
      clientMode,
      userId,
      customerName,
      email,
      phone,
    });
    return (
      fe.userId ||
      fe.customerName ||
      fe.email ||
      fe.phone ||
      null
    );
  }
  if (step === 2) {
    if (lines.length < 1) return 'Добавьте хотя бы одну позицию';
    if (lines.some((l) => l.qty < 1)) return 'Количество должно быть ≥ 1';
    return null;
  }
  if (step === 3) {
    if (promoCode.trim() && giftCertificateCode.trim()) {
      return 'Промокод и сертификат взаимоисключающи — оставьте одно';
    }
    return null;
  }
  if (step === 4) {
    if (giftOnly) return null;
    if (!shipping) return 'Выберите доставку';
    if (!shipping.address.city.trim() || !shipping.address.address.trim()) {
      return 'Нужны город и адрес';
    }
    if (
      shipping.selection.dropoff === 'pvz' &&
      !shipping.address.pvzCode.trim()
    ) {
      return 'Для ПВЗ нужен код пункта';
    }
    return null;
  }
  if (step === 5) {
    if (opts.previewBusy) return 'Считаем итог…';
    if (opts.previewError) return opts.previewError;
    if (!opts.hasPreview) return 'Нет серверного превью итога';
    return null;
  }
  return null;
}

/** Следующий шаг: gift-only пропускает доставку (3→5, 4→5). */
export function nextWizardStep(
  step: OrderCreateStepId,
  giftOnly: boolean,
): OrderCreateStepId {
  if (giftOnly && step === 3) return 5;
  if (giftOnly && step === 4) return 5;
  return Math.min(5, step + 1) as OrderCreateStepId;
}

export function prevWizardStep(
  step: OrderCreateStepId,
  giftOnly: boolean,
): OrderCreateStepId {
  if (giftOnly && step === 5) return 3;
  if (giftOnly && step === 4) return 3;
  return Math.max(1, step - 1) as OrderCreateStepId;
}

export function canGoNextFromReason(reason: string | null) {
  return reason == null;
}
