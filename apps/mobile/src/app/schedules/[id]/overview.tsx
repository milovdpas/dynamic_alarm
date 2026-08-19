import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { TransportMode } from '@alarm/types';

import { reminderLeadMinutes } from '@/alarm/reminders';
import type { WakePlan } from '@alarm/types';

import { armSchedule, planOptions, updateSchedule } from '@/api';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import JourneyOptions from '@/components/ui/JourneyOptions';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { useScheduleBundle } from '@/schedule/useScheduleBundle';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { ApiRequestError } from '@/utils/modules/Axios';
import { clock, relativeDay } from '@/utils/time';

/**
 * One schedule, as a summary you can read and four things you can change.
 *
 * A hub rather than one long form. Everything onboarding asks has to be
 * changeable afterwards, and putting all of it on a single screen meant an
 * address search, a keyboard, a routine list and a set of departures competing
 * for the same space. Accordions were the other option and hide the answer: you
 * would have to open four of them to see what your schedule says.
 *
 * The recalculate lives here, at the end, for the same reason it did before:
 * which departure to take is the last decision, and it can only be made once
 * everything above it has been settled.
 */
export default function ScheduleHubScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { id } = useLocalSearchParams<{ id: string }>();
    const border = useThemeColor({}, 'border');

    const { bundle, errorCode: loadError, reload } = useScheduleBundle(id);

    const [options, setOptions] = useState<WakePlan[] | null>(null);
    const [journeyOffset, setJourneyOffset] = useState<number | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [working, setWorking] = useState(false);

    const schedule = bundle?.schedule ?? null;

    /**
     * Plans the schedule as it now stands, so a departure can be chosen.
     *
     * The only thing on this screen that spends a provider call, which is why it
     * is a button. It is planned from what is saved rather than from a draft,
     * because every sub-screen has already committed its change by the time the
     * user is back here.
     */
    const recalculate = useCallback(async () => {
        if (bundle === null || bundle.origin === null || bundle.destination === null) {
            return;
        }

        setWorking(true);
        setErrorCode(null);
        try {
            const results = await planOptions({
                origin: { lat: bundle.origin.lat, lng: bundle.origin.lng },
                destination: { lat: bundle.destination.lat, lng: bundle.destination.lng },
                arrivalTime: bundle.schedule.arrivalTime.slice(0, 5),
                mode: bundle.schedule.mode,
                originAccess: bundle.schedule.originAccess,
                destinationAccess: bundle.schedule.destinationAccess,
                fixedTravelMinutes: bundle.schedule.fixedTravelMinutes ?? undefined,
                routineMinutes: routineMinutes(bundle.routine),
                buffers: bundle.schedule.buffers,
                timezone: bundle.schedule.timezone,
            });
            setOptions(results);
            setJourneyOffset(
                bundle.schedule.journeyOffset < results.length ? bundle.schedule.journeyOffset : 0,
            );
        } catch (error) {
            setErrorCode(ApiRequestError.from(error).code);
            setOptions(null);
        } finally {
            setWorking(false);
        }
    }, [bundle]);

    /**
     * Saves the chosen departure and arms the morning from it.
     *
     * Arming here rather than leaving it to the next launch: the point of the
     * whole screen is seeing the time change, and the server has already thrown
     * away whatever was armed from the previous answer.
     */
    const chooseDeparture = useCallback(async () => {
        if (schedule === null || journeyOffset === null) {
            return;
        }

        setWorking(true);
        try {
            await updateSchedule(schedule.id, { journeyOffset });
            await armSchedule(schedule.id).catch(() => undefined);
            setOptions(null);
            reload();
        } catch (error) {
            setErrorCode(ApiRequestError.from(error).code);
        } finally {
            setWorking(false);
        }
    }, [journeyOffset, reload, schedule]);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    {(loadError ?? errorCode) !== null && (
                        <WarningBanner
                            title={t('schedules.failed')}
                            message={apiErrorMessage(t, errorCode ?? loadError)}
                        />
                    )}

                    {bundle !== null && (
                        <>
                            {/*
                             * What is armed, first. Someone opening this screen
                             * is usually checking that, not editing.
                             */}
                            <View style={[styles.card, { borderColor: border }]}>
                                <ThemedText type="small" themeColor="textSecondary">
                                    {bundle.schedule.active
                                        ? t('schedules.armed_title')
                                        : t('schedules.paused')}
                                </ThemedText>
                                {bundle.occurrence === null ? (
                                    <ThemedText type="subtitle">
                                        {t('schedules.not_armed')}
                                    </ThemedText>
                                ) : (
                                    <>
                                        <ThemedText type="display">
                                            {clock(bundle.occurrence.currentWakeAt)}
                                        </ThemedText>
                                        <ThemedText type="small" themeColor="textSecondary">
                                            {relativeDay(t, bundle.occurrence.date)}
                                        </ThemedText>
                                    </>
                                )}
                            </View>

                            <Row
                                label={t('schedules.section_deadline')}
                                value={`${bundle.schedule.arrivalTime.slice(0, 5)} · ${days(
                                    t,
                                    bundle.schedule.daysOfWeek,
                                )}`}
                                borderColor={border}
                                onPress={() => {
                                    router.push({
                                        pathname: '/schedules/[id]/deadline',
                                        params: { id },
                                    });
                                }}
                            />

                            <Row
                                label={t('schedules.section_travel')}
                                value={travelSummary(t, bundle)}
                                borderColor={border}
                                onPress={() => {
                                    router.push({
                                        pathname: '/schedules/[id]/travel',
                                        params: { id },
                                    });
                                }}
                            />

                            <Row
                                label={t('schedules.section_routine')}
                                value={t('common.minutes_short', {
                                    count: routineMinutes(bundle.routine),
                                })}
                                borderColor={border}
                                onPress={() => {
                                    router.push({
                                        pathname: '/schedules/[id]/routine',
                                        params: { id },
                                    });
                                }}
                            />

                            {/*
                             * Last, and deliberately after the three above.
                             * Those are the stages that produce a wake time,
                             * counting back from the deadline; this is what
                             * happens once that time arrives.
                             */}
                            <Row
                                label={t('schedules.section_ringing')}
                                value={
                                    reminderLeadMinutes(bundle.schedule.reminders) === 0
                                        ? t('alarms.reminders_off')
                                        : t('schedules.rings_summary', {
                                              count: bundle.schedule.reminders.count,
                                          })
                                }
                                borderColor={border}
                                onPress={() => {
                                    router.push({
                                        pathname: '/schedules/[id]/ringing',
                                        params: { id },
                                    });
                                }}
                            />

                            <ActionButton
                                label={working ? t('schedule.working') : t('schedules.recalculate')}
                                disabled={working}
                                onPress={() => void recalculate()}
                            />

                            {options !== null && journeyOffset !== null && (
                                <>
                                    <JourneyOptions
                                        options={options}
                                        selected={journeyOffset}
                                        onSelect={setJourneyOffset}
                                        disabled={working}
                                    />
                                    <ActionButton
                                        label={t('schedules.use_this')}
                                        variant="primary"
                                        disabled={working}
                                        onPress={() => void chooseDeparture()}
                                    />
                                </>
                            )}
                        </>
                    )}
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

/** One thing you can change, with what it currently says. */
function Row({
    label,
    value,
    borderColor,
    onPress,
}: {
    label: string;
    value: string;
    borderColor: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            style={[styles.row, { borderColor }]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${value}`}
        >
            <View style={styles.grow}>
                <ThemedText type="small" themeColor="textSecondary">
                    {label}
                </ThemedText>
                <ThemedText>{value}</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
                {'>'}
            </ThemedText>
        </Pressable>
    );
}

function routineMinutes(
    routine: { steps: { minutes: number; enabled: boolean }[] } | null,
): number {
    return (routine?.steps ?? []).reduce((sum, step) => sum + (step.enabled ? step.minutes : 0), 0);
}

/** Where and how, in one line, which is all a summary row can hold. */
function travelSummary(
    t: (key: string) => string,
    bundle: {
        schedule: { mode: TransportMode };
        origin: { address?: string | null; label: string } | null;
        destination: { address?: string | null; label: string } | null;
    },
): string {
    const mode =
        bundle.schedule.mode === TransportMode.CAR
            ? t('travel.car')
            : bundle.schedule.mode === TransportMode.FIXED
              ? t('travel.fixed')
              : t('travel.public_transport');

    const from = bundle.origin?.address ?? bundle.origin?.label ?? '?';
    const to = bundle.destination?.address ?? bundle.destination?.label ?? '?';
    return `${mode} · ${from} → ${to}`;
}

function days(t: (key: string) => string, weekdays: number[]): string {
    return weekdays.map((day) => t(`schedule.day_short.${String(day)}`)).join(' ');
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.medium },
    card: {
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
        gap: Spacing.extraSmall,
    },
    row: {
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.small,
    },
    grow: { flex: 1, gap: 2 },
});
