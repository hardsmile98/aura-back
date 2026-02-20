import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { i18nValidationMessage } from 'nestjs-i18n';
import { HoroscopePeriod } from '@prisma/client';
import type { Locale } from '@prisma/client';

export type { HoroscopePeriod };

export class GetHoroscopeDto {
  @IsNotEmpty({
    message: i18nValidationMessage('validation.IS_NOT_EMPTY', {
      property: 'Period',
    }),
  })
  @IsIn(['day', 'week', 'month'], {
    message: i18nValidationMessage('validation.IS_IN', {
      property: 'Period',
      values: 'day, week, month',
    }),
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? (value.toLowerCase() as HoroscopePeriod)
      : (value as HoroscopePeriod),
  )
  period!: HoroscopePeriod;

  @IsOptional()
  @IsIn(['ru', 'en'], {
    message: i18nValidationMessage('validation.IS_IN', {
      property: 'Locale',
      values: 'ru, en',
    }),
  })
  locale?: Locale;
}
