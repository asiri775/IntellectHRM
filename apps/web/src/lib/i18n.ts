import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import si from '../locales/si.json';
import ta from '../locales/ta.json';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'si', label: 'සිංහල' },
  { code: 'ta', label: 'தமிழ்' },
] as const;

const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ihrm.lang') : null;

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, si: { translation: si }, ta: { translation: ta } },
  lng: saved ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  localStorage.setItem('ihrm.lang', lng);
});
document.documentElement.lang = i18n.language;

export default i18n;
