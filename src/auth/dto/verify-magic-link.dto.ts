import { IsNotEmpty, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class VerifyMagicLinkDto {
  @IsString({
    message: i18nValidationMessage('validation.IS_STRING', {
      property: 'Token',
    }),
  })
  @IsNotEmpty({
    message: i18nValidationMessage('validation.IS_NOT_EMPTY', {
      property: 'Token',
    }),
  })
  token!: string;
}
