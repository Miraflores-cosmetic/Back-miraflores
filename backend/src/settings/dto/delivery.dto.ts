import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';

const KINDS = ['FIXED', 'PERCENT'] as const;
export type DeliverySurchargeKindDto = (typeof KINDS)[number];

export class UpdateDeliverySettingsDto {
  @IsIn(KINDS)
  cdekSurchargeKind!: DeliverySurchargeKindDto;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  cdekSurchargeValue!: number;

  @IsIn(KINDS)
  ozonSurchargeKind!: DeliverySurchargeKindDto;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  ozonSurchargeValue!: number;

  @IsIn(KINDS)
  yandexSurchargeKind!: DeliverySurchargeKindDto;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  yandexSurchargeValue!: number;
}
