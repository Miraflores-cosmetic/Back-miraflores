import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import {
  MARKETING_CONSENT_VERSION,
  PRIVACY_CONSENT_VERSION,
} from './consent-versions';

describe('AuthService.registerBuyer', () => {
  const prisma = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    order: {
      updateMany: vi.fn(),
    },
  };
  const jwt = { sign: vi.fn(() => 'token'), verify: vi.fn() };
  const mail = {
    isConfigured: vi.fn(() => false),
    sendPasswordResetLink: vi.fn(),
  };
  let svc: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new AuthService(prisma as never, jwt as never, mail as never);
  });

  it('отклоняет без согласия на ПДн', async () => {
    await expect(
      svc.registerBuyer({
        email: 'a@b.com',
        password: 'password1',
        consentPersonalData: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('отклоняет слабый пароль (без цифры)', async () => {
    await expect(
      svc.registerBuyer({
        email: 'a@b.com',
        password: 'password',
        consentPersonalData: true,
      }),
    ).rejects.toThrow(/цифр/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('отклоняет дубликат email', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'exists' });
    await expect(
      svc.registerBuyer({
        email: 'a@b.com',
        password: 'password1',
        consentPersonalData: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('создаёт USER с marketingConsent=false по умолчанию', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      role: UserRole.USER,
      displayName: 'Ann',
    });

    const user = await svc.registerBuyer({
      email: 'A@B.com',
      password: 'password1',
      displayName: 'Ann',
      consentPersonalData: true,
    });

    expect(user.id).toBe('u1');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'a@b.com',
          role: UserRole.USER,
          displayName: 'Ann',
          privacyConsentVersion: PRIVACY_CONSENT_VERSION,
          marketingConsent: false,
          marketingConsentAt: null,
          marketingConsentVersion: null,
        }),
      }),
    );
  });

  it('фиксирует marketing flags при opt-in', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'u2',
      email: data.email,
      role: UserRole.USER,
      displayName: data.displayName ?? null,
    }));

    await svc.registerBuyer({
      email: 'm@b.com',
      password: 'password1',
      consentPersonalData: true,
      consentMarketing: true,
    });

    const call = prisma.user.create.mock.calls[0]![0] as {
      data: {
        marketingConsent: boolean;
        marketingConsentAt: Date | null;
        marketingConsentVersion: string | null;
      };
    };
    expect(call.data.marketingConsent).toBe(true);
    expect(call.data.marketingConsentAt).toBeInstanceOf(Date);
    expect(call.data.marketingConsentVersion).toBe(MARKETING_CONSENT_VERSION);
  });

  it('claimGuestOrders привязывает заказы с userId=null', async () => {
    prisma.order.updateMany.mockResolvedValue({ count: 2 });
    await expect(
      svc.claimGuestOrders('u1', 'guest-abc', 'A@B.co'),
    ).resolves.toEqual({
      claimed: 2,
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: {
        userId: null,
        OR: [
          { guestId: 'guest-abc' },
          { email: { equals: 'a@b.co', mode: 'insensitive' } },
        ],
      },
      data: { userId: 'u1' },
    });
  });

  it('claimGuestOrders только по email (без guestId)', async () => {
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    await expect(svc.claimGuestOrders('u1', null, 'guest@mail.ru')).resolves.toEqual({
      claimed: 1,
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: {
        userId: null,
        OR: [{ email: { equals: 'guest@mail.ru', mode: 'insensitive' } }],
      },
      data: { userId: 'u1' },
    });
  });
});

describe('AuthService (base)', () => {
  const prisma = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    order: {
      updateMany: vi.fn(),
    },
  };
  const jwt = { sign: vi.fn(() => 'token'), verify: vi.fn() };
  const mail = {
    isConfigured: vi.fn(() => false),
    sendPasswordResetLink: vi.fn(),
  };
  let svc: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    svc = new AuthService(prisma as never, jwt as never, mail as never);
  });

  it('validateAdmin возвращает null при неверном пароле', async () => {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('right', 4);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      email: 'admin@jcos.local',
      passwordHash: hash,
      role: UserRole.ADMIN,
      isActive: true,
    });

    await expect(svc.validateAdmin('admin@jcos.local', 'wrong')).resolves.toBeNull();
  });

  it('login подписывает JWT', async () => {
    const out = await svc.login({
      id: 'u1',
      email: 'admin@jcos.local',
      role: UserRole.ADMIN,
    });
    expect(out.access_token).toBe('token');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u1', role: UserRole.ADMIN }),
    );
  });

  it('requestPasswordReset шлёт письмо buyer без passwordHash', async () => {
    mail.isConfigured.mockReturnValue(true);
    mail.sendPasswordResetLink.mockResolvedValue(undefined);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u-etl',
      email: 'buyer@example.com',
    });

    const out = await svc.requestPasswordReset('Buyer@Example.com');

    expect(out.emailSent).toBe(true);
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u-etl',
        email: 'buyer@example.com',
        purpose: 'password_reset',
      }),
      expect.objectContaining({ expiresIn: expect.any(String) }),
    );
    expect(mail.sendPasswordResetLink).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'buyer@example.com' }),
    );
  });

  it('requestPasswordReset не шлёт письмо если buyer нет', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const out = await svc.requestPasswordReset('missing@example.com');
    expect(out.emailSent).toBe(false);
    expect(mail.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it('confirmPasswordReset задаёт пароль и claimGuestOrders по email', async () => {
    jwt.verify.mockReturnValue({
      sub: 'u-etl',
      email: 'buyer@example.com',
      purpose: 'password_reset',
      typ: 'pwreset',
    });
    prisma.user.findFirst.mockResolvedValue({ id: 'u-etl' });
    prisma.user.update.mockResolvedValue({});
    prisma.order.updateMany.mockResolvedValue({ count: 2 });

    await expect(
      svc.confirmPasswordReset('tok', 'password1'),
    ).resolves.toEqual({ ok: true });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-etl' },
        data: expect.objectContaining({
          passwordHash: expect.any(String),
          tokenVersion: { increment: 1 },
        }),
      }),
    );
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: {
        userId: null,
        OR: [{ email: { equals: 'buyer@example.com', mode: 'insensitive' } }],
      },
      data: { userId: 'u-etl' },
    });
  });
});
