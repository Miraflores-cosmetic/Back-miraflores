import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderShipDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tracking?: string;

  /**
   * true — создать отправление у перевозчика (СДЭК), если трек пуст.
   * omit при пустом треке и настроенном СДЭК — тоже авто.
   * false — только локальная отметка SHIPPED без API перевозчика.
   * Яндекс: автосоздание не поддерживается — нужен трек.
   * Письмо клиенту не отправляется — см. POST …/send-tracking.
   */
  @IsOptional()
  @IsBoolean()
  registerCarrier?: boolean;
}

export class OrderSendTrackingDto {
  /** Если пусто — берётся трек из последнего shipment. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tracking?: string;
}

export class OrderRegisterCarrierDto {
  /** Служба из UI; иначе order.shippingMethod / meta адреса. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;
}

export class OrderRefundDto {
  /** Сумма в ₽; по умолчанию — весь остаток. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * true — refund в ЮKassa (нужны настроенные ключи / тестовый шлюз).
   * false/omit — только учёт в БД.
   */
  @IsOptional()
  @IsBoolean()
  providerRefund?: boolean;
}

export class OrderShippingAddressUpdateDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  apartment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pvzCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  shippingMethod?: string;

  /** Если не передан — оставляем текущую стоимость доставки. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500_000)
  shippingCost?: number;

  @IsOptional()
  @IsBoolean()
  notifyCustomer?: boolean;
}

export class OrderItemUpdateLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  variantId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  shadeId?: string | null;

  @IsInt()
  @Min(1)
  @Max(999)
  qty!: number;

  /** Если не передан — берём цену из каталога (для variantId). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string;

  @IsOptional()
  @IsBoolean()
  isGratitudeGift?: boolean;
}

export class OrderItemsUpdateDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemUpdateLineDto)
  items!: OrderItemUpdateLineDto[];

  @IsOptional()
  @IsBoolean()
  notifyCustomer?: boolean;
}

export class OrderSurchargePaymentDto {
  /** Если не передан — balanceDue по текущему заказу. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amount?: number;
}

export class OrderNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}

export class OrderChecklistMarkDto {
  @IsString()
  @MaxLength(32)
  checklist!: string;

  @IsString()
  @MaxLength(32)
  stepId!: string;

  @IsBoolean()
  done!: boolean;
}

/** Фактическая стоимость отправления у перевозчика (Ozon — из кабинета). */
export class OrderShipmentCostDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  carrierCostRub!: number;
}
