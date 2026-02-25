export type HoroscopeCategories = {
  love: string;
  career: string;
  health: string;
  finance: string;
  family: string;
  travel: string;
};

export type HoroscopeByLocale = {
  ru: HoroscopeCategories;
  en: HoroscopeCategories;
};

export type HoroscopeResponse =
  | { status: string; horoscope: HoroscopeCategories }
  | { status: 'pending' };
