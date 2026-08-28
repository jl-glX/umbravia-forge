import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import caValencia from "./locales/ca-valencia.json";
import ca from "./locales/ca.json";
import deCh from "./locales/de-CH.json";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import eu from "./locales/eu.json";
import fr from "./locales/fr.json";
import gl from "./locales/gl.json";
import it from "./locales/it.json";
import ocAranes from "./locales/oc-aranes.json";
import {
  canonicalizeLocale,
  regionalLocaleFallbacks,
  supportedLocales,
} from "./supported-locales";

export const supportedLanguages = supportedLocales;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ca: { translation: ca },
      "ca-valencia": { translation: caValencia },
      de: { translation: de },
      "de-CH": { translation: deCh },
      en: { translation: en },
      es: { translation: es },
      eu: { translation: eu },
      fr: { translation: fr },
      gl: { translation: gl },
      it: { translation: it },
      "oc-aranes": { translation: ocAranes },
    },
    fallbackLng: {
      ...Object.fromEntries(
        Object.entries(regionalLocaleFallbacks).map(([locale, fallback]) => [
          locale,
          [fallback],
        ]),
      ),
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
      convertDetectedLanguage: canonicalizeLocale,
    },
    interpolation: {
      escapeValue: false,
    },
  })
  .then(() => {
    document.documentElement.lang = canonicalizeLocale(i18n.resolvedLanguage);
  });

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = canonicalizeLocale(language);
});

export default i18n;
