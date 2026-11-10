import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class TrackReferralVisitDto {
  @IsString()
  @MinLength(3)
  @MaxLength(16)
  @Matches(/^[A-Za-z0-9]+$/)
  code!: string;
}
