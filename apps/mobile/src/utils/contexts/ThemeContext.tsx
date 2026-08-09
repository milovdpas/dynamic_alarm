import React, { createContext, useContext, useEffect, useState } from 'react';
import Storage from '@/utils/modules/Storage';
import { useColorScheme } from 'react-native';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

interface ThemeContextProps {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // RN 0.86 can also report 'unspecified', which is neither scheme.
    const systemTheme: Theme = useColorScheme() === 'dark' ? 'dark' : 'light';
    const [theme, setTheme] = useState<Theme>(systemTheme);

    useEffect(() => {
        const loadTheme = async () => {
            try {
                const savedTheme = await Storage.getItem(STORAGE_KEY);
                if (savedTheme === 'light' || savedTheme === 'dark') {
                    setTheme(savedTheme);
                }
            } catch {
                // Storage is unavailable in some runtimes. Falling back to the
                // system scheme is a fine outcome; crashing the provider that
                // wraps the entire app is not.
            }
        };
        void loadTheme();
    }, []);

    const toggleTheme = async () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        try {
            await Storage.setItem(STORAGE_KEY, newTheme);
        } catch {
            // The toggle still applies for this session; it just will not persist.
        }
    };

    return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
