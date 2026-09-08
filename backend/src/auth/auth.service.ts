import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { MailService } from '../mail/mail.service';
import { firstPasswordError, isPasswordValid } from './password-policy';
import {
  MARKETING_CONSENT_VERSION,
  PRIVACY_CONSENT_VERSION,
} from './consent-versions';

const BCRYPT_ROUNDS = 10;
const RESET_TTL = '1h';

type PasswordResetPayload = {
  sub: string;
  email: string;
  purpose: 'password_reset';
  typ: 'pwreset';
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async validateAdmin(emailOrPhone: string, password: string) {
    const login = emailOrPhone.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        email: login,
        role: { in: [UserRole.ADMIN, UserRole.MODERATOR] },
        isActive: true,
        staffDeletedAt: null,
      },
    });
    if (!user?.passwordHash) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async validateBuyer(email: string, password: string) {
    const login = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        email: login,
        role: UserRole.USER,
        isActive: true,
      },
    });
    if (!user?.passwordHash) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async registerBuyer(input: {
    email: string;
    password: string;
    displayName?: string | null;
    consentPersonalData: boolean;
    consentMarketing?: boolean;
  }) {
    const email = input.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Укажите email');
    const passwordError = firstPasswordError(input.password);
    if (passwordError) throw new BadRequestException(passwordError);
    if (!input.consentPersonalData) {
      throw new BadRequestException(
        'Нужно согласие на обработку персональных данных',
      );
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Пользователь с таким email уже есть');
    }
    const now = new Date();
    const marketing = input.consentMarketing === true;
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.USER,
        displayName: input.displayName?.trim() || null,
        privacyConsentAt: now,
        privacyConsentVersion: PRIVACY_CONSENT_VERSION,
        marketingConsent: marketing,
        marketingConsentAt: marketing ? now : null,
        marketingConsentVersion: marketing ? MARKETING_CONSENT_VERSION : null,
      },
      select: {
        id: true,
        email: true,
        role: true,
        displayName: true,
      },
    });
    return user;
  }

  /**
   * Привязывает гостевые заказы (userId=null) к покупателю после login/register/reset.
   * По guestId и/или email (заказы с тем же email без аккаунта).
   */
  async claimGuestOrders(
    userId: string,
    guestIdRaw?: string | null,
    emailRaw?: string | null,
  ) {
    if (!userId) return { claimed: 0 };
    const guestId = guestIdRaw?.trim() || '';
    const email = emailRaw?.trim().toLowerCase() || '';
    if (!guestId && !email) return { claimed: 0 };

    const or: Prisma.OrderWhereInput[] = [];
    if (guestId) or.push({ guestId });
    if (email) or.push({ email: { equals: email, mode: 'insensitive' } });

    const result = await this.prisma.order.updateMany({
      where: { userId: null, OR: or },
      data: { userId },
    });
    if (result.count > 0) {
      this.logger.log(
        `claimGuestOrders: user=${userId} claimed=${result.count}` +
          (email ? ` email=${email}` : '') +
          (guestId ? ` guestId=${guestId}` : ''),
      );
    }
    return { claimed: result.count };
  }

  async login(user: { id: string; email: string; role: string; tokenVersion?: number }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion ?? 0,
    };
    return { access_token: this.jwt.sign(payload) };
  }

  /** Инвалидирует все ранее выданные JWT пользователя. */
  async bumpTokenVersion(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async touchAdminLogin(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastAdminLoginAt: new Date() },
    });
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        displayName: true,
        staffDisplayName: true,
        staffAvatarUrl: true,
        adminSections: true,
        phone: true,
        isActive: true,
        marketingConsent: true,
        lastAdminLoginAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Всегда один и тот же message (anti-enumeration).
   * При SMTP — письмо со ссылкой; при ошибке/без SMTP в development — `devHint` + лог.
   */
  async requestPasswordReset(
    emailRaw: string,
    redirectUrlRaw?: string | null,
  ): Promise<{
    message: string;
    emailSent: boolean;
    devHint?: string;
  }> {
    const message =
      'Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля.';
    const email = emailRaw.trim().toLowerCase();
    // Активный buyer — сброс или первичная установка пароля (ETL без hash).
    const user = await this.prisma.user.findFirst({
      where: { email, role: UserRole.USER, isActive: true },
      select: { id: true, email: true },
    });

    if (!user) {
      this.logger.debug(`Password reset: no active buyer for ${email}`);
      return { message, emailSent: false };
    }

    const payload: PasswordResetPayload = {
      sub: user.id,
      email,
      purpose: 'password_reset',
      typ: 'pwreset',
    };
    const token = this.jwt.sign(payload, { expiresIn: RESET_TTL });
    const link = this.buildPasswordResetLink(token, redirectUrlRaw);

    const isDev =
      !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

    if (this.mail.isConfigured()) {
      try {
        await this.mail.sendPasswordResetLink({ to: email, resetLink: link });
        return { message, emailSent: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Password reset email failed for ${email}: ${msg}`);
        if (isDev) {
          this.logger.log(`Password reset fallback link for ${email}: ${link}`);
          return { message, emailSent: false, devHint: link };
        }
        return { message, emailSent: false };
      }
    }

    if (isDev) {
      this.logger.log(`Password reset link (no SMTP) for ${email}: ${link}`);
      return { message, emailSent: false, devHint: link };
    }
    this.logger.warn(
      `Password reset requested for ${email} but SMTP is not configured`,
    );
    return { message, emailSent: false };
  }

  /** Miraflores Front: /reset-password?token=…; legacy Admin: /login/reset-password?t=… */
  private buildPasswordResetLink(
    token: string,
    redirectUrlRaw?: string | null,
  ): string {
    const base =
      process.env.FRONTEND_PUBLIC_URL?.replace(/\/+$/, '') ||
      'http://localhost:5173';
    const tokenQ = encodeURIComponent(token);
    const raw = redirectUrlRaw?.trim();
    if (raw) {
      try {
        const u = new URL(raw);
        const allowed = new URL(base);
        if (u.origin === allowed.origin) {
          u.searchParams.delete('t');
          u.searchParams.set('token', token);
          return u.toString();
        }
      } catch {
        /* fall through */
      }
    }
    return `${base}/reset-password?token=${tokenQ}`;
  }

  async confirmPasswordReset(tokenRaw: string, newPassword: string) {
    if (!isPasswordValid(newPassword)) {
      throw new BadRequestException(
        firstPasswordError(newPassword) ?? 'Некорректный пароль',
      );
    }
    const raw = tokenRaw.trim();
    if (!raw) {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }

    let payload: PasswordResetPayload;
    try {
      payload = this.jwt.verify<PasswordResetPayload>(raw);
    } catch {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }

    if (
      payload.purpose !== 'password_reset' ||
      payload.typ !== 'pwreset' ||
      !payload.sub
    ) {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        email: payload.email,
        role: UserRole.USER,
        isActive: true,
      },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    // Гостевые заказы с тем же email (без ожидания следующего login).
    await this.claimGuestOrders(user.id, null, payload.email);
    return { ok: true as const };
  }
}
