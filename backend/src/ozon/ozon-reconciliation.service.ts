import { Injectable } from '@nestjs/common';
import { ShipmentProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildReconciliationReport, type ReconciliationReport } from './ozon-reconciliation';

@Injectable()
export class OzonReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async report(days: number): Promise<ReconciliationReport> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, () =>
      this.prisma.shipment.findMany({
        where: {
          provider: ShipmentProvider.OZON,
          carrierCostRub: { not: null },
          createdAt: { gte: since },
        },
        select: {
          createdAt: true,
          carrierCostRub: true,
          estimatedCostRub: true,
          billableGrams: true,
          tariffVersion: true,
          order: { select: { id: true, number: true, shippingAddress: true } },
        },
      }),
    );
    return buildReconciliationReport(
      rows.map((r) => {
        const comment = String((r.order.shippingAddress as { comment?: string } | null)?.comment ?? '');
        return {
          orderId: r.order.id,
          orderNumber: r.order.number,
          shippedAt: r.createdAt.toISOString(),
          dropoff: /(?:^|\|)dropoff=courier(?:\||$|__)/i.test(comment) ? 'courier' : 'pvz',
          billableGrams: r.billableGrams,
          estimatedCostRub: r.estimatedCostRub,
          carrierCostRub: r.carrierCostRub!,
          tariffVersion: r.tariffVersion,
        };
      }),
      { days },
    );
  }
}
