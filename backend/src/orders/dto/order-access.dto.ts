import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

/**
 * Доступ к pay / abandon.
 * payToken — гость (HMAC с create); для владельца заказа достаточно JWT buyer
 * (payToken можно не передавать).
 */
export class OrderPayAccessDto {
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  payToken?: string;
}
