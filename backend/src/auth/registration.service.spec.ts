import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { RegistrationService } from './registration.service';

describe('RegistrationService', () => {
  const tx = {
    $queryRaw: vi.fn(),
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    registrationCompletion: {
      update: vi.fn(),
    },
  };

  const prisma = {
    user: {
      findUnique: vi.fn(),
    },
    registrationChallenge: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    registrationOtpDispatch: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    registrationCompletion: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const auth = {
    registerBuyer: vi.fn(),
    claimGuestOrders: vi.fn(),
    login: vi.fn(async () => ({ access_token: 'jwt' })),
  };
  const mail = {
    isConfigured: vi.fn(() => true),
    sendRegistrationOtp: vi.fn(async () => undefined),
  };
  const jwt = {
    signAsync: vi.fn(async () => 'completion-token'),
    verifyAsync: vi.fn(),
  };
  const config = {
    get: vi.fn((key: string): string | undefined => {
      if (key === 'NODE_ENV') return 'test';
      if (key === 'JWT_SECRET') return 'test-secret';
      if (key === 'REGISTRATION_TOKEN_SECRET') return 'reg-secret';
      return undefined;
    }),
  };

  let svc: RegistrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mail.isConfigured.mockReturnValue(true);
    prisma.registrationOtpDispatch.findFirst.mockResolvedValue(null);
    prisma.registrationOtpDispatch.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    config.get.mockImplementation((key: string): string | undefined => {
      if (key === 'NODE_ENV') return 'test';
      if (key === 'JWT_SECRET') return 'test-secret';
      if (key === 'REGISTRATION_TOKEN_SECRET') return 'reg-secret';
      return undefined;
    });
    svc = new RegistrationService(
      prisma as never,
      auth as never,
      mail as never,
      jwt as never,
      config as never,
    );
  });

  it('start: email с паролем — тот же message, без письма и без 409', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'hash' });
    const res = await svc.start({
      email: 'A@B.com',
      consentPersonalData: true,
    });
    expect(res.message).toMatch(/если этот email свободен/i);
    expect(res.otpSent).toBe(false);
    expect(mail.sendRegistrationOtp).not.toHaveBeenCalled();
    expect(prisma.registrationChallenge.create).not.toHaveBeenCalled();
  });

  it('start: passwordless (ETL) — шлёт OTP для claim', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: null });
    prisma.registrationChallenge.create.mockResolvedValue({ id: 'ch1' });
    prisma.registrationOtpDispatch.create.mockResolvedValue({ id: 'd1' });

    const res = await svc.start({
      email: 'etl@jcos.local',
      consentPersonalData: true,
    });

    expect(res.otpSent).toBe(true);
    expect(mail.sendRegistrationOtp).toHaveBeenCalledWith(
      'etl@jcos.local',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('start: cooldown — тот же message, без нового письма', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.registrationOtpDispatch.findFirst.mockResolvedValue({
      createdAt: new Date(),
    });
    const res = await svc.start({
      email: 'a@b.com',
      consentPersonalData: true,
    });
    expect(res.message).toMatch(/если этот email свободен/i);
    expect(res.otpSent).toBe(false);
    expect(mail.sendRegistrationOtp).not.toHaveBeenCalled();
  });

  it('start: шлёт OTP и создаёт challenge', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.registrationChallenge.create.mockResolvedValue({ id: 'ch1' });
    prisma.registrationOtpDispatch.create.mockResolvedValue({ id: 'd1' });

    const res = await svc.start({
      email: 'New@Jcos.local',
      displayName: 'Ann',
      consentPersonalData: true,
      consentMarketing: true,
    });

    expect(res.message).toMatch(/если этот email свободен/i);
    expect(res.otpSent).toBe(true);
    expect(prisma.registrationChallenge.deleteMany).toHaveBeenCalledWith({
      where: { email: 'new@jcos.local', expiresAt: { gt: expect.any(Date) } },
    });
    expect(prisma.registrationOtpDispatch.create).toHaveBeenCalledWith({
      data: { email: 'new@jcos.local' },
    });
    expect(mail.sendRegistrationOtp).toHaveBeenCalledWith(
      'new@jcos.local',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('start: без SMTP в non-dev → 500', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    mail.isConfigured.mockReturnValue(false);
    config.get.mockImplementation((key: string): string | undefined => {
      if (key === 'NODE_ENV') return 'production';
      if (key === 'JWT_SECRET') return 'secret';
      if (key === 'REGISTRATION_TOKEN_SECRET') return 'reg-secret';
      return undefined;
    });
    svc = new RegistrationService(
      prisma as never,
      auth as never,
      mail as never,
      jwt as never,
      config as never,
    );

    await expect(
      svc.start({ email: 'a@b.com', consentPersonalData: true }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('verify: неверный код → attempts++', async () => {
    const codeHash = await bcrypt.hash('111111', 4);
    prisma.registrationChallenge.findFirst.mockResolvedValue({
      id: 'ch1',
      email: 'a@b.com',
      displayName: null,
      codeHash,
      attempts: 0,
      consentPersonalData: true,
      consentMarketing: false,
    });

    await expect(
      svc.verify({ email: 'a@b.com', code: '000000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.registrationChallenge.update).toHaveBeenCalledWith({
      where: { id: 'ch1' },
      data: { attempts: { increment: 1 } },
    });
  });

  it('verify: верный код → completionToken с jti', async () => {
    const codeHash = await bcrypt.hash('123456', 4);
    prisma.registrationChallenge.findFirst.mockResolvedValue({
      id: 'ch1',
      email: 'a@b.com',
      displayName: 'Ann',
      codeHash,
      attempts: 1,
      consentPersonalData: true,
      consentMarketing: true,
    });
    prisma.registrationChallenge.delete.mockResolvedValue({});
    prisma.registrationCompletion.create.mockResolvedValue({ id: 'jti-1' });

    const res = await svc.verify({ email: 'a@b.com', code: '123456' });
    expect(res.completionToken).toBe('completion-token');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'register_complete',
        jti: 'jti-1',
        email: 'a@b.com',
      }),
      expect.objectContaining({ expiresIn: '1h' }),
    );
  });

  it('complete: user+usedAt в одной tx', async () => {
    jwt.verifyAsync.mockResolvedValue({
      purpose: 'register_complete',
      jti: 'jti-1',
      email: 'a@b.com',
    });
    prisma.registrationCompletion.findUnique.mockResolvedValue({
      id: 'jti-1',
      email: 'a@b.com',
      displayName: 'Ann',
      consentPersonalData: true,
      consentMarketing: false,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    tx.$queryRaw.mockResolvedValue([{ id: 'jti-1' }]);
    tx.user.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      role: 'USER',
      tokenVersion: 0,
    });
    tx.registrationCompletion.update.mockResolvedValue({});
    auth.claimGuestOrders.mockResolvedValue({ claimed: 0 });

    const res = await svc.complete({
      completionToken: 'tok',
      password: 'password1',
      guestId: 'g1',
    });

    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.registrationCompletion.update).toHaveBeenCalledWith({
      where: { id: 'jti-1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(auth.registerBuyer).not.toHaveBeenCalled();
    expect(auth.claimGuestOrders).toHaveBeenCalledWith('u1', 'g1', 'a@b.com');
    expect(res.access_token).toBe('jwt');
  });

  it('complete: email с паролем → usedAt + Conflict', async () => {
    jwt.verifyAsync.mockResolvedValue({
      purpose: 'register_complete',
      jti: 'jti-1',
      email: 'a@b.com',
    });
    prisma.registrationCompletion.findUnique.mockResolvedValue({
      id: 'jti-1',
      email: 'a@b.com',
      displayName: null,
      consentPersonalData: true,
      consentMarketing: false,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    tx.$queryRaw.mockResolvedValue([{ id: 'jti-1' }]);
    tx.user.findUnique.mockResolvedValue({ id: 'other', passwordHash: 'hash' });

    await expect(
      svc.complete({ completionToken: 'tok', password: 'password1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.registrationCompletion.update).toHaveBeenCalledWith({
      where: { id: 'jti-1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('complete: passwordless User → update пароля + claim', async () => {
    jwt.verifyAsync.mockResolvedValue({
      purpose: 'register_complete',
      jti: 'jti-1',
      email: 'a@b.com',
    });
    prisma.registrationCompletion.findUnique.mockResolvedValue({
      id: 'jti-1',
      email: 'a@b.com',
      displayName: 'Ann',
      consentPersonalData: true,
      consentMarketing: true,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    tx.$queryRaw.mockResolvedValue([{ id: 'jti-1' }]);
    tx.user.findUnique.mockResolvedValue({ id: 'u-etl', passwordHash: null });
    tx.user.update.mockResolvedValue({
      id: 'u-etl',
      email: 'a@b.com',
      role: 'USER',
      tokenVersion: 0,
    });
    tx.registrationCompletion.update.mockResolvedValue({});
    auth.claimGuestOrders.mockResolvedValue({ claimed: 1 });

    const res = await svc.complete({
      completionToken: 'tok',
      password: 'password1',
      guestId: 'g1',
    });

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-etl' },
        data: expect.objectContaining({
          passwordHash: expect.any(String),
          displayName: 'Ann',
        }),
      }),
    );
    expect(auth.claimGuestOrders).toHaveBeenCalledWith('u-etl', 'g1', 'a@b.com');
    expect(res.access_token).toBe('jwt');
  });

  it('complete: повторное использование jti → ошибка', async () => {
    jwt.verifyAsync.mockResolvedValue({
      purpose: 'register_complete',
      jti: 'jti-1',
      email: 'a@b.com',
    });
    prisma.registrationCompletion.findUnique.mockResolvedValue({
      id: 'jti-1',
      email: 'a@b.com',
      displayName: null,
      consentPersonalData: true,
      consentMarketing: false,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    });

    await expect(
      svc.complete({ completionToken: 'tok', password: 'password1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
