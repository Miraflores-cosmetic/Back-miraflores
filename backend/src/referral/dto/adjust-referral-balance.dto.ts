import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

export class AdjustReferralBalanceDto {
  @Type(() => Number)
  @IsInt()
  @NotEquals(0, { message: 'Сумма корректировки не может быть 0' })
  @Min(-1_000_000)
  @Max(1_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Альтернатива заголовку Idempotency-Key (retry-safe). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
