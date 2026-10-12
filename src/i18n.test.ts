import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  LOCALE_OPTIONS,
  LocaleProvider,
  formatNumber,
  resolveLocale,
  t,
  translate,
  useLocale,
} from "./i18n";
import en from "./locales/en";
import zh from "./locales/zh";
import zhHant from "./locales/zh-Hant";
import ja from "./locales/ja";
import ko from "./locales/ko";
import es from "./locales/es";
import fr from "./locales/fr";

const dictionaries = { en, zh, "zh-Hant": zhHant, ja, ko, es, fr };
const placeholders = (text: string) =>
  Array.from(text.matchAll(/\{([^}]+)\}/g), (match) => match[1]).sort();

describe("AGM locale conventions", () => {
  it("provides the same seven language choices", () => {
    expect(LOCALE_OPTIONS.map(({ value }) => value)).toEqual([
      "en",
      "zh",
      "zh-Hant",
      "ja",
      "ko",
      "es",
      "fr",
    ]);
  });
  it.each([
    ["fr", "zh-CN", "fr"],
    ["zh-Hant", "en-US", "zh-Hant"],
    ["invalid", "es-MX", "es"],
    [null, "zh_TW", "zh-Hant"],
    [null, "zh-HK", "zh-Hant"],
    [null, "zh-MO", "zh-Hant"],
    [null, "zh-Hant-TW", "zh-Hant"],
    [null, "zh-CN", "zh"],
    [null, "zh-Hans", "zh"],
    [null, "ja-JP", "ja"],
    [null, "ko-KR", "ko"],
    [null, "fr-CA", "fr"],
    [null, "de-DE", "en"],
  ])("resolves stored %s / system %s as %s", (stored, system, expected) => {
    expect(resolveLocale(stored, system)).toBe(expected);
  });
  it("keeps every dictionary complete with matching placeholders", () => {
    for (const [locale, messages] of Object.entries(dictionaries)) {
      expect(Object.keys(messages).sort(), locale).toEqual(
        Object.keys(en).sort(),
      );
      for (const key of Object.keys(en) as Array<keyof typeof en>) {
        expect(messages[key].trim(), `${locale}.${key}`).not.toBe("");
        expect(placeholders(messages[key]), `${locale}.${key}`).toEqual(
          placeholders(en[key]),
        );
      }
    }
  });
  it("translates navigation and parameterized results", () => {
    expect(translate("fr", "nav.language")).toBe("Langue");
    expect(translate("es", "result.page", { page: 2 })).toBe("Página 2");
    expect(translate("zh-Hant", "connection.password")).toBe("密碼");
    expect(
      translate("en", "error.readProfiles", {
        message: "literal {message} / $&",
      }),
    ).toBe("Could not read connection settings: literal {message} / $&");
  });
});

function LocaleControl() {
  const { setLocale } = useLocale();
  return createElement(
    "button",
    { onClick: () => setLocale("zh-Hant") },
    t("nav.language"),
  );
}

it("initializes from the system when no valid preference exists and updates document language", () => {
  const language = vi
    .spyOn(navigator, "language", "get")
    .mockReturnValue("fr-CA");
  try {
    localStorage.setItem("mdb.locale", "unsupported");
    render(createElement(LocaleProvider, null, createElement(LocaleControl)));
    expect(screen.getByRole("button", { name: "Langue" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Langue" }));
    expect(document.documentElement.lang).toBe("zh-Hant");
    expect(localStorage.getItem("mdb.locale")).toBe("zh-Hant");
    expect(formatNumber(18446744073709551615n)).toBe(
      "18,446,744,073,709,551,615",
    );
  } finally {
    language.mockRestore();
  }
});

it("keeps language selection usable when preference storage is unavailable", () => {
  const language = vi
    .spyOn(navigator, "language", "get")
    .mockReturnValue("en-US");
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
  try {
    render(createElement(LocaleProvider, null, createElement(LocaleControl)));
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    expect(screen.getByRole("button", { name: "語言" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("zh-Hant");
  } finally {
    language.mockRestore();
    read.mockRestore();
    write.mockRestore();
  }
});
