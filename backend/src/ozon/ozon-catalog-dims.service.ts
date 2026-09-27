import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildDimsAudit, type AuditVariant, type DimsAudit } from './ozon-dims-audit';

/** Аудит и заполнение веса/габаритов вариантов для тарифа Ozon (эндпоинты — @SkipRlsTransaction). */
@Injectable()
export class OzonCatalogDimsService {
  private readonly logger = new Logger(OzonCatalogDimsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private withBypass<T>(fn: () => Promise<T>): Promise<T> {
    return this.prisma.runInRlsTransaction({ userId: '', bypass: true }, fn);
  }

  private async loadVariants(): Promise<AuditVariant[]> {
    const rows = await this.withBypass(() =>
      this.prisma.productVariant.findMany({
        select: {
          id: true,
          productId: true,
          name: true,
          sku: true,
          active: true,
          volumeMl: true,
          packageVolume: true,
          weightGrams: true,
          lengthMm: true,
          widthMm: true,
          heightMm: true,
          product: { select: { name: true, productType: true } },
        },
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      productType: r.product.productType ?? null,
      variantName: r.name,
      sku: r.sku,
      active: r.active,
      volumeMl: r.volumeMl,
      packageVolume: r.packageVolume,
      weightGrams: r.weightGrams,
      lengthMm: r.lengthMm,
      widthMm: r.widthMm,
      heightMm: r.heightMm,
    }));
  }

  async audit(): Promise<DimsAudit> {
    return buildDimsAudit(await this.loadVariants());
  }

  /** Записывает предложенные значения; поля без предложения (валидные) не трогает. */
  async applySuggestions(variantIds: string[]): Promise<{ updated: number; skipped: string[] }> {
    const wanted = new Set(variantIds);
    const { rows } = await this.audit();
    const targets = rows.filter((r) => wanted.has(r.id) && r.suggestion);
    const skipped = variantIds.filter((id) => !targets.some((t) => t.id === id));
    await this.withBypass(async () => {
      for (const r of targets) {
        const s = r.suggestion!;
        await this.prisma.productVariant.update({
          where: { id: r.id },
          data: {
            ...(s.weightGrams != null ? { weightGrams: s.weightGrams } : {}),
            ...(s.lengthMm != null ? { lengthMm: s.lengthMm, widthMm: s.widthMm, heightMm: s.heightMm } : {}),
          },
        });
      }
    });
    if (targets.length) {
      this.logger.log(`Ozon dims: applied suggestions to ${targets.length} variant(s)`);
    }
    return { updated: targets.length, skipped };
  }

  /** Ручная правка веса/габаритов одного варианта; возвращает обновлённый аудит. */
  async updateVariantDims(variantId: string, patch: VariantDimsPatch): Promise<DimsAudit> {
    const data = variantDimsUpdateData(patch);
    const found = await this.withBypass(() =>
      this.prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true } }),
    );
    if (!found) throw new NotFoundException('Вариант не найден');
    await this.withBypass(() => this.prisma.productVariant.update({ where: { id: variantId }, data }));
    this.logger.log(`Ozon dims: manual edit variant=${variantId} ${JSON.stringify(data)}`);
    return this.audit();
  }
}

export type VariantDimsPatch = {
  weightGrams?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
};

/** Стороны меняются только тройкой — иначе в каталоге окажется смесь старых и новых размеров. */
export function variantDimsUpdateData(patch: VariantDimsPatch): VariantDimsPatch {
  const sides = [patch.lengthMm, patch.widthMm, patch.heightMm];
  const sideCount = sides.filter((s) => s != null).length;
  if (sideCount !== 0 && sideCount !== 3) {
    throw new BadRequestException('Укажите все три габарита: длину, ширину и высоту');
  }
  if (patch.weightGrams == null && sideCount === 0) {
    throw new BadRequestException('Нечего сохранять: укажите вес или габариты');
  }
  return {
    ...(patch.weightGrams != null ? { weightGrams: patch.weightGrams } : {}),
    ...(sideCount === 3 ? { lengthMm: patch.lengthMm, widthMm: patch.widthMm, heightMm: patch.heightMm } : {}),
  };
}
