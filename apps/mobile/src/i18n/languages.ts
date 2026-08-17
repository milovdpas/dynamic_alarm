/**
 * Where the chosen language is kept.
 *
 * Exported so the settings screen writes the same key `i18n.ts` reads on boot.
 * Two spellings of it would mean a choice that applies immediately and silently
 * reverts on the next launch.
 */
export const LANGUAGE_STORAGE_KEY = 'appLanguage';

export enum Language {
    NL = 'nl',
    EN = 'en',
}

/**
 * Dutch leads because the MVP targets the Netherlands, NS journeys, Dutch
 * station names, Dutch commuters. English is the fallback, not the default
 * audience.
 */
export const supportedLanguages = [Language.NL, Language.EN];

export default [
    { label: 'Nederlands', code: Language.NL, icon: '🇳🇱' },
    { label: 'English', code: Language.EN, icon: '🇬🇧' },
];
