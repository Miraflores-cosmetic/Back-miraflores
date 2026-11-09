import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** PATCH buyers profile fields from admin user card. */
export class UpdateRetailUserProfileDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  /** RU / E.164; пустая строка → сброс. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  /** YYYY-MM-DD; пустая строка → сброс. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  birthday?: string | null;
}
