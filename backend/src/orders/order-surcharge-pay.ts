import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isPaidEditableStatus } from './order-admin-edit';
import {
  pickReusableSurchargePayment,
  resolveOrderBalanceFields,
} from './order-balance-due';
import { upsertPendingOrderPayment } from './payment-order-external';
import { YooKassaService } from './yookassa.service';

type OrderForSurcharge = {
  id: string;
  number: string;
  email: string;
  status: import('@prisma/client').OrderStatus;
  total: number;
  refundedAmount: number;
  giftPurchaseDenominationId: string | null;
  payments: Array<{
    status: PaymentStatus;
    amount: number;
    externalId: string | null;
    confirmationUrl: string | null;
    raw: Prisma.JsonValue | null;
  }>;
};

export type SurchargePayLinkResult = {
  amount: number;
  confirmationUrl: string;
  paymentId: string;
  reused: boolean;
};

/**
 * PENDING surcharge redirect в ЮKassa (reuse или create). Для админки и ЛК.
 */
export async function ensureOrderSurchargePayLink(
  prisma: PrismaService,
  yookassa: YooKassaService,
  config: ConfigService,
  order: OrderForSurcharge,
): Promise<SurchargePayLinkResult> {
  if (!yookassa.isConfigured()) {
    throw new BadRequestException('Оплата временно недоступна');
  }
  if (order.giftPurchaseDenominationId) {
    throw new BadRequestException('Для заказа сертификата доплата недоступна');
  }
  if (!isPaidEditableStatus(order.status)) {
    throw new BadRequestException('Доплата недоступна для этого заказа');
  }

  const { balanceDue, canPayBalance } = resolveOrderBalanceFields(
    order,
    order.payments,
  );
  if (!canPayBalance || balanceDue < 1) {
    throw new BadRequestException('Доплата не требуется');
  }

  const reusable = pickReusableSurchargePayment(order.payments, balanceDue);
  if (reusable?.confirmationUrl && reusable.externalId) {
    return {
      amount: balanceDue,
      confirmationUrl: reusable.confirmationUrl.trim(),
      paymentId: reusable.externalId,
      reused: true,
    };
  }

  const site =
    config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
    'http://localhost:5173';
  const returnUrl = `${site}/profile?tab=orders&order=${encodeURIComponent(order.number)}`;

  const { payment, confirmationUrl } = await yookassa.createRedirectPayment({
    amountRub: balanceDue,
    description: `Доплата по заказу ${order.number}`,
    orderId: order.id,
    orderNumber: order.number,
    customerEmail: order.email,
    returnUrl,
    kind: 'surcharge',
    receiptItems: [
      {
        description: `Доплата по заказу ${order.number}`.slice(0, 128),
        quantity: 1,
        amountRub: balanceDue,
      },
    ],
  });

  await upsertPendingOrderPayment(prisma, {
    orderId: order.id,
    provider: 'yookassa',
    amount: balanceDue,
    externalId: payment.id,
    confirmationUrl,
    raw: {
      kind: 'surcharge',
      yookassa: payment,
    } as Prisma.InputJsonValue,
  });

  return {
    amount: balanceDue,
    confirmationUrl,
    paymentId: payment.id,
    reused: false,
  };
}
