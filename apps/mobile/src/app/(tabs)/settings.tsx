import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import languages from '@/i18n/languages';

import appConfig from '@/config';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import SettingsRow from '@/components/settings/SettingsRow';
import TextField from '@/components/ui/TextField';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/** Taps on the version before the diagnostics gate appears. */
const TAPS_TO_REVEAL = 10;

/**
 * A list of what can be changed, and the door to diagnostics.
 *
 * Rows leading to screens rather than controls in place. Every setting in this
 * app decides something about an alarm going off, which deserves a sentence of
 * explanation before it deserves a tap, and a list cannot hold that for more
 * than one of them. It also keeps this screen readable as more settings arrive:
 * language and theme are next, and both are choices rather than switches.
 *
 * The app version sits at the bottom the way every phone puts it, and is also
 * the way into the debug panel: ten taps, then a password.
 */
export default function SettingsScreen() {
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const border = useThemeColor({}, 'border');

    const [taps, setTaps] = useState(0);
    const [password, setPassword] = useState('');
    const [wrong, setWrong] = useState(false);

    const revealed = taps >= TAPS_TO_REVEAL;

    const unlock = () => {
        if (password === appConfig.debugPassword) {
            setTaps(0);
            setPassword('');
            setWrong(false);
            router.push('/debug');
            return;
        }
        setWrong(true);
    };

    const scroll = useRef<ScrollView>(null);

    /**
     * Brings the password field into view when it appears.
     *
     * Avoiding the keyboard is not enough on its own: the card is added below
     * the version row, which sits at the foot of the screen, so on a short
     * screen it opens off the bottom whether a keyboard is up or not.
     */
    useEffect(() => {
        if (revealed) {
            const timer = setTimeout(() => {
                scroll.current?.scrollToEnd({ animated: true });
            }, 50);
            return () => {
                clearTimeout(timer);
            };
        }
        return undefined;
    }, [revealed]);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
                {/*
                 * The password field is the last thing on a screen whose content
                 * is pinned to the bottom, so the keyboard opened straight over
                 * it. Android no longer resizes the window under edge-to-edge,
                 * which is why this is needed on both platforms rather than
                 * being an iOS habit.
                 */}
                <KeyboardAvoidingView style={styles.flex} behavior="padding">
                    <ScrollView
                        ref={scroll}
                        // grow rather than a fixed height, so the content fills a
                        // short screen and still scrolls on a long one. That is what
                        // lets the version sit at the bottom in both cases.
                        contentContainerStyle={styles.content}
                        keyboardShouldPersistTaps="handled"
                    >
                        <ThemedText type="title">{t('settings.title')}</ThemedText>

                        <SettingsRow
                            icon="alert-decagram-outline"
                            label={t('settings.disruptions')}
                            value={t('settings.disruptions_summary')}
                            onPress={() => {
                                router.push('/settings/disruptions');
                            }}
                        />

                        <SettingsRow
                            icon="translate"
                            label={t('language.title')}
                            // The language it is in, in that language. Someone
                            // who has landed in the wrong one needs to recognise
                            // their own, not read a translation of its name.
                            value={
                                languages.find((language) => language.code === i18n.language)
                                    ?.label ?? i18n.language
                            }
                            onPress={() => {
                                router.push('/settings/language');
                            }}
                        />

                        <Pressable
                            // marginTop auto pushes this to the bottom of whatever
                            // space is left, so it sits at the foot of the screen
                            // rather than a fixed gap below the last setting.
                            style={styles.versionRow}
                            onPress={() => {
                                setTaps((count) => count + 1);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={t('settings.version', {
                                version: appConfig.appVersion,
                            })}
                        >
                            <ThemedText
                                type="small"
                                themeColor="textSecondary"
                                style={styles.version}
                            >
                                {t('settings.version', { version: appConfig.appVersion })}
                            </ThemedText>
                        </Pressable>

                        {revealed && (
                            <View style={[styles.card, { borderColor: border }]}>
                                <ThemedText type="smallBold">{t('settings.debug_title')}</ThemedText>
                                <TextField
                                    label={t('settings.debug_password')}
                                    value={password}
                                    onChangeText={(value) => {
                                        setPassword(value);
                                        setWrong(false);
                                    }}
                                    secureTextEntry
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    error={wrong ? t('settings.debug_wrong') : undefined}
                                />
                                <ActionButton label={t('settings.debug_open')} onPress={unlock} />
                            </View>
                        )}
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: {
        flexGrow: 1,
        padding: Spacing.large,
        gap: Spacing.medium,
    },
    card: {
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
        gap: Spacing.small,
    },
    versionRow: { marginTop: 'auto', paddingTop: Spacing.large },
    version: { textAlign: 'center' },
});
