import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';

import '@/i18n/i18n';
import { useAlarmRouting } from '@/alarm/useAlarmRouting';
import { defineWakeChangePushTask } from '@/push/backgroundTask';
import { usePushRescheduling } from '@/push/usePushRescheduling';
import { Colors } from '@/assets/Stylesheet';
import { type Theme, ThemeProvider, useTheme } from '@/utils/contexts/ThemeContext';
import { hideSplash, preventSplashAutoHide } from '@/utils/modules/Splash';

/**
 * At module scope on purpose, and this is the one place that is correct.
 *
 * When a push arrives with the app not running, the platform boots the bundle
 * headlessly and then looks for a task with that name. A task defined inside a
 * React effect would not exist yet: nothing has mounted, and nothing will. The
 * call itself loads no native module directly, it goes through
 * `loadOptionalModule`, so a build that predates the dependency returns early
 * rather than throwing here and taking the whole app down with it.
 */
defineWakeChangePushTask();

/**
 * Also module scope, and for the same class of reason.
 *
 * Expo hides the splash as soon as the first view mounts, so asking it to wait
 * from inside a component is asking too late. Held here, released the moment the
 * stored theme is known, which is what stops the launch flashing white on a
 * phone set to light by someone who chose dark.
 */
preventSplashAutoHide();

/**
 * The palette the navigation chrome paints with: headers, tab bar, back arrows.
 *
 * It has to be told separately, because React Navigation keeps its own theme and
 * knows nothing about `Colors`. Leaving a third palette out of this is what makes
 * an app look half-finished: the screen turns NS blue and the header above it
 * stays the stock one.
 */
function navigationTheme(theme: Theme) {
    const palette = Colors[theme];
    // Spread rather than built, so anything React Navigation adds to its theme
    // (fonts arrived this way) keeps coming with a sensible default.
    const base = theme === 'dark' ? DarkTheme : DefaultTheme;

    return {
        ...base,
        colors: {
            ...base.colors,
            primary: palette.primary,
            background: palette.background,
            // The header, which is the one surface a palette can use to say
            // whose app this is.
            card: palette.chrome,
            text: palette.text,
            border: palette.border,
        },
    };
}

function RootNavigator() {
    const { theme, ready } = useTheme();
    const { t } = useTranslation();

    // Sends the app to the ring screen when a full-screen intent wakes it.
    useAlarmRouting();
    // Registers this device for the pushes that move an armed alarm.
    usePushRescheduling();

    useEffect(() => {
        if (ready) {
            hideSplash();
        }
    }, [ready]);

    /*
     * One frame of nothing, behind a splash screen that is still up. Reading the
     * stored theme is a single storage read, so this is imperceptible, and it is
     * the alternative to painting the wrong colour first.
     */
    if (!ready) {
        return null;
    }

    return (
        <NavigationTheme value={navigationTheme(theme)}>
            <Stack>
                {/*
                 * The tab group draws its own tab bar, and each tab draws its
                 * own header. Without this the stack adds a second one above it.
                 */}
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                {/*
                 * The group runs its own Stack, which draws its own header with
                 * its own back arrow. Without this the two nest and the screen
                 * gets two headers and two ways back, one of which leaves the
                 * flow entirely.
                 */}
                <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
                {/*
                 * Reachable only from settings, after ten taps on the version
                 * and a password. Still a real route: the gate is about not
                 * being stumbled into, not about being unreachable.
                 */}
                {/*
                 * Two naming decisions here, both learned by hitting them.
                 *
                 * `/schedules/...` rather than `/schedule/...` because
                 * onboarding's schedule step already owns `/schedule`, and route
                 * groups do not appear in URLs. Two nodes claiming one segment
                 * resolves to nothing, reported as an unmatched route.
                 *
                 * `overview` rather than `index` because `resolveHref` does not
                 * strip a trailing `/index` from a pushed pathname, so an index
                 * file inside a dynamic folder is reachable by the router and not
                 * by any href that typed routes will accept. Naming the segment
                 * makes the route and the link agree.
                 */}
                <Stack.Screen name="schedules/[id]/overview" options={{ title: t('schedules.edit') }} />
                <Stack.Screen
                    name="schedules/[id]/deadline"
                    options={{ title: t('schedules.section_deadline') }}
                />
                <Stack.Screen
                    name="schedules/[id]/travel"
                    options={{ title: t('schedules.section_travel') }}
                />
                <Stack.Screen
                    name="schedules/[id]/routine"
                    options={{ title: t('schedules.section_routine') }}
                />
                <Stack.Screen name="journey/[id]" options={{ title: t('home.journey') }} />
                <Stack.Screen
                    name="settings/language"
                    options={{ title: t('language.title') }}
                />
                <Stack.Screen name="settings/theme" options={{ title: t('theme.title') }} />
                <Stack.Screen name="settings/sound" options={{ title: t('sound.title') }} />
                <Stack.Screen
                    name="settings/disruptions"
                    options={{ title: t('settings.disruptions') }}
                />
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
