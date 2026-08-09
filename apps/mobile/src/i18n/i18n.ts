import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import Storage from '@/utils/modules/Storage';
import { loadOptionalModule } from '@/utils/modules/optionalModule';
import translations from '@/i18n/translations/index';
import { Language, supportedLanguages } from '@/i18n/languages';

const STORAGE_KEY = 'appLanguage';

/**
 * Device language, or null when `expo-localization` is unavailable.
 *
 * Lazily loaded like every other native module, see CONVENTIONS.md. Losing the
 * device locale just means falling back to the default language, which is a far
 * better outcome than the app refusing to start over a language guess.
 */
function getDeviceLanguage(): string | null {
    const localization = loadOptionalModule(
        () => require('expo-localization') as typeof import('expo-localization'),
    );
    if (localization === null) {
        return null;
    }
    try {
        return localization.getLocales()[0]?.languageCode ?? null;
    } catch {
        return null;
    }
}

/**
 * Initialised **synchronously**, so `i18n.t()` is usable from the moment the
 * bundle evaluates.
 *
 * This matters well beyond convenience: notification action titles and the
 * alarm labels are resolved for a native service that runs with no React tree,
 * and therefore no `useTranslation`. If init were async, those
 * paths could resolve before it finished and would need hardcoded English
 * fallbacks, which is exactly the duplicated copy this app does not want.
 *
 * The stored/device language is applied a moment later via `changeLanguage`.
 */
// eslint-disable-next-line import/no-named-as-default-member
void i18n.use(initReactI18next).init({
    resources: translations,
    lng: Language.NL,
    fallbackLng: Language.EN,
    keySeparator: '.',
    interpolation: {
        escapeValue: false,
    },
});

async function applyPreferredLanguage(): Promise<void> {
    let storedLanguage: string | null = null;
    try {
        storedLanguage = await Storage.getItem(STORAGE_KEY);
    } catch (error) {
        console.error('Failed to fetch stored language:', error);
    }

    const deviceLanguage = getDeviceLanguage();

    // 1. Stored choice wins. 2. Otherwise the device language, if we speak it.
    // 3. Otherwise leave the default in place.
    const appLanguage =
        storedLanguage ??
        (deviceLanguage !== null && supportedLanguages.includes(deviceLanguage as Language)
            ? deviceLanguage
            : null);

    if (appLanguage !== null && appLanguage !== i18n.language) {
        // eslint-disable-next-line import/no-named-as-default-member
        await i18n.changeLanguage(appLanguage);
    }
    if (storedLanguage === null) {
        try {
            await Storage.setItem(STORAGE_KEY, i18n.language);
        } catch (error) {
            console.error('Failed to store language:', error);
        }
    }
}

// Never let language preference resolution take the app down with it, an
// untranslated screen is recoverable, a blank one is not.
void applyPreferredLanguage().catch((error) => {
    console.error('Failed to apply preferred language:', error);
});

export default i18n;
