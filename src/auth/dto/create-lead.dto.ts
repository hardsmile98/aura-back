import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { i18nValidationMessage } from 'nestjs-i18n';
import type { Locale } from '@prisma/client';

export class CreateLeadDto {
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  @IsNotEmpty({
    message: i18nValidationMessage('validation.IS_NOT_EMPTY', {
      property: 'Email',
    }),
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string),
  )
  email!: string;

  @IsOptional()
  @IsObject({ message: i18nValidationMessage('validation.IS_OBJECT') })
  quizResult?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['ru', 'en'], {
    message: i18nValidationMessage('validation.IS_IN', {
      property: 'Locale',
      values: 'ru, en',
    }),
  })
  locale?: Locale;
}
