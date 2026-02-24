import { IsNotEmpty, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class SubscribeDto {
  @IsString({
    message: i18nValidationMessage('validation.IS_STRING', {
      property: 'Payment method ID',
    }),
  })
  @IsNotEmpty({
    message: i18nValidationMessage('validation.IS_NOT_EMPTY', {
      property: 'Payment method ID',
    }),
  })
  paymentMethodId!: string;
}
