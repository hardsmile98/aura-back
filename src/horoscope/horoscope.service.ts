import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nContext, I18nService } from 'nestjs-i18n';
import OpenAI from 'openai';
import { Locale, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { HoroscopePeriod } from './dto/get-horoscope.dto';
import type {
  HoroscopeByLocale,
  HoroscopeCategories,
  HoroscopeResponse,
} from './horoscope.types';

const SUPPORTED_LOCALES = ['ru', 'en'] as const;

const CATEGORIES: readonly (keyof HoroscopeCategories)[] = [
  'love',
  'career',
  'health',
  'finance',
  'family',
  'travel',
];

const PERIOD_TTL_MS: Record<HoroscopePeriod, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

function toHoroscopeCategories(
  obj: Record<string, unknown>,
): HoroscopeCategories {
  const result = {} as HoroscopeCategories;
  for (const key of CATEGORIES) {
    const value = obj[key];
    if (typeof value === 'string') {
      result[key] = value;
    } else if (value !== null && typeof value === 'object') {
      result[key] = JSON.stringify(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value);
    } else {
      result[key] = '';
    }
  }
  return result;
}

@Injectable()
export class HoroscopeService {
  private readonly client: OpenAI | null = null;
  private readonly prisma: PrismaClient;

  constructor(
    config: ConfigService,
    private i18n: I18nService,
    prisma: PrismaService,
  ) {
    this.prisma = prisma;

    const apiKey = config.get<string>('DEEPSEEK_API_KEY');

    if (apiKey) {
      this.client = new OpenAI({
        baseURL: 'https://api.deepseek.com',
        apiKey,
      });
    }
  }

  async getHoroscope(
    userId: number,
    quizResult: Record<string, unknown> | null,
    period: HoroscopePeriod,
    locale: Locale,
  ): Promise<HoroscopeResponse> {
    if (!quizResult || Object.keys(quizResult).length === 0) {
      const lang = I18nContext.current()?.lang ?? 'en';
      throw new BadRequestException(
        this.i18n.t('horoscope.QUIZ_RESULT_REQUIRED', { lang }),
      );
    }

    const cached = await this.findValidCache(userId, period);

    if (cached) {
      const byLocale = this.parseCachedContent(cached.content);

      const lang = this.resolveLocale(locale);

      return { status: 'ready', horoscope: byLocale[lang] };
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "User" WHERE id = ${userId} FOR UPDATE`,
      );

      const pending = await tx.horoscope.findFirst({
        where: { userId, period, status: 'pending' },
        select: { id: true },
      });

      if (pending) return null;

      return tx.horoscope.create({
        data: {
          user: { connect: { id: userId } },
          period,
          content: {},
          status: 'pending',
        },
      });
    });

    if (!created) {
      return { status: 'pending' };
    }

    void this.generateAndSave(quizResult, period, created.id);
    return { status: 'pending' };
  }

  private async generateAndSave(
    quizResult: Record<string, unknown>,
    period: HoroscopePeriod,
    id: number,
  ): Promise<HoroscopeByLocale | null> {
    try {
      const horoscope = await this.fetchFromDeepSeek(quizResult, period);

      await this.prisma.horoscope.update({
        where: { id },
        data: {
          content: horoscope satisfies Prisma.JsonObject,
          status: 'completed' as const,
        },
      });

      return horoscope;
    } catch {
      await this.prisma.horoscope.update({
        where: { id },
        data: { status: 'failed' as const },
      });

      return null;
    }
  }

  private resolveLocale(locale: string): 'ru' | 'en' {
    return SUPPORTED_LOCALES.includes(locale as 'ru' | 'en')
      ? (locale as 'ru' | 'en')
      : 'ru';
  }

  private parseCachedContent(content: Prisma.JsonValue): HoroscopeByLocale {
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    return this.parseHoroscopeByLocaleJson(str);
  }

  private findValidCache(
    userId: number,
    period: HoroscopePeriod,
  ): Promise<{ content: Prisma.JsonValue } | null> {
    const ttl = PERIOD_TTL_MS[period];

    const validSince = new Date(Date.now() - ttl);

    return this.prisma.horoscope.findFirst({
      where: {
        userId,
        period,
        status: 'completed',
        createdAt: { gte: validSince },
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
  }

  private async fetchFromDeepSeek(
    quizResult: Record<string, unknown>,
    period: HoroscopePeriod,
  ): Promise<HoroscopeByLocale> {
    if (!this.client) {
      throw new ServiceUnavailableException();
    }

    const systemPrompt = this.getSystemPromptBothLocales();
    const userPrompt = JSON.stringify({ quizResult, period }, null, 2);

    const completion = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `${this.getPeriodPrompt(period)}\n\nUser data:\n${userPrompt}`,
        },
      ],
      response_format: { type: 'json_object' },
      stream: false,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new ServiceUnavailableException('Empty response from DeepSeek');
    }

    return this.parseHoroscopeByLocaleJson(content);
  }

  private parseHoroscopeByLocaleJson(content: string): HoroscopeByLocale {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ServiceUnavailableException('Invalid JSON from DeepSeek');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new ServiceUnavailableException('Invalid horoscope format');
    }

    const obj = parsed as Record<string, unknown>;
    const ru = obj.ru;
    const en = obj.en;

    if (
      typeof ru !== 'object' ||
      ru === null ||
      typeof en !== 'object' ||
      en === null
    ) {
      throw new ServiceUnavailableException('Invalid horoscope format');
    }

    return {
      ru: toHoroscopeCategories(ru as Record<string, unknown>),
      en: toHoroscopeCategories(en as Record<string, unknown>),
    };
  }

  private getPeriodPrompt(period: HoroscopePeriod): string {
    const prompts: Record<HoroscopePeriod, string> = {
      day: 'Create a personal horoscope for today.',
      week: 'Create a personal horoscope for the week.',
      month: 'Create a personal horoscope for the month.',
    };
    return prompts[period];
  }

  private getSystemPromptBothLocales(): string {
    const schema = JSON.stringify(
      {
        ru: {
          love: 'string',
          career: 'string',
          health: 'string',
          finance: 'string',
          family: 'string',
          travel: 'string',
        },
        en: {
          love: 'string',
          career: 'string',
          health: 'string',
          finance: 'string',
          family: 'string',
          travel: 'string',
        },
      },
      null,
      2,
    );
    return `You are an astrologer and personal horoscope writer. Based on the user's quizResult create a unique horoscope by categories in TWO languages: Russian (ru) and English (en).

You MUST respond ONLY with valid JSON in this exact format:
${schema}

For each language (ru and en), each category (love, career, health, finance, family, travel) — a short forecast (6-10 sentences) in that language. Write in a natural style, avoid clichés. The content in "ru" must be in Russian, the content in "en" must be in English.`;
  }
}
