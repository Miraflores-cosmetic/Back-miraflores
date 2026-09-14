import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const CONSENT_VERSION = 'homepage-newsletter-v1';

@Injectable()
export class NewsletterPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(input: {
    email: string;
    name?: string | null;
    source?: string | null;
  }) {
    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Укажите корректный email');
    }
    const name = input.name?.trim() || null;
    const source = (input.source?.trim() || 'homepage').slice(0, 64);

    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        role: UserRole.USER,
        isActive: true,
      },
      select: { id: true, displayName: true, marketingConsent: true },
    });

    const row = await this.prisma.newsletterSubscriber.upsert({
      where: { email },
      create: {
        email,
        name,
        source,
        userId: user?.id ?? null,
        subscribedAt: new Date(),
        unsubscribedAt: null,
      },
      update: {
        name: name ?? undefined,
        source,
        userId: user?.id ?? undefined,
        subscribedAt: new Date(),
        unsubscribedAt: null,
      },
    });

    if (user) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          marketingConsent: true,
          marketingConsentAt: new Date(),
          marketingConsentVersion: CONSENT_VERSION,
          ...(name && !user.displayName?.trim() ? { displayName: name } : {}),
        },
      });
    }

    return {
      ok: true as const,
      email: row.email,
      alreadyUser: Boolean(user),
    };
  }
}
