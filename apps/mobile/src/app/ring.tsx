import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { APP_CONSTANTS } from '@alarm/types';
import { moveAppToBackground, setShowWhenLocked } from '@modules/alarm-sound';

import { dismissAlarm, snoozeAlarm } from '@/alarm/alarmActions';
import {
    generateChallenge,
    isCorrect,
    readLockSetting,
    type Challenge,
} from '@/alarm/alarmLock';
import {
    readDisruption,
    readRememberedDisruption,
    rememberDisruption,
} from '@/alarm/disruption';
import type { Disruption } from '@/alarm/disruption';
import { listOccurrences } from '@/api';
import { clock } from '@/utils/time';
import { FontSize, Night, Radius, Spacing } from '@/assets/Stylesheet';
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
    const params = useLocalSearchParams<{
        alarmId?: string;
        takeover?: string;
        preview?: string;
    }>();

    // The alarm interrupted the lock screen rather than being opened by hand.
    const isTakeover = params.takeover === 'true';

    /**
     * A rehearsal, opened from the debug panel.
     *
     * This screen is the hardest thing in the app to look at on purpose: it
     * appears over a lock screen, at an hour nobody chooses, in states that
     * depend on a train being cancelled. Waiting for a real 06:00 to find out
     * that a cancellation pushes the buttons off the bottom of the screen is a
     * bad way to work.
     *
     * A preview shows the same component with an invented disruption. It touches
     * no alarm and stops no service, because there is nothing ringing: leaving
     * the screen is all that Dismiss can honestly do here.
     */
    const preview = params.preview ?? null;

    const [now, setNow] = useState(() => new Date());
    /**
     * An i18n key, never a message.
     *
     * An exception's text is written for whoever debugs it and is English
     * wherever it comes from, which will not do on the one screen a user cannot
     * navigate away from. The raw text goes to the log; the sentence comes from
     * translations like every other string in the app.
     */
    const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);

    /**
     * The puzzle standing between this alarm and being switched off.
     *
     * Generated once, when the screen appears, rather than per attempt. A new
     * sum on every wrong answer would punish somebody for having nearly got it,
     * which is the opposite of what this is for.
     */
    const [challenge, setChallenge] = useState<Challenge | null>(null);
    const [attempt, setAttempt] = useState('');
    const [wrong, setWrong] = useState(false);

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
        let cancelled = false;

        if (preview !== null) {
            // Deferred a tick, like every other state update in this file, so
            // nothing is set inside the render pass that scheduled the effect.
            const state = previewDisruption(preview);
            void Promise.resolve().then(() => {
                if (!cancelled) {
                    setDisruption(state);
                }
            });
            return () => {
                cancelled = true;
            };
        }
        if (occurrenceId === null) {
            return undefined;
        }

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
    }, [occurrenceId, preview]);

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    /*
     * Covering the lock screen is this screen's privilege and nobody else's.
     *
     * MainActivity turns it on from the launch intent, which is what makes the
     * alarm visible before the first frame when the process was dead. Turning it
     * off here is the other half: an activity that keeps the permission shows
     * the app instead of the lock screen the next time the phone is locked, so
     * a locked phone would read out somebody's schedule to anyone holding it.
     */
    useEffect(() => {
        void setShowWhenLocked(true);
        return () => {
            void setShowWhenLocked(false);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        void readLockSetting().then((setting) => {
            if (!cancelled) {
                setChallenge(generateChallenge(setting));
            }
        });
        return () => {
            cancelled = true;
        };
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
     * Silences the alarm, and leaves only if that worked.
     *
     * The order matters and so does the dependency between the two steps. Leaving
     * regardless would replace the route and background the app, which renders any
     * explanation onto a screen nobody is looking at, while the alarm carries on
     * sounding. So a failure stays put: this screen is the only thing left that
     * can say what happened, the alarm keeps ringing underneath it because the
     * sound belongs to the native service, and trying again is a second press.
     */
    const runAlarmAction = useCallback(
        async (act: (alarmId: string | undefined) => Promise<void>) => {
            // Cleared first, so a second attempt that works is not still
            // apologising for the first.
            setActionErrorKey(null);

            try {
                await act(params.alarmId);
            } catch (error) {
                // English, for whoever debugs it. The user reads the key.
                console.warn('Alarm action failed:', error);
                setActionErrorKey('ring.stop_failed');
                return;
            }

            try {
                await leaveRingScreen();
            } catch (error) {
                console.warn('Leaving the ring screen failed:', error);
                // The alarm is off, so this is the smaller problem: the screen
                // would not close and the way out is the phone's own button.
                setActionErrorKey('ring.leave_failed');
            }
        },
        [params.alarmId, leaveRingScreen],
    );

    /**
     * Dismisses, or refuses and says so.
     *
     * Refusing costs nothing but time: no lockout, no penalty, no harder sum
     * next go. The alarm is still ringing, which is the entire pressure, and it
     * keeps ringing regardless of what happens here because the sound belongs to
     * the native service rather than to this screen.
     */
    const dismiss = useCallback(() => {
        if (challenge !== null && !isCorrect(challenge, attempt)) {
            setWrong(true);
            return;
        }
        if (preview !== null) {
            // Nothing is ringing, so there is nothing to stop. Asking the native
            // service to stop an alarm that does not exist would be a lie the
            // logs would carry.
            router.back();
            return;
        }
        void runAlarmAction(dismissAlarm);
    }, [attempt, challenge, preview, router, runAlarmAction]);
    const snooze = useCallback(() => void runAlarmAction(snoozeAlarm), [runAlarmAction]);

    return (
        /*
         * The input is focused the moment this screen appears, so the keyboard
         * comes up over a screen whose actions sit at the bottom. Android no
         * longer resizes the window under edge-to-edge, which is why this is
         * needed on both platforms rather than being an iOS habit.
         */
        <KeyboardAvoidingView style={styles.container} behavior="padding">
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
                        {disruption.kind === 'NO_REPLACEMENT'
                            ? t('ring.no_replacement')
                            : disruption.kind === 'CANCELLATION'
                              ? t('ring.cancelled', {
                                    service: disruption.service ?? t('ring.your_journey'),
                                })
                              : t('ring.delayed', {
                                    service: disruption.service ?? t('ring.your_journey'),
                                    minutes: disruption.minutes,
                                })}
                    </ThemedText>
                    {/*
                     * Which train to catch instead, and only when the alarm was
                     * actually allowed to move for it. With that switch off the
                     * wake time has not changed, so naming a replacement would
                     * be describing a journey nobody has been woken for.
                     */}
                    {disruption.replacement != null && (
                        <ThemedText style={styles.replacement}>
                            {t('ring.take_instead', {
                                time: clock(disruption.replacement.departureAt),
                                service:
                                    disruption.replacement.service ?? t('ring.the_next_service'),
                                from: disruption.replacement.fromName,
                            })}
                        </ThemedText>
                    )}

                    {disruption.simulated && (
                        <ThemedText type="small" style={styles.disruptionText}>
                            {t('ring.simulated')}
                        </ThemedText>
                    )}
                </View>
            )}

            {actionErrorKey !== null && (
                <ThemedText type="small" style={styles.error}>
                    {t(actionErrorKey)}
                </ThemedText>
            )}

            {/*
             * The puzzle sits directly above the button it guards, so the order
             * on screen matches the order of the actions: read this, then that.
             *
             * Its own colours like everything else here, because this screen is
             * pinned dark and read in a dark room. A themed input would be the
             * one white rectangle at 06:00.
             */}
            {challenge !== null && (
                <View style={styles.challenge}>
                    <ThemedText type="small" style={styles.label}>
                        {t(challenge.kind === 'MATHS' ? 'lock.solve' : 'lock.type_code')}
                    </ThemedText>
                    <ThemedText type="display" style={styles.prompt}>
                        {challenge.prompt}
                    </ThemedText>
                    <TextInput
                        value={attempt}
                        onChangeText={(value) => {
                            setAttempt(value);
                            setWrong(false);
                        }}
                        // A number pad for a sum, letters for a code. The wrong
                        // keyboard is a puzzle about the keyboard.
                        keyboardType={challenge.kind === 'MATHS' ? 'number-pad' : 'default'}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        autoFocus
                        style={[styles.input, wrong && styles.inputWrong]}
                        placeholder={t('lock.answer')}
                        placeholderTextColor={Night.hint}
                        // Enter submits, so a correct answer needs one gesture
                        // rather than a reach for a button in the dark.
                        onSubmitEditing={dismiss}
                        returnKeyType="done"
                    />
                    {wrong && (
                        <ThemedText type="small" style={styles.error}>
                            {t('lock.wrong')}
                        </ThemedText>
                    )}
                </View>
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
        </KeyboardAvoidingView>
    );
}

/**
 * The disruption a preview pretends to have found.
 *
 * Built here rather than in the debug panel so the states live next to the
 * screen that renders them: adding one to the panel and forgetting to handle it
 * would produce a preview of nothing at all.
 */
function previewDisruption(kind: string): Disruption | null {
    switch (kind) {
        case 'DELAY':
            return { kind: 'DELAY', minutes: 14, service: 'Intercity 3052', simulated: false };
        case 'CANCELLATION':
            // Moving the alarm switched off: the train is gone and the wake time
            // has not changed, so there is nothing else to name.
            return {
                kind: 'CANCELLATION',
                minutes: 0,
                service: 'Sprinter 4428',
                simulated: false,
                replacement: null,
            };
        case 'CANCELLATION_REPLACED':
            // Moving switched on: the same cancellation, plus the train that was
            // chosen instead and the time the alarm was moved for.
            return {
                kind: 'CANCELLATION',
                minutes: 0,
                service: 'Sprinter 4428',
                simulated: false,
                replacement: {
                    service: 'Intercity 3052',
                    departureAt: '2026-08-18T05:12:00.000Z',
                    fromName: 'Utrecht Centraal',
                },
            };
        case 'NO_REPLACEMENT':
            return { kind: 'NO_REPLACEMENT', minutes: 0, service: null, simulated: false };
        case 'SIMULATED':
            return { kind: 'DELAY', minutes: 20, service: 'Intercity 3052', simulated: true };
        default:
            // A plain morning, which is the state everybody actually sees and
            // the easiest one to forget to look at.
            return null;
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Night.background,
        padding: Spacing.large,
        gap: Spacing.large,
    },
    label: {
        color: Night.muted,
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    clock: {
        color: Night.text,
    },
    error: {
        color: Night.danger,
        textAlign: 'center',
    },
    disruption: {
        // Amber rather than red: something has changed and needs reading, but
        // the alarm itself is working exactly as intended.
        borderColor: Night.warning,
        borderWidth: 1,
        borderRadius: Radius.small,
        paddingVertical: Spacing.small,
        paddingHorizontal: Spacing.medium,
        gap: Spacing.extraSmall,
        alignItems: 'center',
    },
    disruptionText: {
        color: Night.warning,
        textAlign: 'center',
    },
    // Brighter than the warning it sits under: the cancellation is the news,
    // this is the instruction, and the instruction is what somebody half awake
    // needs to leave the screen with.
    replacement: {
        color: Night.text,
        textAlign: 'center',
    },
    challenge: {
        alignItems: 'center',
        gap: Spacing.small,
    },
    prompt: {
        color: Night.text,
        letterSpacing: 2,
    },
    input: {
        minWidth: 200,
        borderWidth: 1,
        borderColor: Night.muted,
        borderRadius: Radius.small,
        paddingVertical: Spacing.small,
        paddingHorizontal: Spacing.medium,
        color: Night.text,
        fontSize: FontSize.medium,
        textAlign: 'center',
    },
    inputWrong: {
        borderColor: Night.danger,
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
        borderColor: Night.muted,
    },
    snoozeText: {
        color: Night.muted,
        fontSize: FontSize.small,
    },
    dismiss: {
        paddingHorizontal: Spacing.extraLarge,
        paddingVertical: Spacing.medium,
        borderRadius: Radius.pill,
        backgroundColor: Night.text,
    },
    dismissText: {
        color: Night.background,
        fontSize: FontSize.medium,
    },
});
