import { Lang } from './types';

/** 'en' | 'hi' keep their own colour; every other language shares a third one. */
export function langGroup(code: string): 'en' | 'hi' | 'other' {
  return code === 'en' || code === 'hi' ? code : 'other';
}

/** "Persian", "फ़ारसी"… in the reader's interface language. */
export function languageName(code: string, ui: Lang): string {
  try {
    return new Intl.DisplayNames([ui === 'hi' ? 'hi' : 'en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function countryName(code: string | undefined, ui: Lang): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([ui === 'hi' ? 'hi' : 'en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** 🇮🇳 from "IN": two regional-indicator letters. */
export function flag(code: string | undefined): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
