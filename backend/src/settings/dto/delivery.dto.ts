import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateDeliverySettingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  cdekSurchargeRub!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  ozonSurchargeRub!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  yandexSurchargeRub!: number;
}
