import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nContext, I18nService } from 'nestjs-i18n';
import OpenAI from 'openai';
import { Locale, type Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { HoroscopePeriod } from './dto/get-horoscope.dto';
import type { HoroscopeByLocale, HoroscopeCategories } from './horoscope.types';

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

function isHoroscopeCategories(value: unknown): value is HoroscopeCategories {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return CATEGORIES.every(
    (key) => key in obj && (typeof obj[key] === 'string' || obj[key] == null),
  );
}

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
  private readonly pendingGenerations = new Map<
    string,
    Promise<HoroscopeByLocale>
  >();

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
  ): Promise<{ horoscope: HoroscopeCategories }> {
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
      return { horoscope: byLocale[lang] };
    }

    const horoscope = await this.getOrCreateGeneration(
      userId,
      quizResult,
      period,
    );

    const lang = this.resolveLocale(locale);
    return { horoscope: horoscope[lang] };
  }

  private getOrCreateGeneration(
    userId: number,
    quizResult: Record<string, unknown>,
    period: HoroscopePeriod,
  ): Promise<HoroscopeByLocale> {
    const key = `${userId}:${period}`;
    let pending = this.pendingGenerations.get(key);

    if (!pending) {
      pending = this.generateAndSave(userId, quizResult, period);

      this.pendingGenerations.set(key, pending);

      void pending.finally(() => this.pendingGenerations.delete(key));
    }

    return pending;
  }

  private async generateAndSave(
    userId: number,
    quizResult: Record<string, unknown>,
    period: HoroscopePeriod,
  ): Promise<HoroscopeByLocale> {
    const horoscope = await this.fetchFromDeepSeek(quizResult, period);

    await this.prisma.horoscope.create({
      data: {
        user: { connect: { id: userId } },
        period,
        content: horoscope satisfies Prisma.JsonObject,
      },
    });

    return horoscope;
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

  private parseHoroscopeJson(content: string): HoroscopeCategories {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ServiceUnavailableException('Invalid JSON from DeepSeek');
    }

    if (!isHoroscopeCategories(parsed)) {
      if (typeof parsed === 'object' && parsed !== null) {
        return toHoroscopeCategories(parsed as Record<string, unknown>);
      }
      throw new ServiceUnavailableException('Invalid horoscope format');
    }

    return parsed;
  }

  private getPeriodPrompt(period: HoroscopePeriod): string {
    const prompts: Record<HoroscopePeriod, string> = {
      day: 'Составь персональный гороскоп на сегодня / Create a personal horoscope for today.',
      week: 'Составь персональный гороскоп на неделю / Create a personal horoscope for the week.',
      month:
        'Составь персональный гороскоп на месяц / Create a personal horoscope for the month.',
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
