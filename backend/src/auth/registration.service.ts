import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { randomInt } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import {
  MARKETING_CONSENT_VERSION,
  PRIVACY_CONSENT_VERSION,
} from './consent-versions';
import { resolveRegistrationTokenSecret } from './jwt-secret';
import { firstPasswordError } from './password-policy';
import type {
  RegisterCompleteDto,
  RegisterStartDto,
  RegisterVerifyDto,
} from './dto/auth.dto';

const OTP_TTL_MS = 10 * 60 * 1000;
const COMPLETION_TTL_MS = 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const OTP_BCRYPT_ROUNDS = 8;
const USER_BCRYPT_ROUNDS = 10;
/** Пауза между повторными start на один email (anti-flood). */
const EMAIL_COOLDOWN_MS = 75_000;
/** Макс. OTP-писем на адрес за календарные сутки UTC. */
const EMAIL_DAILY_LIMIT = 10;
/** Мин. длительность start (сглаживание timing side-channel). В test = 0. */
const START_MIN_MS = 450;

const START_MESSAGE =
  'Если этот email свободен, мы отправили код подтверждения. Проверьте почту (и «Спам»).';

export type RegistrationCompletionPayload = {
  purpose: 'register_complete';
  jti: string;
  email: string;
};

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    // Fail-fast при старте приложения (prod без отдельного секрета не поднимется).
    resolveRegistrationTokenSecret(this.config);
  }

  private isDev(): boolean {
    const env = this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    return !env || env === 'development';
  }

  private isTest(): boolean {
    return (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'test';
  }

  private regTokenSecret(): string {
    return resolveRegistrationTokenSecret(this.config);
  }

  private normalizeEmail(raw: string): string {
    return raw.trim().toLowerCase();
  }

  private generateOtp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private utcDayStart(d = new Date()): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  /** Выравнивает время ответа start (занятый email vs SMTP). */
  private async padStartTiming(startedAt: number): Promise<void> {
    if (this.isTest()) return;
    const left = START_MIN_MS - (Date.now() - startedAt);
    if (left > 0) {
      await new Promise((r) => setTimeout(r, left));
    }
  }

  /**
   * Anti-enumeration: одинаковый ответ всегда.
   * Cooldown / daily limit / занятый email — без отправки, без 409.
   * CAPTCHA/Turnstile — при росте ботов (сейчас IP throttle + email limits).
   */
  async start(
    dto: RegisterStartDto,
  ): Promise<{ message: string; otpSent: boolean }> {
    const startedAt = Date.now();
    const email = this.normalizeEmail(dto.email);
    if (!email) throw new BadRequestException('Укажите email');
    if (!dto.consentPersonalData) {
      throw new BadRequestException(
        'Нужно согласие на обработку персональных данных',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
    // Аккаунт с паролем — anti-enumeration, без письма.
    // Passwordless (ETL Saleor) — шлём OTP, complete задаст пароль на существующий User.
    if (existing?.passwordHash) {
      await this.padStartTiming(startedAt);
      return { message: START_MESSAGE, otpSent: false };
    }

    const latest = await this.prisma.registrationOtpDispatch.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < EMAIL_COOLDOWN_MS) {
      await this.padStartTiming(startedAt);
      return { message: START_MESSAGE, otpSent: false };
    }

    const sentToday = await this.prisma.registrationOtpDispatch.count({
      where: { email, createdAt: { gte: this.utcDayStart() } },
    });
    if (sentToday >= EMAIL_DAILY_LIMIT) {
      this.logger.warn(`Registration OTP daily limit for ${email}`);
      await this.padStartTiming(startedAt);
      return { message: START_MESSAGE, otpSent: false };
    }

    if (!this.mail.isConfigured() && !this.isDev()) {
      throw new InternalServerErrorException(
        'Регистрация временно недоступна: почта не настроена',
      );
    }

    // Инвалидируем только активные коды для этого email (п.10: чужой email не трогаем).
    await this.prisma.registrationChallenge.deleteMany({
      where: { email, expiresAt: { gt: new Date() } },
    });

    const code = this.generateOtp();
    const codeHash = await bcrypt.hash(code, OTP_BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const displayName = dto.displayName?.trim() || null;

    const challenge = await this.prisma.registrationChallenge.create({
      data: {
        email,
        displayName,
        codeHash,
        expiresAt,
        consentPersonalData: true,
        consentMarketing: dto.consentMarketing === true,
      },
    });

    try {
      if (this.mail.isConfigured()) {
        await this.mail.sendRegistrationOtp(email, code);
      } else {
        this.logger.warn(
          `SMTP not configured — registration OTP for ${email}: ${code}`,
        );
      }
      await this.prisma.registrationOtpDispatch.create({
        data: { email },
      });
    } catch (e) {
      await this.prisma.registrationChallenge
        .delete({ where: { id: challenge.id } })
        .catch(() => undefined);
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`sendRegistrationOtp failed: ${msg}`);
      throw new InternalServerErrorException(
        'Не удалось отправить письмо. Попробуйте позже.',
      );
    }

    await this.padStartTiming(startedAt);
    return { message: START_MESSAGE, otpSent: true };
  }

  async verify(dto: RegisterVerifyDto): Promise<{ completionToken: string }> {
    const email = this.normalizeEmail(dto.email);
    const challenge = await this.prisma.registrationChallenge.findFirst({
      where: {
        email,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      throw new BadRequestException(
        'Код устарел или не найден. Запросите новый.',
      );
    }

    if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
      await this.prisma.registrationChallenge.delete({
        where: { id: challenge.id },
      });
      throw new BadRequestException(
        'Превышено число попыток. Запросите код заново.',
      );
    }

    const ok = await bcrypt.compare(dto.code, challenge.codeHash);
    if (!ok) {
      await this.prisma.registrationChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Неверный код');
    }

    await this.prisma.registrationChallenge.delete({
      where: { id: challenge.id },
    });

    const completion = await this.prisma.registrationCompletion.create({
      data: {
        email: challenge.email,
        displayName: challenge.displayName,
        consentPersonalData: challenge.consentPersonalData,
        consentMarketing: challenge.consentMarketing,
        expiresAt: new Date(Date.now() + COMPLETION_TTL_MS),
      },
    });

    const payload: RegistrationCompletionPayload = {
      purpose: 'register_complete',
      jti: completion.id,
      email: challenge.email,
    };

    const completionToken = await this.jwt.signAsync(
      { ...payload, sub: 'register-complete' },
      { secret: this.regTokenSecret(), expiresIn: '1h' },
    );

    return { completionToken };
  }

  /**
   * User + usedAt в одной транзакции: при ошибке создания jti не сгорает.
   * Conflict «email занят» — jti помечаем used (повторный complete бессмыслен).
   */
  async complete(dto: RegisterCompleteDto): Promise<{ access_token: string }> {
    let payload: RegistrationCompletionPayload;
    try {
      payload = await this.jwt.verifyAsync<RegistrationCompletionPayload>(
        dto.completionToken,
        { secret: this.regTokenSecret() },
      );
    } catch {
      throw new BadRequestException(
        'Подтверждение регистрации недействительно или истекло',
      );
    }

    if (
      payload.purpose !== 'register_complete' ||
      !payload.email ||
      !payload.jti
    ) {
      throw new BadRequestException('Неверный токен регистрации');
    }

    const passwordError = firstPasswordError(dto.password);
    if (passwordError) throw new BadRequestException(passwordError);

    const completion = await this.prisma.registrationCompletion.findUnique({
      where: { id: payload.jti },
    });
    if (
      !completion ||
      completion.email !== payload.email ||
      completion.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        'Подтверждение регистрации недействительно или истекло',
      );
    }
    if (completion.usedAt) {
      throw new BadRequestException(
        'Подтверждение уже использовано. Запросите код заново.',
      );
    }
    if (!completion.consentPersonalData) {
      throw new BadRequestException(
        'Нужно согласие на обработку персональных данных',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, USER_BCRYPT_ROUNDS);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "RegistrationCompletion"
        WHERE id = ${completion.id}
          AND "usedAt" IS NULL
          AND "expiresAt" > NOW()
        FOR UPDATE
      `;
      if (!locked.length) {
        throw new BadRequestException(
          'Подтверждение уже использовано. Запросите код заново.',
        );
      }

      const taken = await tx.user.findUnique({
        where: { email: completion.email },
        select: { id: true, passwordHash: true },
      });
      if (taken?.passwordHash) {
        // Коммитим usedAt до выхода из tx (throw Conflict снаружи — иначе rollback).
        await tx.registrationCompletion.update({
          where: { id: completion.id },
          data: { usedAt: new Date() },
        });
        return { kind: 'email_taken' as const };
      }

      const now = new Date();
      const marketing = completion.consentMarketing === true;
      const displayName = completion.displayName?.trim() || null;
      const consentData = {
        privacyConsentAt: now,
        privacyConsentVersion: PRIVACY_CONSENT_VERSION,
        marketingConsent: marketing,
        marketingConsentAt: marketing ? now : null,
        marketingConsentVersion: marketing ? MARKETING_CONSENT_VERSION : null,
      };

      // ETL / passwordless: задаём пароль на существующий User.
      if (taken && !taken.passwordHash) {
        const updated = await tx.user.update({
          where: { id: taken.id },
          data: {
            passwordHash,
            ...(displayName ? { displayName } : {}),
            ...consentData,
          },
          select: {
            id: true,
            email: true,
            role: true,
            tokenVersion: true,
          },
        });
        await tx.registrationCompletion.update({
          where: { id: completion.id },
          data: { usedAt: new Date() },
        });
        return { kind: 'ok' as const, user: updated };
      }

      const created = await tx.user.create({
        data: {
          email: completion.email,
          passwordHash,
          role: UserRole.USER,
          displayName,
          ...consentData,
        },
        select: {
          id: true,
          email: true,
          role: true,
          tokenVersion: true,
        },
      });

      await tx.registrationCompletion.update({
        where: { id: completion.id },
        data: { usedAt: new Date() },
      });

      return { kind: 'ok' as const, user: created };
    });

    if (outcome.kind === 'email_taken') {
      throw new ConflictException('Пользователь с таким email уже есть');
    }

    await this.auth.claimGuestOrders(
      outcome.user.id,
      dto.guestId,
      outcome.user.email,
    );
    return this.auth.login(outcome.user);
  }

  /** Удаляет просроченные challenge / unused completion. */
  async purgeExpired(): Promise<{
    challenges: number;
    completions: number;
    dispatches: number;
  }> {
    const now = new Date();
    const dispatchRetention = new Date(now.getTime() - 2 * 86400_000);
    const [challenges, completions, dispatches] = await Promise.all([
      this.prisma.registrationChallenge.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      this.prisma.registrationCompletion.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            {
              usedAt: {
                not: null,
                lt: new Date(now.getTime() - 7 * 86400_000),
              },
            },
          ],
        },
      }),
      this.prisma.registrationOtpDispatch.deleteMany({
        where: { createdAt: { lt: dispatchRetention } },
      }),
    ]);
    return {
      challenges: challenges.count,
      completions: completions.count,
      dispatches: dispatches.count,
    };
  }
}
