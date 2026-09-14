import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type NewsletterAdminStats = {
  total: number;
  active: number;
  unsubscribed: number;
  withName: number;
  linkedToUser: number;
  last7Days: number;
  last30Days: number;
  bySource: Array<{ source: string; count: number }>;
};

function csvEscape(value: string | null | undefined): string {
  const s = value ?? '';
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

@Injectable()
export class NewsletterAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<NewsletterAdminStats> {
    const now = Date.now();
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [
      total,
      active,
      unsubscribed,
      withName,
      linkedToUser,
      last7Days,
      last30Days,
      bySourceRaw,
    ] = await Promise.all([
      this.prisma.newsletterSubscriber.count(),
      this.prisma.newsletterSubscriber.count({ where: { unsubscribedAt: null } }),
      this.prisma.newsletterSubscriber.count({
        where: { unsubscribedAt: { not: null } },
      }),
      this.prisma.newsletterSubscriber.count({
        where: {
          unsubscribedAt: null,
          AND: [{ name: { not: null } }, { name: { not: '' } }],
        },
      }),
      this.prisma.newsletterSubscriber.count({
        where: { unsubscribedAt: null, userId: { not: null } },
      }),
      this.prisma.newsletterSubscriber.count({
        where: { unsubscribedAt: null, subscribedAt: { gte: d7 } },
      }),
      this.prisma.newsletterSubscriber.count({
        where: { unsubscribedAt: null, subscribedAt: { gte: d30 } },
      }),
      this.prisma.newsletterSubscriber.groupBy({
        by: ['source'],
        where: { unsubscribedAt: null },
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      active,
      unsubscribed,
      withName,
      linkedToUser,
      last7Days,
      last30Days,
      bySource: bySourceRaw
        .map((r) => ({
          source: r.source,
          count: r._count._all,
        }))
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    };
  }

  async exportCsv(): Promise<string> {
    const rows = await this.prisma.newsletterSubscriber.findMany({
      orderBy: { subscribedAt: 'desc' },
      select: {
        email: true,
        name: true,
        source: true,
        subscribedAt: true,
        unsubscribedAt: true,
        userId: true,
      },
    });

    const header = [
      'email',
      'name',
      'source',
      'subscribedAt',
      'unsubscribedAt',
      'status',
      'userId',
    ].join(',');

    const lines = rows.map((r) =>
      [
        csvEscape(r.email),
        csvEscape(r.name),
        csvEscape(r.source),
        csvEscape(r.subscribedAt.toISOString()),
        csvEscape(r.unsubscribedAt?.toISOString() ?? ''),
        csvEscape(r.unsubscribedAt ? 'unsubscribed' : 'active'),
        csvEscape(r.userId ?? ''),
      ].join(','),
    );

    // BOM — чтобы Excel корректно открыл UTF-8
    return `\uFEFF${[header, ...lines].join('\n')}\n`;
  }
}
