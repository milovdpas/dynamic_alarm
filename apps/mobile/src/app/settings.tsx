import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { DeviceResponse } from '@alarm/types';

import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { getDevice, listSchedules, updateDevice } from '@/api';
import appConfig from '@/config';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import DisruptionSettings, { settingsForModes } from '@/components/settings/DisruptionSettings';
import type { DisruptionSetting } from '@/components/settings/DisruptionSettings';
import TextField from '@/components/ui/TextField';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { ApiRequestError } from '@/utils/modules/Axios';

/** Taps on the version before the diagnostics gate appears. */
const TAPS_TO_REVEAL = 10;

/**
 * The things that can be changed but rarely are, and the door to diagnostics.
 *
 * The disruption settings are read from the server rather than kept locally,
 * because the monitor is what acts on them. A local mirror could disagree with
 * the values actually in force overnight, and nothing on screen would say which
 * was real.
 */
export default function SettingsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const border = useThemeColor({}, 'border');

    const [device, setDevice] = useState<DeviceResponse | null>(null);
    /**
     * Only the settings this device's own schedules can act on.
     *
     * Someone who only takes the train has no traffic to watch. Until the
     * schedules load nothing is shown rather than everything, because a switch
     * that disappears a moment later is worse than one that arrives late.
     */
    const [settings, setSettings] = useState<DisruptionSetting[]>([]);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [taps, setTaps] = useState(0);
    const [password, setPassword] = useState('');
    const [wrong, setWrong] = useState(false);

    useEffect(() => {
        let cancelled = false;

        void Promise.all([getDevice(), listSchedules()])
            .then(([result, schedules]) => {
                if (!cancelled) {
                    setDevice(result);
                    setSettings(
                        settingsForModes(schedules.map((schedule) => schedule.mode)),
                    );
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setErrorCode(ApiRequestError.from(error).code);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * Saved immediately rather than behind a Save button.
     *
     * A settings screen with one switch and a button invites leaving without
     * pressing it. The switch shows the previous value again if the write
     * fails, so the screen never claims something the server did not accept.
     */
    const setSetting = useCallback(
        (key: DisruptionSetting, value: boolean) => {
            if (device === null) {
                return;
            }
            const previous = device;
            setDevice({ ...device, [key]: value });
            setSaving(true);
            setErrorCode(null);

            void updateDevice(device.deviceId, { [key]: value })
                .then(setDevice)
                .catch((error: unknown) => {
                    setDevice(previous);
                    setErrorCode(ApiRequestError.from(error).code);
                })
                .finally(() => {
                    setSaving(false);
                });
        },
        [device],
    );

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
            // After the card has been laid out, otherwise there is nothing to
            // scroll to yet.
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
            <SafeAreaView style={styles.flex} edges={['bottom']}>
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
                    {errorCode !== null && (
                        <WarningBanner
                            title={t('settings.save_failed')}
                            message={apiErrorMessage(t, errorCode)}
                        />
                    )}

                    <ThemedText type="subtitle">{t('settings.disruptions')}</ThemedText>

                    <DisruptionSettings
                        settings={settings}
                        values={{
                            allowLaterWakeOnDelay: device?.allowLaterWakeOnDelay ?? false,
                            allowLaterWakeOnCancellation:
                                device?.allowLaterWakeOnCancellation ?? false,
                            allowEarlierWakeOnTraffic:
                                device?.allowEarlierWakeOnTraffic ?? false,
                        }}
                        onChange={setSetting}
                        disabled={device === null || saving}
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
                        <ThemedText type="small" themeColor="textSecondary" style={styles.version}>
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
    flex: {
        flex: 1,
    },
    content: {
        flexGrow: 1,
        padding: Spacing.medium,
        gap: Spacing.medium,
    },
    card: {
        borderWidth: 1,
        borderRadius: Radius.medium,
        padding: Spacing.medium,
        gap: Spacing.small,
    },
    // The version belongs at the bottom, where every phone puts it.
    versionRow: {
        marginTop: 'auto',
        paddingTop: Spacing.large,
    },
    version: {
        textAlign: 'center',
    },
});
