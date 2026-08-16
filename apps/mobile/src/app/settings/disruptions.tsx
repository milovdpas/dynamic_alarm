import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { DeviceResponse } from '@alarm/types';

import { getDevice, listSchedules, updateDevice } from '@/api';
import { Spacing } from '@/assets/Stylesheet';
import DisruptionSettings, { settingsForModes } from '@/components/settings/DisruptionSettings';
import type { DisruptionSetting } from '@/components/settings/DisruptionSettings';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { ApiRequestError } from '@/utils/modules/Axios';

/**
 * Whether the alarm is allowed to move itself, and in which direction.
 *
 * Its own screen because it is the most consequential setting in the app and the
 * one that most needs explaining: every switch here decides whether somebody is
 * woken at a different time than they went to sleep expecting. A row in a list
 * has no room for that; a screen does.
 *
 * Read from the server rather than kept locally, because the monitor is what
 * acts on them. A local mirror could disagree with the values actually in force
 * overnight and nothing on screen would say which was real.
 */
export default function DisruptionsScreen() {
    const { t } = useTranslation();

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

    useEffect(() => {
        let cancelled = false;

        void Promise.all([getDevice(), listSchedules()])
            .then(([result, schedules]) => {
                if (!cancelled) {
                    setDevice(result);
                    setSettings(settingsForModes(schedules.map((schedule) => schedule.mode)));
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
     * A screen of switches and a button invites leaving without pressing it. The
     * switch returns to its previous value if the write fails, so it never
     * claims something the server did not accept.
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

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    {errorCode !== null && (
                        <WarningBanner
                            title={t('settings.save_failed')}
                            message={apiErrorMessage(t, errorCode)}
                        />
                    )}

                    {settings.length === 0 ? (
                        <ThemedText themeColor="textSecondary">
                            {t('settings.disruptions_empty')}
                        </ThemedText>
                    ) : (
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
                    )}
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.medium },
});
