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
import type { SketchType } from './dto/get-sketch.dto';
import type { SketchByLocale, SketchContent } from './sketch.types';

const SUPPORTED_LOCALES = ['ru', 'en'] as const;

function isSketchContent(value: unknown): value is SketchContent {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.description === 'string';
}

function toSketchContent(obj: Record<string, unknown>): SketchContent {
  const description =
    typeof obj.description === 'string'
      ? obj.description
      : JSON.stringify(obj.description ?? '');
  return { ...obj, description } as SketchContent;
}

@Injectable()
export class SketchService {
  private readonly client: OpenAI | null = null;
  private readonly prisma: PrismaClient;
  private readonly pendingGenerations = new Map<
    string,
    Promise<SketchByLocale>
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

  async getSketch(
    userId: number,
    quizResult: Record<string, unknown> | null,
    type: SketchType,
    locale: Locale,
  ): Promise<{ sketch: SketchContent }> {
    if (!quizResult || Object.keys(quizResult).length === 0) {
      const lang = I18nContext.current()?.lang ?? 'en';
      throw new BadRequestException(
        this.i18n.t('sketch.QUIZ_RESULT_REQUIRED', { lang }),
      );
    }

    const cached = await this.findCached(userId, type);

    if (cached) {
      const byLocale = this.parseCachedContent(cached.content);
      const lang = this.resolveLocale(locale);
      return { sketch: byLocale[lang] };
    }

    const sketch = await this.getOrCreateGeneration(userId, quizResult, type);

    const lang = this.resolveLocale(locale);
    return { sketch: sketch[lang] };
  }

  private getOrCreateGeneration(
    userId: number,
    quizResult: Record<string, unknown>,
    type: SketchType,
  ): Promise<SketchByLocale> {
    const key = `${userId}:${type}`;
    let pending = this.pendingGenerations.get(key);

    if (!pending) {
      pending = this.generateAndSave(userId, quizResult, type);

      this.pendingGenerations.set(key, pending);

      void pending.finally(() => this.pendingGenerations.delete(key));
    }

    return pending;
  }

  private async generateAndSave(
    userId: number,
    quizResult: Record<string, unknown>,
    type: SketchType,
  ): Promise<SketchByLocale> {
    const sketch = await this.fetchFromDeepSeek(quizResult, type);

    await this.prisma.sketch.create({
      data: {
        user: { connect: { id: userId } },
        type,
        content: sketch as unknown as Prisma.JsonObject,
      },
    });

    return sketch;
  }

  private resolveLocale(locale: string): 'ru' | 'en' {
    return SUPPORTED_LOCALES.includes(locale as 'ru' | 'en')
      ? (locale as 'ru' | 'en')
      : 'ru';
  }

  private parseCachedContent(content: Prisma.JsonValue): SketchByLocale {
    const str = typeof content === 'string' ? content : JSON.stringify(content);

    return this.parseSketchByLocaleJson(str);
  }

  private findCached(
    userId: number,
    type: SketchType,
  ): Promise<{ content: Prisma.JsonValue } | null> {
    return this.prisma.sketch.findFirst({
      where: {
        userId,
        type,
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
  }

  private async fetchFromDeepSeek(
    quizResult: Record<string, unknown>,
    type: SketchType,
  ): Promise<SketchByLocale> {
    if (!this.client) {
      throw new ServiceUnavailableException();
    }

    const systemPrompt = this.getSystemPromptBothLocales();
    const userPrompt = JSON.stringify({ quizResult, type }, null, 2);

    const completion = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `${this.getTypePrompt(type)}\n\nUser data:\n${userPrompt}`,
        },
      ],
      response_format: { type: 'json_object' },
      stream: false,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new ServiceUnavailableException('Empty response from DeepSeek');
    }

    return this.parseSketchByLocaleJson(content);
  }

  private parseSketchByLocaleJson(content: string): SketchByLocale {
    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ServiceUnavailableException('Invalid JSON from DeepSeek');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new ServiceUnavailableException('Invalid sketch format');
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
      throw new ServiceUnavailableException('Invalid sketch format');
    }

    return {
      ru: isSketchContent(ru)
        ? ru
        : toSketchContent(ru as Record<string, unknown>),
      en: isSketchContent(en)
        ? en
        : toSketchContent(en as Record<string, unknown>),
    };
  }

  private getTypePrompt(type: SketchType): string {
    const prompts: Record<SketchType, string> = {
      soulmate:
        'Создай описание идеальной второй половинки / Create a description of the ideal soulmate.',
      baby: 'Создай описание будущего ребёнка / Create a description of the future baby.',
    };
    return prompts[type];
  }

  private getSystemPromptBothLocales(): string {
    const schema = JSON.stringify(
      {
        ru: {
          description: 'string',
        },
        en: {
          description: 'string',
        },
      },
      null,
      2,
    );
    return `You are a creative writer. Based on the user's quizResult create a unique sketch in TWO languages: Russian (ru) and English (en).

You MUST respond ONLY with valid JSON in this exact format:
${schema}

For each language (ru and en), provide a "description" field - a vivid, detailed description (4-8 sentences) in that language. Write in a natural style. The content in "ru" must be in Russian, the content in "en" must be in English.`;
  }
}
