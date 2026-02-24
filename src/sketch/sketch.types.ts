export type SketchContent = {
  description: string;
  [key: string]: unknown;
};

export type SketchByLocale = {
  ru: SketchContent;
  en: SketchContent;
};
