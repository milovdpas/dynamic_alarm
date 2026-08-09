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
