'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useMemo, useRef, useState } from 'react';
import { Checkbox } from '@/components/Checkbox/Checkbox';
import { FloatingTextField } from '@/components/FloatingTextField/FloatingTextField';
import { PrimaryBtn } from '@/components/PrimaryBtn/PrimaryBtn';
import { getOrCreateGuestId } from '@/lib/cart/guestId';
import { useBuyerAuth } from '@/lib/BuyerAuthProvider';
import { firstPasswordError } from '@/lib/passwordPolicy';
import { safeReturnPath, withReturnPath } from '@/lib/safeReturnPath';
import {
  clearAuthField,
  type AuthFieldErrors,
  useRedirectIfBuyerAuthed,
} from './authShared';
import { AuthSplitShell } from './AuthSplitShell';
import { PasswordMeter } from './PasswordMeter';
import styles from './LoginPage.module.css';

type Step = 'details' | 'otp' | 'password';

export function RegisterForm() {
  const router = useRouter();
  const { refresh: refreshBuyerAuth } = useBuyerAuth();
  const searchParams = useSearchParams();
  const privacyId = useId();
  const marketingId = useId();
  const consentBlockRef = useRef<HTMLDivElement>(null);
  const from = useMemo(
    () => safeReturnPath(searchParams.get('from')),
    [searchParams],
  );

  const [step, setStep] = useState<Step>('details');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [completionToken, setCompletionToken] = useState<string | null>(null);
  const [consentPersonalData, setConsentPersonalData] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [accountHint, setAccountHint] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);

  useRedirectIfBuyerAuthed(from, { enabled: !registered && !loading });

  function scrollToFirstError(next: AuthFieldErrors) {
    requestAnimationFrame(() => {
      if (next.consentPersonalData && consentBlockRef.current) {
        consentBlockRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
        document.getElementById(privacyId)?.focus?.();
        return;
      }
      const order = [
        'displayName',
        'email',
        'otp',
        'password',
        'passwordConfirm',
      ] as const;
      for (const key of order) {
        if (!next[key]) continue;
        const el = document.querySelector<HTMLElement>(
          `[data-auth-field="${key}"] input`,
        );
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.focus();
        return;
      }
    });
  }

  function validateDetails(): AuthFieldErrors {
    const next: AuthFieldErrors = {};
    if (!displayName.trim()) next.displayName = 'Укажите имя';
    if (!email.trim()) next.email = 'Укажите email';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Некорректный email';
    }
    if (!consentPersonalData) {
      next.consentPersonalData = 'Нужно согласие на обработку персональных данных';
    }
    return next;
  }

  async function sendOtp(): Promise<{ ok: boolean; otpSent: boolean }> {
    const res = await fetch('/api/auth/register/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: email.trim(),
        displayName: displayName.trim(),
        consentPersonalData: true,
        consentMarketing,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      otpSent?: boolean;
      message?: string;
    };
    if (!res.ok) {
      const msg =
        typeof data.error === 'string' ? data.error : 'Не удалось отправить код';
      const lower = msg.toLowerCase();
      if (lower.includes('согласи')) {
        setFieldErrors({ consentPersonalData: msg });
        scrollToFirstError({ consentPersonalData: msg });
      } else {
        setFormError(msg);
      }
      return { ok: false, otpSent: false };
    }
    return { ok: true, otpSent: data.otpSent === true };
  }

  async function onDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setAccountHint(false);
    const next = validateDetails();
    setFieldErrors(next);
    if (Object.keys(next).length) {
      scrollToFirstError(next);
      return;
    }

    setLoading(true);
    try {
      const { ok, otpSent } = await sendOtp();
      if (!ok) return;
      if (!otpSent) {
        setAccountHint(true);
        return;
      }
      setOtp('');
      setCompletionToken(null);
      setStep('otp');
    } catch {
      setFormError('Сеть недоступна');
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setFormError(null);
    setResendBusy(true);
    try {
      const { ok, otpSent } = await sendOtp();
      if (!ok) return;
      if (!otpSent) {
        setFormError(
          'Код сейчас не отправлен. Если аккаунт уже есть — войдите или восстановите пароль.',
        );
        return;
      }
      setOtp('');
    } catch {
      setFormError('Сеть недоступна');
    } finally {
      setResendBusy(false);
    }
  }

  async function onOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      const next = { otp: 'Введите 6 цифр из письма' };
      setFieldErrors(next);
      scrollToFirstError(next);
      return;
    }

    setLoading(true);
    try {
      const verifyRes = await fetch('/api/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim(), code }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as {
        error?: string;
        completionToken?: string;
      };
      if (!verifyRes.ok) {
        const msg =
          typeof verifyData.error === 'string'
            ? verifyData.error
            : 'Неверный код';
        if (msg.toLowerCase().includes('код') || msg.toLowerCase().includes('попыт')) {
          setFieldErrors({ otp: msg });
          scrollToFirstError({ otp: msg });
        } else {
          setFormError(msg);
        }
        return;
      }
      if (!verifyData.completionToken) {
        setFormError('Не удалось подтвердить email');
        return;
      }
      setCompletionToken(verifyData.completionToken);
      setPassword('');
      setPasswordConfirm('');
      setStep('password');
    } catch {
      setFormError('Сеть недоступна');
    } finally {
      setLoading(false);
    }
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!completionToken) {
      setFormError('Сначала подтвердите email');
      setStep('otp');
      return;
    }
    const next: AuthFieldErrors = {};
    const pwErr = firstPasswordError(password);
    if (pwErr) next.password = pwErr;
    if (passwordConfirm.length === 0) next.passwordConfirm = 'Повторите пароль';
    else if (password !== passwordConfirm) {
      next.passwordConfirm = 'Пароли не совпадают';
    }
    setFieldErrors(next);
    if (Object.keys(next).length) {
      scrollToFirstError(next);
      return;
    }

    setLoading(true);
    try {
      const completeRes = await fetch('/api/auth/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          completionToken,
          password,
          guestId: getOrCreateGuestId() || undefined,
        }),
      });
      const completeData = (await completeRes.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!completeRes.ok) {
        const msg =
          typeof completeData.error === 'string'
            ? completeData.error
            : 'Не удалось зарегистрироваться';
        const lower = msg.toLowerCase();
        if (lower.includes('парол') || lower.includes('букв') || lower.includes('цифр')) {
          setFieldErrors({ password: msg });
          scrollToFirstError({ password: msg });
        } else if (lower.includes('подтвержд') || lower.includes('использован')) {
          setCompletionToken(null);
          setStep('otp');
          setFormError(msg);
        } else {
          setFormError(msg);
        }
        return;
      }

      setRegistered(true);
      await refreshBuyerAuth();
      router.replace(withReturnPath('/register/welcome', from));
      router.refresh();
    } catch {
      setFormError('Сеть недоступна');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'otp') {
    return (
      <AuthSplitShell backHref={from}>
        <div className={styles.intro}>
          <h2 className={styles.title}>Код из письма</h2>
          <p className={styles.subtitle}>
            Если email свободен — код на{' '}
            <strong>{email.trim().toLowerCase()}</strong>.{' '}
            <button
              type="button"
              className={styles.linkAccent}
              disabled={loading || resendBusy}
              onClick={() => {
                setStep('details');
                setOtp('');
                setCompletionToken(null);
                setFormError(null);
                setFieldErrors({});
              }}
            >
              Изменить email
            </button>
          </p>
        </div>

        <form className={styles.form} noValidate onSubmit={(e) => void onOtpSubmit(e)}>
          <fieldset className={styles.fieldset} disabled={loading}>
            <div className={styles.fields}>
              <div data-auth-field="otp">
                <FloatingTextField
                  label="Код"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setOtp(v);
                    clearAuthField(setFieldErrors, 'otp');
                  }}
                  required
                  maxLength={6}
                  error={fieldErrors.otp}
                />
              </div>
              <p className={styles.hint}>
                Не пришло? Проверьте «Спам» или{' '}
                <button
                  type="button"
                  className={styles.linkAccent}
                  disabled={loading || resendBusy}
                  onClick={() => void onResend()}
                >
                  {resendBusy ? 'Отправка…' : 'отправьте код ещё раз'}
                </button>
                . Повтор — не чаще чем раз в ~1 мин.
              </p>
              {formError ? (
                <p className={styles.error} role="alert">
                  {formError}
                </p>
              ) : null}
            </div>
          </fieldset>

          <PrimaryBtn type="submit" disabled={loading || otp.length !== 6}>
            {loading ? 'Проверка…' : 'Далее'}
          </PrimaryBtn>
        </form>
      </AuthSplitShell>
    );
  }

  if (step === 'password') {
    return (
      <AuthSplitShell backHref={from}>
        <div className={styles.intro}>
          <h2 className={styles.title}>Придумайте пароль</h2>
          <p className={styles.subtitle}>
            Email подтверждён: <strong>{email.trim().toLowerCase()}</strong>
          </p>
        </div>

        <form
          className={styles.form}
          noValidate
          onSubmit={(e) => void onPasswordSubmit(e)}
        >
          <fieldset className={styles.fieldset} disabled={loading}>
            <div className={styles.fields}>
              <div className={styles.passwordStack} data-auth-field="password">
                <FloatingTextField
                  label="Пароль"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearAuthField(setFieldErrors, 'password');
                  }}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  error={fieldErrors.password}
                />
                <PasswordMeter password={password} />
                <p className={styles.hint}>Минимум 8 символов, буква и цифра.</p>
              </div>
              <div data-auth-field="passwordConfirm">
                <FloatingTextField
                  label="Повторите пароль"
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => {
                    setPasswordConfirm(e.target.value);
                    clearAuthField(setFieldErrors, 'passwordConfirm');
                  }}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  error={fieldErrors.passwordConfirm}
                />
              </div>
              {formError ? (
                <p className={styles.error} role="alert">
                  {formError}
                </p>
              ) : null}
            </div>
          </fieldset>

          <PrimaryBtn type="submit" disabled={loading}>
            {loading ? 'Регистрация…' : 'Создать аккаунт'}
          </PrimaryBtn>
        </form>
      </AuthSplitShell>
    );
  }

  return (
    <AuthSplitShell backHref={from}>
      <div className={styles.intro}>
        <h2 className={styles.title}>Регистрация</h2>
        <p className={styles.subtitle}>
          Уже есть аккаунт?{' '}
          <Link href={withReturnPath('/login', from)} className={styles.linkAccent}>
            Войти
          </Link>
        </p>
      </div>

      <form className={styles.form} noValidate onSubmit={(e) => void onDetailsSubmit(e)}>
        <fieldset className={styles.fieldset} disabled={loading}>
          <div className={styles.fields}>
            <div data-auth-field="displayName">
              <FloatingTextField
                label="Имя"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  clearAuthField(setFieldErrors, 'displayName');
                }}
                autoComplete="name"
                required
                error={fieldErrors.displayName}
              />
            </div>
            <div data-auth-field="email">
              <FloatingTextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearAuthField(setFieldErrors, 'email');
                  setAccountHint(false);
                }}
                autoComplete="email"
                required
                error={fieldErrors.email}
              />
            </div>

            <div className={styles.consentBlock} ref={consentBlockRef}>
              <div className={styles.consentRow}>
                <Checkbox
                  id={privacyId}
                  checked={consentPersonalData}
                  onChange={(e) => {
                    setConsentPersonalData(e.target.checked);
                    clearAuthField(setFieldErrors, 'consentPersonalData');
                  }}
                />
                <label htmlFor={privacyId} className={styles.consentLabel}>
                  Я даю согласие на обработку персональных данных в соответствии с{' '}
                  <Link href="/privacy" className={styles.linkAccent}>
                    Политикой конфиденциальности
                  </Link>
                  .
                </label>
              </div>
              {fieldErrors.consentPersonalData ? (
                <p className={styles.error} role="alert">
                  {fieldErrors.consentPersonalData}
                </p>
              ) : null}

              <div className={styles.consentRow}>
                <Checkbox
                  id={marketingId}
                  checked={consentMarketing}
                  onChange={(e) => setConsentMarketing(e.target.checked)}
                />
                <label htmlFor={marketingId} className={styles.consentLabel}>
                  Я согласен(на) получать новости и предложения Jcos на email.
                </label>
              </div>
            </div>

            {accountHint ? (
              <div className={styles.accountHint} role="status">
                <p className={styles.hint}>
                  Код не отправлен. Если вы уже регистрировались на этот email —
                  войдите или восстановите пароль (для старых аккаунтов без пароля
                  подойдёт «Забыли пароль»).
                </p>
                <p className={styles.accountHintLinks}>
                  <Link
                    href={withReturnPath('/login', from)}
                    className={styles.linkAccent}
                  >
                    Войти
                  </Link>
                  {' · '}
                  <Link
                    href={withReturnPath(
                      `/login/forgot-password?email=${encodeURIComponent(email.trim().toLowerCase())}`,
                      from,
                    )}
                    className={styles.linkAccent}
                  >
                    Восстановить пароль
                  </Link>
                </p>
              </div>
            ) : null}

            {formError ? (
              <p className={styles.error} role="alert">
                {formError}
              </p>
            ) : null}
          </div>
        </fieldset>

        <PrimaryBtn type="submit" disabled={loading}>
          {loading ? 'Отправка кода…' : 'Получить код на email'}
        </PrimaryBtn>
      </form>
    </AuthSplitShell>
  );
}
