import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateEmailNotificationTemplateDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  subject?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  body?: string;
}

/** Preview / test-send: demo vars. */
export class PreviewEmailNotificationDto extends UpdateEmailNotificationTemplateDto {
  /** full — все поля; sparse — опциональные пустые (#if скрыты). */
  @IsOptional()
  @IsIn(['full', 'sparse'])
  sampleVariant?: 'full' | 'sparse';
}
