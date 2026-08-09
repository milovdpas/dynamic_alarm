import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from 'expo-router';

import '@/i18n/i18n';
import { useAlarmRouting } from '@/alarm/useAlarmRouting';
import { ThemeProvider, useTheme } from '@/utils/contexts/ThemeContext';

function RootNavigator() {
    const { theme } = useTheme();

    // Sends the app to the ring screen when a full-screen intent wakes it.
    useAlarmRouting();

    return (
        <NavigationTheme value={theme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
                <Stack.Screen name="index" options={{ title: 'Dynamic Alarm' }} />
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
