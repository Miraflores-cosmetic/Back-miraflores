import type {
  ClientMode,
  DraftLine,
  OrderCreateStepId,
  PayMode,
  ShippingDraft,
} from './types';

export const ORDER_CREATE_DRAFT_KEY = 'miraflores.admin.orderCreate.draft.v1';

export type OrderCreateDraftV1 = {
  v: 1;
  savedAt: number;
  step: OrderCreateStepId;
  clientMode: ClientMode;
  userId: string | null;
  userLabelText: string;
  email: string;
  phone: string;
  customerName: string;
  customerNote: string;
  lines: DraftLine[];
  attachGratitude: boolean;
  promoCode: string;
  giftCertificateCode: string;
  shipping: ShippingDraft | null;
  payMode: PayMode;
  notifyCustomer: boolean;
  refHash: string;
  extUserId: string;
  idempotencyKey: string;
};

export function loadOrderCreateDraft(): OrderCreateDraftV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ORDER_CREATE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrderCreateDraftV1;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOrderCreateDraft(draft: OrderCreateDraftV1): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(ORDER_CREATE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* quota / private mode */
  }
}

export function clearOrderCreateDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(ORDER_CREATE_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
