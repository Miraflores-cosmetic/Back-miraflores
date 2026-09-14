import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsletterAdminService } from './newsletter-admin.service';

function makeService() {
  const prisma = {
    newsletterSubscriber: {
      count: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const svc = new NewsletterAdminService(prisma as never);
  return { svc, prisma };
}

describe('NewsletterAdminService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates stats for active subscribers', async () => {
    const { svc, prisma } = makeService();
    prisma.newsletterSubscriber.count
      .mockResolvedValueOnce(5) // total
      .mockResolvedValueOnce(4) // active
      .mockResolvedValueOnce(1) // unsubscribed
      .mockResolvedValueOnce(2) // withName
      .mockResolvedValueOnce(3) // linkedToUser
      .mockResolvedValueOnce(1) // last7
      .mockResolvedValueOnce(2); // last30
    prisma.newsletterSubscriber.groupBy.mockResolvedValue([
      { source: 'homepage', _count: { _all: 3 } },
      { source: 'article:foo', _count: { _all: 1 } },
    ]);

    await expect(svc.getStats()).resolves.toEqual({
      total: 5,
      active: 4,
      unsubscribed: 1,
      withName: 2,
      linkedToUser: 3,
      last7Days: 1,
      last30Days: 2,
      bySource: [
        { source: 'homepage', count: 3 },
        { source: 'article:foo', count: 1 },
      ],
    });
  });

  it('exports CSV with BOM and status column', async () => {
    const { svc, prisma } = makeService();
    prisma.newsletterSubscriber.findMany.mockResolvedValue([
      {
        email: 'a@b.c',
        name: 'Ann',
        source: 'homepage',
        subscribedAt: new Date('2026-01-02T00:00:00.000Z'),
        unsubscribedAt: null,
        userId: 'u1',
      },
    ]);

    const csv = await svc.exportCsv();
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('email,name,source,subscribedAt,unsubscribedAt,status,userId');
    expect(csv).toContain('a@b.c,Ann,homepage,2026-01-02T00:00:00.000Z,,active,u1');
  });
});
