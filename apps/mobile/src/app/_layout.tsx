import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';

import '@/i18n/i18n';
import { useAlarmRouting } from '@/alarm/useAlarmRouting';
import { ThemeProvider, useTheme } from '@/utils/contexts/ThemeContext';

function RootNavigator() {
    const { theme } = useTheme();
    const { t } = useTranslation();

    // Sends the app to the ring screen when a full-screen intent wakes it.
    useAlarmRouting();

    return (
        <NavigationTheme value={theme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
                <Stack.Screen name="index" options={{ title: 'Dynamic Alarm' }} />
                {/*
                 * The group runs its own Stack, which draws its own header with
                 * its own back arrow. Without this the two nest and the screen
                 * gets two headers and two ways back, one of which leaves the
                 * flow entirely.
                 */}
                <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
                <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
                {/*
                 * Reachable only from settings, after ten taps on the version
                 * and a password. Still a real route: the gate is about not
                 * being stumbled into, not about being unreachable.
                 */}
                <Stack.Screen name="debug" options={{ title: t('settings.debug_title') }} />
                <Stack.Screen
                    name="ring"
                    options={{
                        // The alarm owns the screen: no header, no swipe-back, no
                        // way to dismiss it by reflex. Stopping it must be deliberate.
                        headerShown: false,
                        gestureEnabled: false,
                        animation: 'fade',
                        presentation: 'fullScreenModal',
                    }}
                />
            </Stack>
        </NavigationTheme>
    );
}

export default function RootLayout() {
    return (
        <ThemeProvider>
            <RootNavigator />
        </ThemeProvider>
    );
}
