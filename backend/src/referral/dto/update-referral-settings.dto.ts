import { ReferralEarnMode, ReferralQuarantineMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateReferralSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  earnPercent?: number;

  @IsOptional()
  @IsEnum(ReferralEarnMode)
  earnMode?: ReferralEarnMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  linkTtlDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minOrderRub?: number;

  @IsOptional()
  @IsEnum(ReferralQuarantineMode)
  quarantineMode?: ReferralQuarantineMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  quarantineDays?: number;

  @IsOptional()
  @IsBoolean()
  inviteeBonusEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  inviteeBonusRub?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  spendCapPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  shareText?: string;
}
