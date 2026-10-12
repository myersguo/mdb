import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import ja from "./locales/ja";
import ko from "./locales/ko";
import zh from "./locales/zh";
import zhHant from "./locales/zh-Hant";
import type { MessageKey, Messages } from "./locales/types";

export type { MessageKey } from "./locales/types";
export type Locale = "en" | "zh" | "zh-Hant" | "ja" | "ko" | "es" | "fr";
const messages: Record<Locale, Messages> = {
  en,
  zh,
  "zh-Hant": zhHant,
  ja,
  ko,
  es,
  fr,
};
export const LOCALE_OPTIONS: {
  value: Locale;
  native: string;
  english: string;
}[] = [
  { value: "en", native: "English", english: "English" },
  { value: "zh", native: "简体中文", english: "Simplified Chinese" },
  { value: "zh-Hant", native: "繁體中文", english: "Traditional Chinese" },
  { value: "ja", native: "日本語", english: "Japanese" },
  { value: "ko", native: "한국어", english: "Korean" },
  { value: "es", native: "Español", english: "Spanish" },
  { value: "fr", native: "Français", english: "French" },
];

export function resolveLocale(
  stored: string | null | undefined,
  systemLanguage: string,
): Locale {
  if (LOCALE_OPTIONS.some(({ value }) => value === stored))
    return stored as Locale;
  const system = systemLanguage.replaceAll("_", "-").toLowerCase();
  if (
    ["zh-hant", "zh-tw", "zh-hk", "zh-mo"].some((prefix) =>
      system.startsWith(prefix),
    )
  )
    return "zh-Hant";
  if (system.startsWith("zh")) return "zh";
  for (const language of ["ja", "ko", "es", "fr"] as const) {
    if (system.startsWith(language)) return language;
  }
  return "en";
}

function detectLocale(): Locale {
  let stored: string | null = null;
  try {
    stored = globalThis.localStorage?.getItem("mdb.locale") ?? null;
  } catch {
    /* Language selection remains available when preference storage is blocked. */
  }
  return resolveLocale(stored, globalThis.navigator?.language || "en");
}

let currentLocale = detectLocale();
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = messages[locale][key] ?? en[key];
  return template.replace(/\{([^}]+)\}/g, (placeholder, name: string) =>
    params?.[name] === undefined ? placeholder : String(params[name]),
  );
}
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return translate(currentLocale, key, params);
}
export function formatNumber(value: number | bigint): string {
  return new Intl.NumberFormat(currentLocale).format(value);
}

const LocaleContext = createContext({
  locale: currentLocale,
  setLocale: (_locale: Locale) => {},
});
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(() => {
    currentLocale = detectLocale();
    return currentLocale;
  });
  const setLocale = (next: Locale) => {
    currentLocale = next;
    try {
      localStorage.setItem("mdb.locale", next);
    } catch {
      /* Language selection remains available when preference storage is blocked. */
    }
    setLocaleState(next);
  };
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hans" : locale;
    document.title = translate(locale, "app.title");
  }, [locale]);
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}
export function useLocale() {
  return useContext(LocaleContext);
}
