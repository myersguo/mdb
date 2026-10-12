import { Check, Globe2 } from "lucide-react";
import { LOCALE_OPTIONS, t, useLocale } from "../i18n";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <details
      className="language-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary title={t("nav.language")}>
        <Globe2 size={16} aria-hidden="true" />
        <span>{t("nav.language")}</span>
      </summary>
      <div className="language-popover">
        {LOCALE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.native}
            aria-pressed={option.value === locale}
            className={option.value === locale ? "active" : ""}
            onClick={(event) => {
              setLocale(option.value);
              const menu = event.currentTarget.closest("details");
              if (menu) {
                menu.open = false;
                menu.querySelector("summary")?.focus();
              }
            }}
          >
            <span className="language-native">{option.native}</span>
            <span className="language-english">{option.english}</span>
            {option.value === locale && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </details>
  );
}
