import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AdminLoginDto {
  @IsString()
  emailOrPhone!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class BuyerLoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  /** guestId из localStorage — привязка гостевых заказов. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  guestId?: string | null;
}

export class RegisterStartDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  @IsBoolean()
  @Equals(true, {
    message: 'Нужно согласие на обработку персональных данных',
  })
  consentPersonalData!: boolean;

  @IsOptional()
  @IsBoolean()
  consentMarketing?: boolean;
}

export class RegisterVerifyDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Код должен состоять из 6 цифр' })
  code!: string;
}

export class RegisterCompleteDto {
  @IsString()
  @MinLength(1)
  completionToken!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  guestId?: string | null;

  /** ?mf= из localStorage — sticky referredByUserId. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string | null;
}

export class PasswordResetRequestDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  /** Опционально: полный URL страницы сброса (origin + path). Query `token` добавит сервер. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  redirectUrl?: string | null;
}

export class PasswordResetConfirmDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
