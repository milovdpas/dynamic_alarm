import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { APP_CONSTANTS } from '@alarm/types';
import { moveAppToBackground } from '@modules/alarm-sound';

import { dismissAlarm, snoozeAlarm } from '@/alarm/alarmActions';
import {
    readDisruption,
    readRememberedDisruption,
    rememberDisruption,
} from '@/alarm/disruption';
import type { Disruption } from '@/alarm/disruption';
import { listOccurrences } from '@/api';
import { Color, FontSize, Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';

/**
 * The alarm screen.
 *
 * Shown over the lock screen by the native service's full-screen intent. It
 * deliberately does **not** start or stop audio itself: the foreground service
 * owns the sound, the wake lock and the notification, so the alarm rings whether
 * or not this screen ever appears. That separation is what makes the alarm work
 * with the app killed.
 *
 * Colours are fixed rather than themed on purpose: this is looked at in a dark
 * bedroom by someone half awake, and it should never flash white.
 */
export default function RingScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const params = useLocalSearchParams<{ alarmId?: string; takeover?: string }>();

    // The alarm interrupted the lock screen rather than being opened by hand.
    const isTakeover = params.takeover === 'true';

    const [now, setNow] = useState(() => new Date());
    const [actionError, setActionError] = useState<string | null>(null);

    /**
     * Whether the journey behind this alarm is disrupted.
     *
     * Shown whatever the disruption settings say. Those decide whether the alarm
     * is allowed to *move*; they were never meant to decide whether someone is
     * told their train is cancelled. Waking at the usual time not knowing the
     * 07:52 is gone is the worst version of this app.
     */
    const [disruption, setDisruption] = useState<Disruption | null>(null);

    // The scheduler names its alarms after the occurrence they belong to.
    const occurrenceId = params.alarmId?.startsWith('occurrence-')
        ? params.alarmId.slice('occurrence-'.length)
        : null;

    useEffect(() => {
        if (occurrenceId === null) {
            return;
        }
        let cancelled = false;

        // What the app last knew, read from the device. No request, so it is on
        // screen immediately and it works in flight mode, in a tunnel, and
        // before the radio has woken up.
        void readRememberedDisruption(occurrenceId).then((stored) => {
            if (!cancelled && stored !== null) {
                setDisruption(stored);
            }
        });

        // Then the current answer, if the network happens to be there. This is
        // the path that catches a delay nobody pushed, which is exactly what
        // happens when moving the alarm is switched off. Failing is fine and
        // silent: the stored note is already up.
        void listOccurrences()
            .then(async (occurrences) => {
                const occurrence = occurrences.find((each) => each.id === occurrenceId);
                if (occurrence === undefined || cancelled) {
                    return;
                }
                const current = readDisruption(occurrence);
                setDisruption(current);
                await rememberDisruption(occurrenceId, current);
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [occurrenceId]);

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    /**
     * Hands the phone back the way the alarm found it.
     *
     * When the alarm took over the screen the user was on their lock screen a
     * moment ago and never asked to open this app, so dropping them on our home
     * screen makes it feel like the app hijacked the phone. Leaving the route and
     * backgrounding the task reveals the lock screen underneath.
     *
     * `replace` rather than `back`: on-device testing showed the screen staying
     * put after Dismiss, and `back()` depends on a history stack whose shape
     * varies with how the alarm opened the app (cold start, notification tap, or
     * already running). `replace` leaves this route whatever the history is.
     */
    const leaveRingScreen = useCallback(async () => {
        router.replace('/(tabs)');
        if (isTakeover) {
            await moveAppToBackground();
        }
    }, [isTakeover, router]);

    /**
     * Each step is isolated, because they are independent obligations.
     *
     * Previously one `await` chain meant a throw anywhere left the user stranded
     * on a screen with no way out. Silencing the alarm and leaving the screen
     * must not be able to break each other, and a failure has to be visible
     * rather than swallowed by an unawaited promise.
     */
    const runAlarmAction = useCallback(
        async (act: (alarmId: string | undefined) => Promise<void>) => {
            try {
                await act(params.alarmId);
            } catch (error) {
                setActionError(error instanceof Error ? error.message : String(error));
            }
            try {
                await leaveRingScreen();
            } catch (error) {
                setActionError(error instanceof Error ? error.message : String(error));
            }
        },
        [params.alarmId, leaveRingScreen],
    );

    const dismiss = useCallback(() => void runAlarmAction(dismissAlarm), [runAlarmAction]);
    const snooze = useCallback(() => void runAlarmAction(snoozeAlarm), [runAlarmAction]);

    return (
        <View style={styles.container}>
            <ThemedText type="small" style={styles.label}>
                {t('alarm.ringing_title')}
            </ThemedText>

            <ThemedText type="display" style={styles.clock}>
                {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </ThemedText>

            {/*
             * Above the buttons, because it is the reason to read this screen
             * rather than reach for the phone and dismiss it by reflex.
             */}
            {disruption !== null && (
                <View style={styles.disruption}>
                    <ThemedText style={styles.disruptionText}>
                        {disruption.kind === 'CANCELLATION'
                            ? t('ring.cancelled', {
                                  service: disruption.service ?? t('ring.your_train'),
                              })
                            : t('ring.delayed', {
                                  service: disruption.service ?? t('ring.your_train'),
                                  minutes: disruption.minutes,
                              })}
                    </ThemedText>
                    {disruption.simulated && (
                        <ThemedText type="small" style={styles.disruptionText}>
                            {t('ring.simulated')}
                        </ThemedText>
                    )}
                </View>
            )}

            {actionError !== null && (
                <ThemedText type="small" style={styles.error}>
                    {actionError}
                </ThemedText>
            )}

            <View style={styles.actions}>
                {APP_CONSTANTS.ALARM.SNOOZE_ENABLED && (
                    <Pressable style={styles.snooze} onPress={snooze} accessibilityRole="button">
                        <ThemedText style={styles.snoozeText}>
                            {t('common.snooze_minutes', {
                                count: APP_CONSTANTS.ALARM.SNOOZE_MINUTES,
                            })}
                        </ThemedText>
                    </Pressable>
                )}

                <Pressable style={styles.dismiss} onPress={dismiss} accessibilityRole="button">
                    <ThemedText style={styles.dismissText}>{t('common.dismiss')}</ThemedText>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Color.night,
        padding: Spacing.large,
        gap: Spacing.large,
    },
    label: {
        color: '#8FA0C0',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    clock: {
        color: Color.white,
    },
    error: {
        color: '#FF8A8A',
        textAlign: 'center',
    },
    disruption: {
        // Amber rather than red: something has changed and needs reading, but
        // the alarm itself is working exactly as intended.
        borderColor: '#F0A85C',
        borderWidth: 1,
        borderRadius: Radius.small,
        paddingVertical: Spacing.small,
        paddingHorizontal: Spacing.medium,
        gap: Spacing.extraSmall,
        alignItems: 'center',
    },
    disruptionText: {
        color: '#F0A85C',
        textAlign: 'center',
    },
    actions: {
        marginTop: Spacing.extraLarge,
        gap: Spacing.medium,
        alignItems: 'center',
    },
    snooze: {
        paddingHorizontal: Spacing.large,
        paddingVertical: Spacing.small,
        borderRadius: Radius.pill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#8FA0C0',
    },
    snoozeText: {
        color: '#8FA0C0',
        fontSize: FontSize.small,
    },
    dismiss: {
        paddingHorizontal: Spacing.extraLarge,
        paddingVertical: Spacing.medium,
        borderRadius: Radius.pill,
        backgroundColor: Color.white,
    },
    dismissText: {
        color: Color.night,
        fontSize: FontSize.medium,
    },
});
