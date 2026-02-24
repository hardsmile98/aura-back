import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { i18nValidationMessage } from 'nestjs-i18n';
import { SketchType } from '@prisma/client';
import type { Locale } from '@prisma/client';

export type { SketchType };

export class GetSketchDto {
  @IsNotEmpty({
    message: i18nValidationMessage('validation.IS_NOT_EMPTY', {
      property: 'Type',
    }),
  })
  @IsIn(['soulmate', 'baby'], {
    message: i18nValidationMessage('validation.IS_IN', {
      property: 'Type',
      values: 'soulmate, baby',
    }),
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? (value.toLowerCase() as SketchType)
      : (value as SketchType),
  )
  type!: SketchType;

  @IsOptional()
  @IsIn(['ru', 'en'], {
    message: i18nValidationMessage('validation.IS_IN', {
      property: 'Locale',
      values: 'ru, en',
    }),
  })
  locale?: Locale;
}
