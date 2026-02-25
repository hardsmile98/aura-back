export type SketchContent = {
  description?: string;
  [key: string]: unknown;
};

/** Keys for soulmate sketch sections (ru/en each have these) */
export const SOULMATE_SECTION_KEYS = [
  'intro',
  'nameInitials',
  'soulmateSign',
  'compatibleSigns',
  'auraDescription',
  'personalityTraits',
  'spiritualAlignment',
  'jobAndCareer',
  'impactAndMission',
  'whenAndWhereMeet',
  'pastLifeConnection',
  'tarotCompatibility',
  'spiritualSymbols',
  'conclusion',
] as const;

export type SoulmateSectionKey = (typeof SOULMATE_SECTION_KEYS)[number];
export type SoulmateSketchContent = Record<SoulmateSectionKey, string>;

/** Keys for baby sketch sections (ru/en each have these) */
export const BABY_SECTION_KEYS = [
  'intro',
  'nameAndPersonality',
  'whenAndHowBorn',
  'personalityAndCharacter',
  'futureSuccessAndCareer',
  'parentChildBond',
  'firstYearsGuide',
  'conclusion',
] as const;

export type BabySectionKey = (typeof BABY_SECTION_KEYS)[number];
export type BabySketchContent = Record<BabySectionKey, string>;

/** Baby sketch gender: m = male/son, w = female/daughter */
export type BabySketchGender = 'm' | 'w';

export type SketchByLocale = {
  ru: SketchContent;
  en: SketchContent;
};

export type SketchResponse =
  | { status: string; sketch: SketchContent }
  | { status: 'pending' };
