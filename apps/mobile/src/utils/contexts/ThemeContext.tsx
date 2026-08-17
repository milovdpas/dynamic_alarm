import React, { createContext, useContext, useEffect, useState } from 'react';
import Storage from '@/utils/modules/Storage';
import { useColorScheme } from 'react-native';

import { Colors } from '@/assets/Stylesheet';

/**
 * What the app paints. A key of the `Colors` map, so adding a palette there is
 * the only edit a new theme needs.
 */
export type Theme = keyof typeof Colors;

/**
 * What the user chose, which is a third thing.
 *
 * `system` is not a colour, it is a decision to keep following the phone, and it
 * has to be stored as itself. Resolving it to `light` at the moment it is picked
 * would freeze the app at whatever the phone happened to be doing that evening,
 * and it would never turn dark again.
 */
export type ThemePreference = 'system' | Theme;

const STORAGE_KEY = 'theme';

function isPreference(value: string | null): value is ThemePreference {
    // Checked against the map rather than a list of names, so a palette added
    // there cannot be one the app refuses to load back on the next launch.
    return value === 'system' || (value !== null && value in Colors);
}

interface ThemeContextProps {
    /** The resolved scheme, which is what components paint with. */
    theme: Theme;
    /** The stored choice, which is what the settings screen shows as selected. */
    preference: ThemePreference;
    setPreference: (next: ThemePreference) => void;
    /**
     * False until the stored choice has been read.
     *
     * The root layout holds the splash screen up while this is false, so the app
     * never paints a light screen and then turns dark a frame later. See
     * `app/_layout.tsx`.
     */
    ready: boolean;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // RN 0.86 can also report 'unspecified', which is neither scheme.
    const systemTheme: Theme = useColorScheme() === 'dark' ? 'dark' : 'light';
    const [preference, setStoredPreference] = useState<ThemePreference>('system');
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const loadTheme = async () => {
            try {
                const saved = await Storage.getItem(STORAGE_KEY);
                if (isPreference(saved)) {
                    setStoredPreference(saved);
                }
            } catch {
                // Storage is unavailable in some runtimes. Falling back to the
                // system scheme is a fine outcome; crashing the provider that
                // wraps the entire app is not.
            } finally {
                // Always, including on the failure above. This releases the
                // splash screen, so anything that can leave it false would leave
                // the app on a splash it never comes back from.
                setReady(true);
            }
        };
        void loadTheme();
    }, []);

    const setPreference = (next: ThemePreference): void => {
        setStoredPreference(next);
        void Storage.setItem(STORAGE_KEY, next).catch(() => undefined);
    };

    const theme: Theme = preference === 'system' ? systemTheme : preference;

    return (
        <ThemeContext.Provider value={{ theme, preference, setPreference, ready }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
