import { IsBoolean } from 'class-validator';

export class SetReferralActiveDto {
  @IsBoolean()
  active!: boolean;
}
