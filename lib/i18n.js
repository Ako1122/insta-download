export const LANG_COOKIE = 'reelsdl_lang';

export const LOCALES = [
  { id: 'en', label: 'English', dir: 'ltr' },
  { id: 'es', label: 'Español', dir: 'ltr' },
  { id: 'zh', label: '简体中文', dir: 'ltr' },
  { id: 'zh-tw', label: '繁體中文', dir: 'ltr' },
  { id: 'hi', label: 'हिन्दी', dir: 'ltr' },
  { id: 'ar', label: 'العربية', dir: 'rtl' },
  { id: 'pt', label: 'Português', dir: 'ltr' },
  { id: 'bn', label: 'বাংলা', dir: 'ltr' },
  { id: 'ru', label: 'Русский', dir: 'ltr' },
  { id: 'ja', label: '日本語', dir: 'ltr' },
  { id: 'fr', label: 'Français', dir: 'ltr' },
  { id: 'de', label: 'Deutsch', dir: 'ltr' },
  { id: 'ko', label: '한국어', dir: 'ltr' },
  { id: 'it', label: 'Italiano', dir: 'ltr' },
  { id: 'tr', label: 'Türkçe', dir: 'ltr' },
  { id: 'vi', label: 'Tiếng Việt', dir: 'ltr' },
  { id: 'id', label: 'Indonesia', dir: 'ltr' },
  { id: 'th', label: 'ไทย', dir: 'ltr' },
  { id: 'pl', label: 'Polski', dir: 'ltr' },
  { id: 'uk', label: 'Українська', dir: 'ltr' },
  { id: 'nl', label: 'Nederlands', dir: 'ltr' },
  { id: 'fa', label: 'فارسی', dir: 'rtl' },
  { id: 'ro', label: 'Română', dir: 'ltr' },
  { id: 'el', label: 'Ελληνικά', dir: 'ltr' },
  { id: 'cs', label: 'Čeština', dir: 'ltr' },
  { id: 'sv', label: 'Svenska', dir: 'ltr' },
  { id: 'hu', label: 'Magyar', dir: 'ltr' },
  { id: 'he', label: 'עברית', dir: 'rtl' },
  { id: 'ms', label: 'Melayu', dir: 'ltr' },
  { id: 'fil', label: 'Filipino', dir: 'ltr' },
  { id: 'ur', label: 'اردو', dir: 'rtl' }
];

const LOCALE_IDS = new Set(LOCALES.map((item) => item.id));

export function localeFromValue(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase().replace(/_/g, '-');
  const short = raw.split('-')[0];
  if (raw.startsWith('zh-hant') || raw.startsWith('zh-tw') || raw.startsWith('zh-hk') || raw.startsWith('zh-mo')) {
    return 'zh-tw';
  }
  if (short === 'zh') return 'zh';
  if (short === 'tl') return 'fil';
  if (LOCALE_IDS.has(raw)) return raw;
  if (LOCALE_IDS.has(short)) return short;
  return null;
}

export function localeFromAccept(header) {
  if (!header) return 'en';
  for (const part of header.split(',')) {
    const matched = localeFromValue(part.split(';')[0]);
    if (matched) return matched;
  }
  return 'en';
}

export function localeMeta(id) {
  return LOCALES.find((item) => item.id === id) || LOCALES[0];
}
