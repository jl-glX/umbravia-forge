import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import deCh from "./locales/de-CH.json";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";

export const supportedLanguages = ["es", "en", "de", "de-CH"] as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      "de-CH": { translation: deCh },
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: {
      "de-CH": ["de"],
      de: [],
      default: ["es"],
    },
    supportedLngs: supportedLanguages,
    load: "all",
    nonExplicitSupportedLngs: false,
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "umbravia-forge-language",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  })
  .then(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "es";
  });

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

export default i18n;
