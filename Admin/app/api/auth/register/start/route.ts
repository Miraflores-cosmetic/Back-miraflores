import { NextResponse } from 'next/server';
import { readNestError } from '@/lib/nestBff';
import { getServerApiBase } from '@/lib/serverApiBase';

/** POST /api/auth/register/start → Nest register/start (OTP на email). */
export async function POST(request: Request) {
  let body: {
    email?: string;
    displayName?: string;
    consentPersonalData?: boolean;
    consentMarketing?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const displayName = (body.displayName ?? '').trim() || undefined;
  const consentPersonalData = body.consentPersonalData === true;
  const consentMarketing = body.consentMarketing === true;

  if (!email) {
    return NextResponse.json({ error: 'Укажите email' }, { status: 400 });
  }
  if (!consentPersonalData) {
    return NextResponse.json(
      { error: 'Нужно согласие на обработку персональных данных' },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await fetch(`${getServerApiBase()}/auth/register/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        displayName,
        consentPersonalData: true,
        consentMarketing,
      }),
    });
  } catch {
    return NextResponse.json({ error: 'Нет связи с API' }, { status: 502 });
  }

  if (!res.ok) {
    const nestMsg = await readNestError(res);
    return NextResponse.json(
      { error: nestMsg ?? 'Не удалось отправить код' },
      { status: res.status },
    );
  }

  const data = (await res.json()) as { message?: string; otpSent?: boolean };
  return NextResponse.json({
    ok: true,
    otpSent: data.otpSent === true,
    message: data.message ?? 'Если этот email свободен, мы отправили код подтверждения.',
  });
}
