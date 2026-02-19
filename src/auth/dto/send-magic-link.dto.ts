import { IsEmail, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { i18nValidationMessage } from 'nestjs-i18n';

export class SendMagicLinkDto {
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY', { property: 'Email' }) })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  email!: string;
}
