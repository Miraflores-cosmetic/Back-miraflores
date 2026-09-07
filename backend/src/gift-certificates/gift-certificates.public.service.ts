import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeGiftApplyAmount,
  findUsableGiftCertificate,
  type GiftApplyResult,
} from './gift-certificate-hold.util';
import { expireOverdueGiftCertificates } from './gift-certificate-expire.util';
import type { PurchaseGiftCertificateDto } from './dto/purchase-gift-certificate.dto';
import {
  ForbiddenException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { formatPhoneE164, isValidPhone } from '../common/phone.util';
import { OrderPayTokenService } from '../orders/order-pay-token.service';
import { allocateNextOrderNumber } from '../orders/order-number';
import { GIFT_PURCHASE_SKU } from './gift-certificate-purchase.util';

export type GiftValidateResult = {
  code: string;
  applyAmount: number;
  payableBeforeGift: number;
  total: number;
  kind: 'gift';
};

@Injectable()
export class GiftCertificatesPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payTokens: OrderPayTokenService,
  ) {}

  listActiveDenominations() {
    return this.prisma.giftCertificateDenomination.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { faceValue: 'asc' }],
      select: {
        id: true,
        name: true,
        faceValue: true,
        validityDays: true,
        sortOrder: true,
        images: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            url: true,
            mediaType: true,
            sortOrder: true,
          },
        },
      },
    });
  }

  /**
   * Публичная проверка кода для корзины.
   * Не отдаёт balance/faceValue/certificateId и не различает причины отказа
   * (anti-enumeration). Детали — только на create order.
   */
  async validate(codeRaw: string, payableBeforeGift: number): Promise<GiftValidateResult> {
    await expireOverdueGiftCertificates(this.prisma);
    const payable = Math.max(0, Math.floor(payableBeforeGift));
    try {
      const row = await findUsableGiftCertificate(this.prisma, codeRaw);
      const applyAmount = computeGiftApplyAmount(row.balance, payable);
      if (applyAmount < 1) {
        throw new BadRequestException('Нечего оплачивать сертификатом');
      }
      return {
        kind: 'gift',
        code: row.code,
        applyAmount,
        payableBeforeGift: payable,
        total: Math.max(0, payable - applyAmount),
      };
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw new BadRequestException('Неверный или недоступный код сертификата');
      }
      throw e;
    }
  }

  async applyForCheckout(
    codeRaw: string,
    payableBeforeGift: number,
  ): Promise<GiftApplyResult> {
    await expireOverdueGiftCertificates(this.prisma);
    const payable = Math.max(0, Math.floor(payableBeforeGift));
    const row = await findUsableGiftCertificate(this.prisma, codeRaw);
    const applyAmount = computeGiftApplyAmount(row.balance, payable);
    if (applyAmount < 1) {
      throw new BadRequestException('Нечего оплачивать сертификатом');
    }
    return {
      certificateId: row.id,
      code: row.code,
      faceValue: row.faceValue,
      balance: row.balance,
      applyAmount,
      payableBeforeGift: payable,
      total: Math.max(0, payable - applyAmount),
    };
  }

  async createPurchase(dto: PurchaseGiftCertificateDto, userId?: string | null) {
    const email = dto.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Укажите email');
    if (!isValidPhone(dto.phone)) {
      throw new BadRequestException('Некорректный телефон');
    }
    const phone = formatPhoneE164(dto.phone);
    const customerName = dto.customerName.trim();
    if (!customerName) throw new BadRequestException('Укажите имя');

    const guestId = dto.guestId.trim();
    if (!guestId) throw new BadRequestException('guestId обязателен');

    const idempotencyKey = dto.idempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new BadRequestException('idempotencyKey обязателен');
    }

    const qty = Math.floor(dto.qty);
    if (qty < 1 || qty > 10) {
      throw new BadRequestException('Количество: от 1 до 10');
    }

    const recipientEmail =
      dto.recipientEmail?.trim().toLowerCase() || email;

    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      if (!existing.guestId || existing.guestId !== guestId) {
        throw new ForbiddenException('Заказ с таким ключом уже создан');
      }
      if (!existing.giftPurchaseDenominationId) {
        throw new ForbiddenException('Заказ с таким ключом уже создан');
      }
      return this.serializePurchase(existing);
    }

    const denom = await this.prisma.giftCertificateDenomination.findFirst({
      where: { id: dto.denominationId, active: true },
    });
    if (!denom) {
      throw new BadRequestException('Номинал недоступен');
    }

    const unitPrice = denom.faceValue;
    const subtotal = unitPrice * qty;
    const title = `Подарочный сертификат «${denom.name}»`;

    const order = await this.prisma.$transaction(async (tx) => {
      let created;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const number = await allocateNextOrderNumber(tx);
          created = await tx.order.create({
            data: {
              number,
              idempotencyKey,
              status: OrderStatus.AWAITING_PAYMENT,
              email,
              phone,
              customerName,
              guestId,
              userId: userId ?? null,
              promoCode: null,
              discountTotal: 0,
              giftCertificateAmount: 0,
              giftPurchaseDenominationId: denom.id,
              giftPurchaseRecipientEmail: recipientEmail,
              subtotal,
              total: subtotal,
              shippingCost: 0,
              shippingAddress: {
                city: '—',
                address: 'Электронный сертификат',
                apartment: '',
                postalCode: '',
                comment: 'Покупка подарочного сертификата',
              },
              items: {
                create: [
                  {
                    variantId: null,
                    shadeId: null,
                    title,
                    sku: GIFT_PURCHASE_SKU,
                    qty,
                    unitPrice,
                    lineTotal: subtotal,
                  },
                ],
              },
            },
            include: { items: true },
          });
          break;
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002'
          ) {
            const target = e.meta?.target;
            const targets = Array.isArray(target)
              ? target.map(String)
              : typeof target === 'string'
                ? [target]
                : [];
            if (targets.some((t) => t.includes('idempotencyKey'))) {
              const raced = await tx.order.findUnique({
                where: { idempotencyKey },
                include: { items: true },
              });
              if (raced) return raced;
            }
            if (attempt < 4) continue;
          }
          throw e;
        }
      }
      if (!created) throw new BadRequestException('Не удалось создать заказ');
      await tx.orderEvent.create({
        data: {
          orderId: created.id,
          type: 'CREATED',
          message: 'Заказ создан (сертификат)',
          meta: { source: 'gift_purchase' },
        },
      });
      return created;
    });

    return this.serializePurchase(order);
  }

  private serializePurchase(order: {
    id: string;
    number: string;
    status: OrderStatus;
    email: string;
    phone: string;
    subtotal: number;
    discountTotal: number;
    giftCertificateAmount: number;
    total: number;
    promoCode: string | null;
    giftCertificateCode: string | null;
    giftPurchaseDenominationId: string | null;
    giftPurchaseRecipientEmail: string | null;
    guestId: string | null;
    items: unknown;
  }) {
    const guestId = order.guestId?.trim() || '';
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      email: order.email,
      phone: order.phone,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      giftCertificateAmount: order.giftCertificateAmount,
      total: order.total,
      promoCode: order.promoCode,
      giftCertificateCode: order.giftCertificateCode,
      giftPurchaseDenominationId: order.giftPurchaseDenominationId,
      giftPurchaseRecipientEmail: order.giftPurchaseRecipientEmail,
      items: order.items,
      kind: 'gift_purchase' as const,
      payToken: guestId ? this.payTokens.issue(order.id, guestId) : null,
    };
  }
}
