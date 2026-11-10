import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GiftCertificateSource,
  OrderStatus,
  Prisma,
  ReferralLedgerKind,
  ReferralLedgerStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { OrderChatService } from '../order-chat/order-chat.service';
import { scheduleAfterRlsCommitWithBypass } from '../rls/rls-after-commit';
import { CommerceContextService } from '../user-groups/commerce-context.service';
import { MARKETING_CONSENT_VERSION } from '../auth/consent-versions';
import { firstPasswordError, isPasswordValid } from '../auth/password-policy';
import {
  formatPhoneE164,
  isValidPhone,
} from '../common/phone.util';
import { lockOrderForUpdate } from '../orders/order-lock';
import { OrderPayTokenService } from '../orders/order-pay-token.service';
import { cancelUnpaidOrderInTx } from '../orders/cancel-unpaid-order';
import { cancelPendingAtProviders } from '../orders/cancel-pending-at-providers';
import { YandexPayService } from '../orders/yandex-pay.service';
import { YooKassaService } from '../orders/yookassa.service';
import type {
  ChangeBuyerPasswordDto,
  UpdateBuyerProfileDto,
  UpsertBuyerAddressDto,
} from './dto/account.dto';
import { ReferralCodeService } from '../referral/referral-code.service';
import { ReferralStickyService } from '../referral/referral-sticky.service';
import { ReferralWalletService } from '../referral/referral-wallet.service';

const BCRYPT_ROUNDS = 10;

/** Заказы покупателя: по userId или «сироты» staff-create с тем же email. */
async function buyerOrderAccessWhere(
  prisma: PrismaService,
  userId: string,
): Promise<Prisma.OrderWhereInput> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const email = user?.email?.trim().toLowerCase();
  if (!email) return { userId };
  return {
    OR: [{ userId }, { userId: null, email }],
  };
}

const addressSelect = {
  id: true,
  recipientName: true,
  phone: true,
  city: true,
  address: true,
  apartment: true,
  region: true,
  district: true,
  postalCode: true,
  comment: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ShippingAddressSnap = {
  city?: string;
  address?: string;
  apartment?: string;
  region?: string;
  district?: string;
  postalCode?: string;
  comment?: string;
  pvzCode?: string;
  phone?: string;
  recipientName?: string;
};

/** Пустая строка → null; иначе E.164 или BadRequest. */
function normalizeOptionalPhone(raw: string | null | undefined): string | null {
  const t = raw?.trim() || '';
  if (!t) return null;
  if (!isValidPhone(t)) {
    throw new BadRequestException('Некорректный телефон');
  }
  return formatPhoneE164(t);
}

function normalizeOptionalBirthday(raw: string | null | undefined): Date | null {
  const t = raw?.trim() || '';
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new BadRequestException('Некорректная дата рождения');
  }
  const d = new Date(`${t}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Некорректная дата рождения');
  }
  return d;
}

function formatBirthdayIso(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payTokens: OrderPayTokenService,
    private readonly yookassa: YooKassaService,
    private readonly yandexPay: YandexPayService,
    private readonly commerceContext: CommerceContextService,
    private readonly orderChat: OrderChatService,
    private readonly referralCodes: ReferralCodeService,
    private readonly referralWallet: ReferralWalletService,
    private readonly referralSticky: ReferralStickyService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        birthday: true,
        marketingConsent: true,
        marketingConsentAt: true,
        createdAt: true,
        referralCode: true,
        referralCodeActive: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Legacy buyers without code — lazy issue on profile load.
    let referralCode = user.referralCode;
    let referralCodeActive = user.referralCodeActive;
    if (!referralCode) {
      const issued = await this.referralCodes.ensureForUser(userId);
      referralCode = issued.code;
      referralCodeActive = issued.active;
    }

    const [
      hasGiftCertificates,
      pricing,
      referralWalletAvailable,
      referralWalletPending,
      spendPolicy,
    ] = await Promise.all([
      this.hasPurchasedGiftCertificates(userId, user.email),
      this.commerceContext.resolveFromUserId(userId),
      this.referralWallet.availableBalance(userId),
      this.referralWallet.pendingBalance(userId),
      this.referralWallet.getSpendPolicy(),
    ]);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      phone: user.phone,
      birthday: formatBirthdayIso(user.birthday),
      marketingConsent: user.marketingConsent,
      marketingConsentAt: user.marketingConsentAt,
      createdAt: user.createdAt,
      referralCode,
      referralCodeActive,
      referralLinkPath: referralCode ? `/?mf=${encodeURIComponent(referralCode)}` : null,
      referralWalletAvailable,
      referralWalletPending,
      /** Программа включена (spend gated). */
      referralEnabled: spendPolicy.enabled,
      /** Cap % от payable до wallet — для checkout preview. */
      referralSpendCapPercent: spendPolicy.spendCapPercent,
      /** TTL attribution ?mf= (дни) — Front localStorage. */
      referralLinkTtlDays: spendPolicy.linkTtlDays,
      hasGiftCertificates,
      pricing: {
        context: pricing.kind,
        group: {
          id: pricing.groupId,
          name: pricing.groupName,
          slug: pricing.groupSlug,
        },
        allowCatalogDiscounts: pricing.allowCatalogDiscounts,
        allowPromoCodes: pricing.allowPromoCodes,
      },
    };
  }

  /** Явная кнопка ЛК «получить / обновить ссылку» — ensure (без regenerate). */
  async ensureReferralCode(userId: string) {
    const issued = await this.referralCodes.ensureForUser(userId);
    return {
      code: issued.code,
      active: issued.active,
      created: issued.created,
      linkPath: `/?mf=${encodeURIComponent(issued.code)}`,
    };
  }

  /**
   * Публичный quoteSpend: amount = min(available, floor(payable×cap%)).
   * Checkout preview обычно берёт cap из /me; этот endpoint — точный server quote.
   */
  async quoteReferralSpend(userId: string, payableRub: number) {
    return this.referralWallet.quoteSpend(userId, payableRub);
  }

  /**
   * ЛК Phase 4: dual balance + ссылка + shareText template.
   * Absolute URL / UTM собирает Front (origin + linkPath).
   */
  async getReferralDashboard(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        referralCode: true,
        referralCodeActive: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    let code = user.referralCode;
    let codeActive = user.referralCodeActive;
    if (!code) {
      const issued = await this.referralCodes.ensureForUser(userId);
      code = issued.code;
      codeActive = issued.active;
    }

    const [available, pending, policy, share, friendsInvited, friendsWithEarn] =
      await Promise.all([
        this.referralWallet.availableBalance(userId),
        this.referralWallet.pendingBalance(userId),
        this.referralWallet.getSpendPolicy(),
        this.referralWallet.getBuyerShare(),
        this.prisma.orderReferralAttribution.count({
          where: { referrerUserId: userId },
        }),
        this.prisma.referralWalletLedger.count({
          where: {
            userId,
            kind: ReferralLedgerKind.EARN,
            status: {
              in: [ReferralLedgerStatus.PENDING, ReferralLedgerStatus.POSTED],
            },
          },
        }),
      ]);

    return {
      enabled: policy.enabled,
      code,
      codeActive,
      linkPath: code ? `/?mf=${encodeURIComponent(code)}` : null,
      shareTextTemplate: share.shareTextTemplate,
      available,
      pending,
      spendCapPercent: policy.spendCapPercent,
      linkTtlDays: policy.linkTtlDays,
      earnPercent: policy.earnPercent,
      quarantineMode: policy.quarantineMode,
      quarantineDays: policy.quarantineDays,
      inviteeBonusEnabled: share.inviteeBonusEnabled,
      inviteeBonusRub: share.inviteeBonusRub,
      friendsInvited,
      friendsWithEarn,
    };
  }

  /** Sticky bind после login, если LS ещё держит ?mf=. */
  async bindReferralCode(userId: string, codeRaw: string | null | undefined) {
    return this.referralSticky.bindByCode(userId, codeRaw);
  }

  async listReferralLedger(
    userId: string,
    opts: {
      limit?: number;
      cursor?: string | null;
      filter?: 'all' | 'pending' | 'spend' | null;
    },
  ) {
    return this.referralWallet.listLedgerHistory(userId, opts);
  }

  /** Пункт меню ЛК — только если есть купленный (PURCHASE) сертификат. */
  private async hasPurchasedGiftCertificates(
    userId: string,
    email: string,
  ): Promise<boolean> {
    const emailNorm = email.trim().toLowerCase();
    const asRecipient = await this.prisma.giftCertificate.count({
      where: {
        source: GiftCertificateSource.PURCHASE,
        OR: [
          { recipientUserId: userId },
          ...(emailNorm ? [{ recipientEmail: emailNorm }] : []),
        ],
      },
    });
    if (asRecipient > 0) return true;
    const asBuyer = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT gc.id
      FROM "GiftCertificate" gc
      INNER JOIN "Order" o ON o.id = gc."purchaseOrderId"
      WHERE o."userId" = ${userId}
        AND gc.source = 'PURCHASE'
      LIMIT 1
    `;
    return asBuyer.length > 0;
  }

  async listGiftCertificates(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const emailNorm = user.email.trim().toLowerCase();

    const viaOrderIds = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT gc.id
      FROM "GiftCertificate" gc
      INNER JOIN "Order" o ON o.id = gc."purchaseOrderId"
      WHERE o."userId" = ${userId}
        AND gc.source = 'PURCHASE'
    `;
    const idsFromOrders = viaOrderIds.map((r) => r.id);

    const rows = await this.prisma.giftCertificate.findMany({
      where: {
        source: GiftCertificateSource.PURCHASE,
        OR: [
          { recipientUserId: userId },
          ...(emailNorm ? [{ recipientEmail: emailNorm }] : []),
          ...(idsFromOrders.length ? [{ id: { in: idsFromOrders } }] : []),
        ],
      },
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        code: true,
        faceValue: true,
        balance: true,
        status: true,
        source: true,
        issuedAt: true,
        expiresAt: true,
        denomination: { select: { name: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      faceValue: r.faceValue,
      balance: r.balance,
      status: r.status,
      source: r.source,
      issuedAt: r.issuedAt,
      expiresAt: r.expiresAt,
      denominationName: r.denomination?.name ?? null,
    }));
  }

  async updateProfile(userId: string, dto: UpdateBuyerProfileDto) {
    const data: {
      displayName?: string | null;
      phone?: string | null;
      birthday?: Date | null;
      marketingConsent?: boolean;
      marketingConsentAt?: Date | null;
      marketingConsentVersion?: string | null;
    } = {};

    if (dto.displayName !== undefined) {
      const name = dto.displayName?.trim() || null;
      data.displayName = name;
    }
    if (dto.phone !== undefined) {
      data.phone = normalizeOptionalPhone(dto.phone);
    }
    if (dto.birthday !== undefined) {
      data.birthday = normalizeOptionalBirthday(dto.birthday);
    }
    if (dto.marketingConsent !== undefined) {
      const on = dto.marketingConsent === true;
      data.marketingConsent = on;
      data.marketingConsentAt = on ? new Date() : null;
      data.marketingConsentVersion = on ? MARKETING_CONSENT_VERSION : null;
    }

    const row = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        birthday: true,
        marketingConsent: true,
        marketingConsentAt: true,
        createdAt: true,
      },
    });
    return {
      ...row,
      birthday: formatBirthdayIso(row.birthday),
    };
  }

  async changePassword(userId: string, dto: ChangeBuyerPasswordDto) {
    if (!isPasswordValid(dto.newPassword)) {
      throw new BadRequestException(
        firstPasswordError(dto.newPassword) ?? 'Некорректный пароль',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user?.passwordHash) throw new NotFoundException('User not found');
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Неверный текущий пароль');
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    return { ok: true as const };
  }

  listAddresses(userId: string) {
    return this.prisma.userAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      select: addressSelect,
    });
  }

  async createAddress(userId: string, dto: UpsertBuyerAddressDto) {
    const count = await this.prisma.userAddress.count({ where: { userId } });
    const makeDefault = dto.isDefault === true || count === 0;

    return this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.userAddress.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.userAddress.create({
        data: {
          userId,
          recipientName: dto.recipientName?.trim() || null,
          phone: normalizeOptionalPhone(dto.phone),
          city: dto.city.trim(),
          address: dto.address.trim(),
          apartment: dto.apartment?.trim() || null,
          region: dto.region?.trim() || null,
          district: dto.district?.trim() || null,
          postalCode: dto.postalCode?.trim() || null,
          comment: dto.comment?.trim() || null,
          isDefault: makeDefault,
        },
        select: addressSelect,
      });
    });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: UpsertBuyerAddressDto,
  ) {
    const existing = await this.prisma.userAddress.findUnique({
      where: { id: addressId },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Адрес не найден');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.userAddress.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const updated = await tx.userAddress.update({
        where: { id: addressId },
        data: {
          recipientName:
            dto.recipientName !== undefined
              ? dto.recipientName?.trim() || null
              : undefined,
          phone:
            dto.phone !== undefined
              ? normalizeOptionalPhone(dto.phone)
              : undefined,
          city: dto.city.trim(),
          address: dto.address.trim(),
          apartment:
            dto.apartment !== undefined
              ? dto.apartment?.trim() || null
              : undefined,
          region:
            dto.region !== undefined
              ? dto.region?.trim() || null
              : undefined,
          district:
            dto.district !== undefined
              ? dto.district?.trim() || null
              : undefined,
          postalCode:
            dto.postalCode !== undefined
              ? dto.postalCode?.trim() || null
              : undefined,
          comment:
            dto.comment !== undefined ? dto.comment?.trim() || null : undefined,
          ...(dto.isDefault !== undefined
            ? { isDefault: dto.isDefault === true }
            : {}),
        },
        select: addressSelect,
      });

      if (dto.isDefault === false && existing.isDefault) {
        const next = await tx.userAddress.findFirst({
          where: { userId, id: { not: addressId } },
          orderBy: { updatedAt: 'desc' },
        });
        if (next) {
          await tx.userAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }

      return updated;
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    const existing = await this.prisma.userAddress.findUnique({
      where: { id: addressId },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Адрес не найден');
    }
    await this.prisma.userAddress.delete({ where: { id: addressId } });
    if (existing.isDefault) {
      const next = await this.prisma.userAddress.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (next) {
        await this.prisma.userAddress.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
    return { ok: true };
  }

  async setDefaultAddress(userId: string, addressId: string) {
    const existing = await this.prisma.userAddress.findUnique({
      where: { id: addressId },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Адрес не найден');
    }
    await this.prisma.$transaction([
      this.prisma.userAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.userAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
      }),
    ]);
    return this.listAddresses(userId);
  }

  private mapOrderItems(
    items: Array<{
      id: string;
      title: string;
      sku: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
      isGratitudeGift?: boolean;
      shade: { name: string; imageUrl: string | null } | null;
      variant: {
        id: string;
        name: string;
        galleryLinks?: Array<{ productImage: { url: string } | null }>;
        product: {
          id: string;
          slug: string;
          productType: string | null;
          images: Array<{ url: string }>;
        } | null;
      } | null;
    }>,
  ) {
    return items.map((i) => ({
      id: i.id,
      title: i.title,
      sku: i.sku,
      qty: i.qty,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      isGift: Boolean(i.isGratitudeGift),
      subtitle: i.shade?.name ?? i.variant?.name ?? null,
      variantId: i.variant?.id ?? null,
      variantName: i.variant?.name ?? null,
      shadeName: i.shade?.name ?? null,
      productId: i.variant?.product?.id ?? null,
      productSlug: i.variant?.product?.slug ?? null,
      productType: i.variant?.product?.productType ?? null,
      // Первое фото галереи, не swatch оттенка.
      imageUrl:
        i.variant?.galleryLinks?.[0]?.productImage?.url ??
        i.variant?.product?.images?.[0]?.url ??
        i.shade?.imageUrl ??
        null,
    }));
  }

  async listOrders(userId: string) {
    const accessWhere = await buyerOrderAccessWhere(this.prisma, userId);
    const orders = await this.prisma.order.findMany({
      where: accessWhere,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        number: true,
        status: true,
        total: true,
        subtotal: true,
        shippingCost: true,
        discountTotal: true,
        giftCertificateAmount: true,
        createdAt: true,
        guestId: true,
        needsAddressClarification: true,
        items: {
          select: {
            id: true,
            title: true,
            sku: true,
            qty: true,
            unitPrice: true,
            lineTotal: true,
            isGratitudeGift: true,
            shade: { select: { name: true, imageUrl: true } },
            variant: {
              select: {
                id: true,
                name: true,
                galleryLinks: {
                  take: 1,
                  orderBy: { sortOrder: 'asc' },
                  select: { productImage: { select: { url: true } } },
                },
                product: {
                  select: {
                    id: true,
                    slug: true,
                    productType: true,
                    images: {
                      take: 1,
                      orderBy: { sortOrder: 'asc' },
                      select: { url: true },
                    },
                  },
                },
              },
            },
          },
        },
        shipments: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: { tracking: true, provider: true },
        },
      },
    });

    const orphanIds = orders.filter((o) => !o.userId).map((o) => o.id);
    if (orphanIds.length > 0) {
      await this.prisma.order.updateMany({
        where: { id: { in: orphanIds }, userId: null },
        data: { userId },
      });
    }

    const needGuestIds = orders.filter(
      (o) =>
        (o.status === OrderStatus.AWAITING_PAYMENT ||
          o.status === OrderStatus.NEW) &&
        !o.needsAddressClarification &&
        !o.guestId?.trim(),
    );
    if (needGuestIds.length > 0) {
      const { randomUUID } = await import('node:crypto');
      await Promise.all(
        needGuestIds.map(async (o) => {
          const guestId = randomUUID();
          await this.prisma.order.update({
            where: { id: o.id },
            data: { guestId },
          });
          o.guestId = guestId;
        }),
      );
    }

    return orders.map((o) => {
      const awaitingUnpaid =
        o.status === OrderStatus.AWAITING_PAYMENT || o.status === OrderStatus.NEW;
      const needsAddressClarification = Boolean(o.needsAddressClarification);
      const canPay = awaitingUnpaid && !needsAddressClarification;
      const guestId = o.guestId?.trim() || '';
      return {
        id: o.id,
        number: o.number,
        status: o.status,
        total: o.total,
        subtotal: o.subtotal,
        shippingCost: o.shippingCost,
        discountTotal: o.discountTotal,
        giftCertificateAmount: o.giftCertificateAmount,
        createdAt: o.createdAt,
        items: this.mapOrderItems(o.items),
        tracking: o.shipments[0]?.tracking?.trim() || null,
        trackingProvider: o.shipments[0]?.provider ?? null,
        needsAddressClarification,
        canPay,
        payToken: canPay && guestId ? this.payTokens.issue(o.id, guestId) : null,
        // Авто-отмена отключена: оплата пока AWAITING/NEW — без hard cutoff в ЛК.
        payExpiresAt: null,
      };
    });
  }

  async getOrder(userId: string, orderId: string) {
    const accessWhere = await buyerOrderAccessWhere(this.prisma, userId);
    const order = await this.prisma.order.findFirst({
      where: { AND: [{ id: orderId }, accessWhere] },
      select: {
        id: true,
        userId: true,
        number: true,
        status: true,
        email: true,
        phone: true,
        customerName: true,
        shippingAddress: true,
        shippingCost: true,
        subtotal: true,
        discountTotal: true,
        total: true,
        refundedAmount: true,
        promoCode: true,
        pricingGroupId: true,
        pricingGroupName: true,
        pricingContext: true,
        giftCertificateCode: true,
        giftCertificateAmount: true,
        guestId: true,
        needsAddressClarification: true,
        createdAt: true,
        shipments: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            id: true,
            provider: true,
            tracking: true,
            status: true,
            createdAt: true,
          },
        },
        items: {
          select: {
            id: true,
            title: true,
            sku: true,
            qty: true,
            unitPrice: true,
            lineTotal: true,
            isGratitudeGift: true,
            shade: { select: { name: true, imageUrl: true } },
            variant: {
              select: {
                id: true,
                name: true,
                galleryLinks: {
                  take: 1,
                  orderBy: { sortOrder: 'asc' },
                  select: { productImage: { select: { url: true } } },
                },
                product: {
                  select: {
                    id: true,
                    slug: true,
                    productType: true,
                    images: {
                      take: 1,
                      orderBy: { sortOrder: 'asc' },
                      select: { url: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (!order.userId) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { userId },
      });
    }

    const snap = (order.shippingAddress ?? null) as ShippingAddressSnap | null;
    const awaitingUnpaid =
      order.status === OrderStatus.AWAITING_PAYMENT ||
      order.status === OrderStatus.NEW;
    const needsAddressClarification = Boolean(order.needsAddressClarification);
    const canPay = awaitingUnpaid && !needsAddressClarification;
    const canCancelUnpaid = awaitingUnpaid;
    let guestId = order.guestId?.trim() || '';
    if (canPay && !guestId) {
      const { randomUUID } = await import('node:crypto');
      guestId = randomUUID();
      await this.prisma.order.update({
        where: { id: order.id },
        data: { guestId },
      });
    }
    // Авто-отмена отключена: не отдаём дедлайн оплаты (UI раньше гейтил по нему).
    const payExpiresAt: string | null = null;

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      email: order.email,
      phone: order.phone,
      customerName: order.customerName,
      shippingAddress: snap
        ? {
            city: snap.city ?? '',
            address: snap.address ?? '',
            apartment: snap.apartment ?? '',
            region: snap.region ?? '',
            district: snap.district ?? '',
            postalCode: snap.postalCode ?? '',
            comment: snap.comment ?? '',
            pvzCode: snap.pvzCode ?? '',
            phone: snap.phone ?? '',
            recipientName: snap.recipientName ?? '',
          }
        : null,
      shippingCost: order.shippingCost,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      total: order.total,
      refundedAmount: order.refundedAmount,
      promoCode: order.promoCode,
      pricingGroup: order.pricingGroupName
        ? {
            id: order.pricingGroupId,
            name: order.pricingGroupName,
            context: order.pricingContext,
          }
        : null,
      giftCertificateCode: order.giftCertificateCode,
      giftCertificateAmount: order.giftCertificateAmount,
      createdAt: order.createdAt,
      shipments: order.shipments,
      items: this.mapOrderItems(order.items),
      payToken: canPay && guestId ? this.payTokens.issue(order.id, guestId) : null,
      payExpiresAt,
      needsAddressClarification,
      canPay,
      canCancel: canCancelUnpaid,
    };
  }

  /** Покупатель отменяет неоплаченный заказ (AWAITING/NEW). */
  async cancelOrder(userId: string, orderId: string) {
    const accessWhere = await buyerOrderAccessWhere(this.prisma, userId);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, orderId);
      const order = await tx.order.findFirst({
        where: { AND: [{ id: orderId }, accessWhere] },
        include: { items: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (
        order.status !== OrderStatus.AWAITING_PAYMENT &&
        order.status !== OrderStatus.NEW
      ) {
        throw new BadRequestException(
          'Отменить можно только заказ, ожидающий оплаты',
        );
      }

      return cancelUnpaidOrderInTx(tx, {
        orderId: order.id,
        fromStatus: order.status,
        items: order.items,
        message: 'Заказ отменён покупателем',
        actorUserId: userId,
        reason: 'account',
        referralWallet: this.referralWallet,
      });
    });

    if (result.pendingPayments.length) {
      await cancelPendingAtProviders(result.pendingPayments, {
        yookassa: this.yookassa,
        yandexPay: this.yandexPay,
      });
    }

    scheduleAfterRlsCommitWithBypass(this.prisma, () =>
      this.orderChat.applyRetentionForOrder(result.id, OrderStatus.CANCELLED),
    );

    return this.getOrder(userId, result.id);
  }
}