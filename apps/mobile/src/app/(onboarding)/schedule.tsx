import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { DateTime } from 'luxon';
import { APP_CONSTANTS, DEFAULT_BUFFERS, Weekday } from '@alarm/types';
import type { WakePlan } from '@alarm/types';

import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { planOptions } from '@/api';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import DetailRow from '@/components/ui/DetailRow';
import TimeField from '@/components/ui/TimeField';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { useOnboarding } from '@/utils/contexts/OnboardingContext';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { ApiRequestError } from '@/utils/modules/Axios';

const ALL_DAYS = [
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
    Weekday.SATURDAY,
    Weekday.SUNDAY,
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The deadline, the days, and the first real answer the app gives.
 *
 * The preview is the point of the whole flow. It runs the same engine the
 * monitor will, against live NS and TomTom data, so what is shown here is the
 * actual commute rather than an illustration.
 */
export default function ScheduleStep() {
    const { t } = useTranslation();
    const router = useRouter();
    const { draft, update, routineMinutes } = useOnboarding();

    const border = useThemeColor({}, 'border');
    const selectedBackground = useThemeColor({}, 'backgroundSelected');
    const primary = useThemeColor({}, 'primary');

    const [options, setOptions] = useState<WakePlan[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [errorCode, setErrorCode] = useState<string | null>(null);

    const timeValid = TIME_PATTERN.test(draft.arrivalTime);
    const ready = timeValid && draft.daysOfWeek.length > 0;

    const toggleDay = (day: Weekday) => {
        const has = draft.daysOfWeek.includes(day);
        update({
            daysOfWeek: has
                ? draft.daysOfWeek.filter((each) => each !== day)
                : [...draft.daysOfWeek, day].sort((a, b) => a - b),
        });
    };

    const preview = () => {
        if (draft.home === null || draft.work === null) {
            return;
        }
        setBusy(true);
        setErrorCode(null);

        void planOptions({
            origin: { lat: draft.home.lat, lng: draft.home.lng },
            destination: { lat: draft.work.lat, lng: draft.work.lng },
            arrivalTime: draft.arrivalTime,
            mode: draft.mode,
            originAccess: draft.originAccess,
            destinationAccess: draft.destinationAccess,
            routineMinutes,
            buffers: DEFAULT_BUFFERS,
            timezone: APP_CONSTANTS.TIMEZONE,
        })
            .then((results) => {
                setOptions(results);
                // The engine's own choice, which is the most sleep, so the
                // screen opens on the answer someone who has no preference
                // would want anyway.
                update({ journeyOffset: 0 });
            })
            .catch((error: unknown) => {
                setErrorCode(ApiRequestError.from(error).code);
                setOptions(null);
            })
            .finally(() => {
                setBusy(false);
            });
    };

    // Nothing is saved yet. The last step asks whether the alarm may move once
    // things go wrong, and commits everything together.
    const next = () => {
        router.push('/(onboarding)/adjustments');
    };

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    <ThemedText type="subtitle">{t('onboarding.schedule_intro')}</ThemedText>

                    <TimeField
                        label={t('schedule.arrival_time')}
                        value={draft.arrivalTime}
                        onChange={(arrivalTime) => {
                            update({ arrivalTime });
                            // The options below were computed for the old
                            // deadline, so they are now wrong. Clearing them is
                            // more honest than leaving stale times on screen.
                            setOptions(null);
                        }}
                        error={timeValid ? undefined : t('schedule.arrival_time_invalid')}
                    />

                    <View style={styles.days}>
                        {ALL_DAYS.map((day) => {
                            const on = draft.daysOfWeek.includes(day);
                            return (
                                <Pressable
                                    key={day}
                                    onPress={() => {
                                        toggleDay(day);
                                    }}
                                    style={[
                                        styles.day,
                                        { borderColor: border },
                                        on && { backgroundColor: selectedBackground },
                                    ]}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked: on }}
                                >
                                    <ThemedText
                                        type="smallBold"
                                        themeColor={on ? 'text' : 'textSecondary'}
                                    >
                                        {t(`schedule.day_short.${String(day)}`)}
                                    </ThemedText>
                                </Pressable>
                            );
                        })}
                    </View>

                    <ActionButton
                        label={busy ? t('schedule.working') : t('schedule.preview')}
                        onPress={preview}
                        disabled={!ready || busy}
                    />

                    {errorCode !== null && (
                        <WarningBanner
                            title={t('schedule.preview_failed')}
                            message={apiErrorMessage(t, errorCode)}
                        />
                    )}

                    {options !== null && (
                        <View style={styles.options}>
                            <ThemedText type="subtitle">{t('schedule.options_title')}</ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                                {t('schedule.options_help')}
                            </ThemedText>

                            {options.map((option, index) => {
                                const chosen = index === draft.journeyOffset;
                                return (
                                    <Pressable
                                        key={option.journey?.id ?? String(index)}
                                        onPress={() => {
                                            update({ journeyOffset: index });
                                        }}
                                        style={[
                                            styles.option,
                                            { borderColor: chosen ? primary : border },
                                            chosen && { backgroundColor: selectedBackground },
                                        ]}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected: chosen }}
                                    >
                                        <View style={styles.optionHeader}>
                                            <ThemedText type="small" themeColor="textSecondary">
                                                {t('common.wake_up')}
                                            </ThemedText>
                                            <ThemedText
                                                type="subtitle"
                                                themeColor={chosen ? 'primary' : 'text'}
                                            >
                                                {clock(option.wakeUpAt)}
                                            </ThemedText>
                                        </View>

                                        <DetailRow
                                            label={t('common.leave_home')}
                                            value={clock(option.departHomeAt)}
                                        />
                                        {option.journey !== null && (
                                            <DetailRow
                                                label={t('schedule.arrives')}
                                                value={clock(option.journey.arrivalAt)}
                                            />
                                        )}
                                        <DetailRow
                                            label={t('plan.travel')}
                                            value={t('common.minutes_short', {
                                                count: option.breakdown.travelMinutes,
                                            })}
                                        />
                                        {option.journey !== null && (
                                            <DetailRow
                                                label={t('schedule.changes')}
                                                value={
                                                    option.journey.transferCount === 0
                                                        ? t('schedule.direct')
                                                        : String(option.journey.transferCount)
                                                }
                                            />
                                        )}

                                        {!option.feasible && (
                                            <WarningBanner
                                                title={t('plan.infeasible', {
                                                    minutes: option.shortfallMinutes ?? 0,
                                                })}
                                                message={t('schedule.infeasible_help')}
                                            />
                                        )}
                                    </Pressable>
                                );
                            })}

                            <ActionButton
                                label={t('common.next')}
                                variant="primary"
                                onPress={next}
                                disabled={busy}
                            />
                        </View>
                    )}

                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

/** Local wall-clock time, which is the only form of an instant a user reads. */
function clock(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true })
        .setZone(APP_CONSTANTS.TIMEZONE)
        .toFormat('HH:mm');
}


const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },
    content: {
        padding: Spacing.medium,
        gap: Spacing.medium,
    },
    days: {
        flexDirection: 'row',
        gap: Spacing.extraSmall,
    },
    day: {
        flex: 1,
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: Radius.small,
        paddingVertical: Spacing.small,
    },
    options: {
        gap: Spacing.small,
    },
    option: {
        borderWidth: 1,
        borderRadius: Radius.medium,
        padding: Spacing.medium,
        gap: Spacing.extraSmall,
    },
    optionHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
});
