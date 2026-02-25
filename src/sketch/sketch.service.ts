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
import type { SketchType } from './dto/get-sketch.dto';
import type {
  SketchByLocale,
  SketchContent,
  SketchResponse,
} from './sketch.types';
import { BABY_SECTION_KEYS, SOULMATE_SECTION_KEYS } from './sketch.types';

const SUPPORTED_LOCALES = ['ru', 'en'] as const;

function isSketchContent(value: unknown): value is SketchContent {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.description === 'string' ||
    typeof obj.intro === 'string' ||
    typeof obj.nameAndPersonality === 'string' ||
    typeof obj.whenAndHowBorn === 'string'
  );
}

function getSectionKeys(obj: Record<string, unknown>): string[] {
  if (obj.soulmateSign !== undefined)
    return SOULMATE_SECTION_KEYS as unknown as string[];
  if (obj.nameAndPersonality !== undefined || obj.whenAndHowBorn !== undefined)
    return BABY_SECTION_KEYS as unknown as string[];
  return SOULMATE_SECTION_KEYS as unknown as string[];
}

function toSketchContent(obj: Record<string, unknown>): SketchContent {
  const result: Record<string, unknown> = { ...obj };
  if (typeof obj.description === 'string') {
    result.description = obj.description;
  } else if (
    typeof obj.intro === 'string' ||
    typeof obj.nameAndPersonality === 'string' ||
    typeof obj.whenAndHowBorn === 'string'
  ) {
    const sectionKeys = getSectionKeys(obj);
    for (const key of sectionKeys) {
      const v = obj[key];
      result[key] = typeof v === 'string' ? v : JSON.stringify(v ?? '');
    }
  } else {
    result.description = JSON.stringify(obj.description ?? '');
  }
  return result as SketchContent;
}

@Injectable()
export class SketchService {
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

  async getSketch(
    userId: number,
    quizResult: Record<string, unknown> | null,
    type: SketchType,
    locale: Locale,
  ): Promise<SketchResponse> {
    if (!quizResult || Object.keys(quizResult).length === 0) {
      const lang = I18nContext.current()?.lang ?? 'en';
      throw new BadRequestException(
        this.i18n.t('sketch.QUIZ_RESULT_REQUIRED', { lang }),
      );
    }

    const cached = await this.findCached(userId, type);

    if (cached) {
      const byLocale = this.parseCachedContent(cached.content);

      if (type === 'baby') {
        this.normalizeBabyGender(byLocale);
      }

      const lang = this.resolveLocale(locale);

      return { status: cached.status, sketch: byLocale[lang] };
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "User" WHERE id = ${userId} FOR UPDATE`,
      );

      const pending = await tx.sketch.findFirst({
        where: { userId, type, status: 'pending' },
        select: { id: true },
      });

      if (pending) return null;

      return tx.sketch.create({
        data: {
          user: { connect: { id: userId } },
          type,
          content: {},
          status: 'pending',
        },
      });
    });

    if (!created) {
      return { status: 'pending' };
    }

    void this.generateAndSave(quizResult, type, created.id);

    return { status: 'pending' };
  }

  private async generateAndSave(
    quizResult: Record<string, unknown>,
    type: SketchType,
    id: number,
  ): Promise<SketchByLocale | null> {
    try {
      const sketch = await this.fetchFromDeepSeek(quizResult, type);

      if (type === 'baby') {
        this.normalizeBabyGender(sketch);
      }

      await this.prisma.sketch.update({
        where: { id },
        data: {
          content: sketch as unknown as Prisma.JsonObject,
          status: 'completed',
        },
      });

      return sketch;
    } catch {
      await this.prisma.sketch.update({
        where: { id },
        data: { status: 'failed' },
      });

      return null;
    }
  }

  private resolveLocale(locale: string): 'ru' | 'en' {
    return SUPPORTED_LOCALES.includes(locale as 'ru' | 'en')
      ? (locale as 'ru' | 'en')
      : 'ru';
  }

  private normalizeBabyGender(sketch: SketchByLocale): void {
    for (const lang of ['ru', 'en'] as const) {
      const content = sketch[lang] as Record<string, unknown>;
      const g = content?.gender;
      content.gender =
        typeof g === 'string' && (g === 'm' || g === 'w') ? g : 'm';
    }
  }

  private parseCachedContent(content: Prisma.JsonValue): SketchByLocale {
    const str = typeof content === 'string' ? content : JSON.stringify(content);

    return this.parseSketchByLocaleJson(str);
  }

  private findCached(
    userId: number,
    type: SketchType,
  ): Promise<{ content: Prisma.JsonValue; status: string } | null> {
    return this.prisma.sketch.findFirst({
      where: {
        userId,
        type,
        status: 'completed',
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true, status: true },
    });
  }

  private async fetchFromDeepSeek(
    quizResult: Record<string, unknown>,
    type: SketchType,
  ): Promise<SketchByLocale> {
    if (!this.client) {
      throw new ServiceUnavailableException();
    }

    const systemPrompt =
      type === 'soulmate'
        ? this.getSystemPromptSoulmate()
        : this.getSystemPromptBaby();
    const userPrompt = JSON.stringify({ quizResult, type }, null, 2);

    const completion = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `${this.getTypePrompt(type)}\n\nUser data (use this quiz data for personalization):\n${userPrompt}`,
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
        'Create a soulmate sketch using the 14 sections below. Use the quiz data (quizResult) for personalization: user name, star sign, Venus sign, and any other fields to make the sketch unique and personalized.',
      baby: 'Create a baby sketch using the 8 sections below. Use the quiz data (quizResult) for personalization: user name, star sign (zodiac), child gender if present, and any other fields to make the sketch unique and personalized.',
    };
    return prompts[type];
  }

  private getSystemPromptSoulmate(): string {
    const schema = JSON.stringify(
      {
        ru: {
          intro: 'string',
          nameInitials: 'string',
          soulmateSign: 'string',
          compatibleSigns: 'string',
          auraDescription: 'string',
          personalityTraits: 'string',
          spiritualAlignment: 'string',
          jobAndCareer: 'string',
          impactAndMission: 'string',
          whenAndWhereMeet: 'string',
          pastLifeConnection: 'string',
          tarotCompatibility: 'string',
          spiritualSymbols: 'string',
          conclusion: 'string',
        },
        en: {
          intro: 'string',
          nameInitials: 'string',
          soulmateSign: 'string',
          compatibleSigns: 'string',
          auraDescription: 'string',
          personalityTraits: 'string',
          spiritualAlignment: 'string',
          jobAndCareer: 'string',
          impactAndMission: 'string',
          whenAndWhereMeet: 'string',
          pastLifeConnection: 'string',
          tarotCompatibility: 'string',
          spiritualSymbols: 'string',
          conclusion: 'string',
        },
      },
      null,
      2,
    );
    return `You are a creative astrological writer. Based on the user's quizResult (quiz data) create a unique soulmate sketch in TWO languages: Russian (ru) and English (en).

Use the quiz data for personalization: the user's name, Star Sign (zodiac), Venus Sign, and any other quiz fields. Mention their sign when relevant (e.g. "As a Cancer..." or "Your Venus in Scorpio...").

You MUST respond ONLY with valid JSON in this exact format:
${schema}

Sections (write 4–8 sentences per section, vivid and engaging):

1) intro — Introduction. Welcome the user to their soulmate story: they will discover a sketch of their soulmate and the story of where and how they will meet. Tie the journey to their personal astrology: Star Sign reveals personality, Venus Sign uncovers desires in love and the key to their perfect match.

2) nameInitials — Name initials of the soulmate. Reveal initials (e.g. L.D.), their significance, where they might appear (book, billboard, conversation), and that they are signs from the universe.

3) soulmateSign — Soulmate's zodiac sign. Describe one sign that fits the user's compatibility. Explain the sign's traits: emotional depth, loyalty, how they love, why they match the user's sign.

4) compatibleSigns — Other compatible signs. Name 2–3 other signs with short paragraphs each (e.g. Pisces, Taurus): how each complements the user's sign and what they bring to the relationship.

5) auraDescription — Aura of the soulmate. The unique energy and aura, what makes them the perfect match.

6) personalityTraits — Personality traits of the soulmate. Loyalty, strength, dedication, and other traits that make them special.

7) spiritualAlignment — Spiritual alignment of the soulmate. Their connection to love, compassion, emotional balance, and how it creates a harmonious bond.

8) jobAndCareer — Job and career of the soulmate. Their ambition, career path, and professional drive.

9) impactAndMission — Impact and mission of the soulmate. Their purpose and mission in life.

10) whenAndWhereMeet — When and where they will meet. How the universe has aligned for the encounter.

11) pastLifeConnection — Past life connection. Bond forged in the past, coming together again in this lifetime.

12) tarotCompatibility — Tarot reading for compatibility. Dynamic connection, growth, challenges, and triumphs.

13) spiritualSymbols — Spiritual symbols around the relationship. Signs and symbols guiding them toward each other.

14) conclusion — Conclusion. The path to the soulmate is a journey of self-discovery and spiritual growth; trust the universe's timing; open heart; invitation to explore more (e.g. astrologers, Natal Chart, Compatibility Reading).

Output: "ru" must be entirely in Russian, "en" entirely in English. Each value is a single string (no nested JSON).`;
  }

  private getSystemPromptBaby(): string {
    const schema = JSON.stringify(
      {
        ru: {
          gender: '"m" | "w"',
          intro: 'string',
          nameAndPersonality: 'string',
          whenAndHowBorn: 'string',
          personalityAndCharacter: 'string',
          futureSuccessAndCareer: 'string',
          parentChildBond: 'string',
          firstYearsGuide: 'string',
          conclusion: 'string',
        },
        en: {
          gender: '"m" | "w"',
          intro: 'string',
          nameAndPersonality: 'string',
          whenAndHowBorn: 'string',
          personalityAndCharacter: 'string',
          futureSuccessAndCareer: 'string',
          parentChildBond: 'string',
          firstYearsGuide: 'string',
          conclusion: 'string',
        },
      },
      null,
      2,
    );
    return `You are a creative astrological writer. Based on the user's quizResult (quiz data) create a unique baby sketch in TWO languages: Russian (ru) and English (en).

Use the quiz data for personalization: the user's name, Star Sign (zodiac), child's gender (son/daughter) if available, and any other quiz fields. Mention their sign when relevant (e.g. "Your caring Cancer has called a gentle soul to join your family" or "Your son chose you because...").

You MUST respond ONLY with valid JSON in this exact format:
${schema}

IMPORTANT: For "gender" use exactly "m" (for son/male) or "w" (for daughter/female). Prefer the value from quiz data if the user specified child gender; otherwise infer from context or use "m".

Sections (write 4–8 sentences per section, vivid and engaging):

1) intro — Introduction. Welcome the user to their baby's story: the sketch of their [son/daughter] is drawn by cosmic energy; the Universe has revealed secrets about the little spirit growing within them. Tie the journey to their personal astrology and the nurturing energy their child will embody. Their [zodiac] has called a gentle soul to join the family; their [son/daughter] chose them because their empathy and emotional depth are the perfect foundation. Set the stage for the child's destiny and the deep bond that awaits.

2) nameAndPersonality — Name and personality of the child. The Universe has whispered sacred names that open the child's highest destiny; cosmic keys for their whole life. Mystical letters in the child's energy signature will appear at key moments—in names of friends, future partners, cities of success, life-changing opportunities. Cosmic forces have chosen which letters will be secret guides, attracting the right people and events.

3) whenAndHowBorn — When and how the child will be born. The baby has chosen the perfect moment—divinely planned. The cosmic calendar reveals the date and the magical circumstances that will make the birth a true omen. Signs and coincidences so their arrival becomes the awaited miracle. The sacred first moment when eyes meet—the deep realization that changes the parent forever; why this soul chose them and why this time was written in the stars.

4) personalityAndCharacter — Personality and character of the child. The captivating, unique personality; everyone who meets them will be charmed. Their emotional gifts will make them irresistible and successful. How they will show feelings, communicate, and navigate the social world. The secret of their deepest emotional needs and the social strengths they will use to build meaningful friendships. Natural confidence and magnetic personality; how to nurture these talents from their first contacts with the world.

5) futureSuccessAndCareer — Future success and career of the child. A career aligned with their soul's purpose so work feels like play. Special talents that will set them apart. Their academic path holds secrets that open unexpected doors. When they will achieve their greatest breakthroughs—from school to outstanding results. Hidden strengths that make them a natural leader; when the biggest opportunities will appear. How to recognize and nurture their talents from the start.

6) parentChildBond — Bond and parenting between parent and child. The relationship will be extraordinary—deeper than typical parent-child bonds. The secret language of how the child gives and receives love; knowing it reveals a connection that amazes. Activities and experiences that create an unbreakable bond; words and actions that help the child feel loved and understood; how to handle challenges that can strengthen or weaken the relationship. The destiny of a lifelong bond that will inspire and support both for decades.

7) firstYearsGuide — Guide for the child's first years. The first years hold secrets that shape personality and future success. From the first months, signs of the remarkable person they are destined to become; what to look for to nurture talents and wisely overcome difficulties. How their personality will develop in early childhood; specific challenges and how to turn them into strengths; ways to support development for happiness and success. A personal roadmap for raising the extraordinary soul who chose them as parent.

8) conclusion — Conclusion. The [son/daughter] chose them because their [zodiac] energy gives what the child needs to fulfill their soul's purpose. Their natural care, emotional depth, and intuitive wisdom give the foundation for the compassionate, healing, inspiring person the child is destined to be. Trust the cosmic wisdom that brought them together. The child will fulfill dreams of parenthood and teach new dimensions of love and connection. The Universe has blessed both with a bond that will grow deeper each year.

Output: "ru" must be entirely in Russian, "en" entirely in English. Each value is a single string (no nested JSON).`;
  }
}
