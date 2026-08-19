import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useRouter } from 'expo-router';
import { DateTime } from 'luxon';
import { DEFAULT_REMINDERS, OccurrenceState } from '@alarm/types';
import type { OccurrenceResponse, Schedule } from '@alarm/types';

import {
    deleteSchedule,
    listOccurrences,
    listSchedules,
    skipOccurrence,
    unskipOccurrence,
    updateSchedule,
} from '@/api';
import {
    deleteStandaloneAlarm,
    listStandaloneAlarms,
    ringTimes,
    saveStandaloneAlarm,
    syncStandaloneAlarms,
    type StandaloneAlarm,
} from '@/alarm/standaloneAlarms';
import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import AlarmRow from '@/components/alarms/AlarmRow';
import StandaloneAlarmEditor from '@/components/alarms/StandaloneAlarmEditor';
import StaleNotice from '@/components/ui/StaleNotice';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { useApiQuery } from '@/utils/hooks/useApiQuery';
import { clock, relativeDay } from '@/utils/time';
import { ApiRequestError } from '@/utils/modules/Axios';

/**
 * Every alarm this phone will ring, in one list.
 *
 * This replaced a Schedules tab, and the replacement is the point: that tab
 * listed the things that *produce* alarms, which meant the answer to "what is
 * set for tomorrow" was assembled by the reader out of a schedule, whether it
 * was active, and whichever morning it had armed. The phone's own Clock app
 * answers that question in one screen, and so should this.
 *
 * Two kinds of row, one shape. A schedule row is worked out from a live journey
 * and can only be edited on its own screens; a hand-set alarm is four fields
 * edited in place. Both are a time, a repeat, and a switch.
 *
 * **What the switch means.** The standing alarm, on or off: pausing a schedule,
 * or disabling a one-off. Skipping a single morning is a separate control inside
 * the expanded row, because it expires by itself and no switch can say that, and
 * because a switch meaning "off for good" on one row and "off for tomorrow" on
 * the next is a switch nobody can predict.
 */
export default function AlarmsScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const [busy, setBusy] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    /*
     * Kept apart from the query's own error, because the two deserve opposite
     * treatment. A read that failed while a list is on screen is a footnote: the
     * list is still true as of when it was fetched. A write that failed is always
     * loud, because somebody asked for something and it did not happen.
     */
    const [writeError, setWriteError] = useState<string | null>(null);
    const [standalone, setStandalone] = useState<StandaloneAlarm[]>([]);

    /*
     * The two server reads share one query, because a schedule is only
     * meaningful beside the morning it has armed. Two queries would let the
     * screen render half of yesterday next to half of today.
     */
    const fetchBoth = useCallback(async () => {
        const [schedules, armed] = await Promise.all([listSchedules(), listOccurrences()]);
        return { schedules, armed };
    }, []);

    const { data, loading, cachedAt, error, refresh } = useApiQuery(
        'schedules+occurrences',
        fetchBoth,
    );
    const schedules = data?.schedules ?? null;
    const armed = data?.armed ?? [];

    /*
     * The hand-set alarms are read from storage rather than from the query,
     * because they never came from the server. Reconciling the OS alarms happens
     * on the same pass: this screen is the most likely thing to be open when
     * somebody changes one, and the reconciliation is what keeps a week of
     * future rings topped up.
     */
    const reloadStandalone = useCallback(async () => {
        setStandalone(await listStandaloneAlarms());
        await syncStandaloneAlarms().catch(() => 0);
    }, []);

    useFocusEffect(
        useCallback(() => {
            refresh();
            void reloadStandalone();
        }, [refresh, reloadStandalone]),
    );

    /** Runs a write, keeps the screen honest about it, and reloads. */
    const write = useCallback(
        async (action: () => Promise<unknown>, after: () => Promise<void> | void) => {
            setBusy(true);
            setWriteError(null);
            try {
                await action();
                await after();
            } catch (error) {
                setWriteError(ApiRequestError.from(error).code);
            } finally {
                setBusy(false);
            }
        },
        [],
    );

    const togglePaused = useCallback(
        (schedule: Schedule) => {
            void write(
                () => updateSchedule(schedule.id, { active: !schedule.active }),
                () => {
                    refresh();
                },
            );
        },
        [refresh, write],
    );

    const toggleSkipped = useCallback(
        (occurrence: OccurrenceResponse) => {
            void write(
                () =>
                    occurrence.state === OccurrenceState.SKIPPED
                        ? unskipOccurrence(occurrence.id)
                        : skipOccurrence(occurrence.id),
                () => {
                    refresh();
                },
            );
        },
        [refresh, write],
    );

    const confirmDelete = useCallback(
        (schedule: Schedule) => {
            // Destructive and not obviously reversible, so it asks. The armed
            // occurrence goes with it, which is the part someone would not
            // expect from a row that only says a name.
            Alert.alert(t('schedules.delete_title'), t('schedules.delete_body'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('schedules.delete_confirm'),
                    style: 'destructive',
                    onPress: () => {
                        void write(
                            () => deleteSchedule(schedule.id),
                            () => {
                                refresh();
                            },
                        );
                    },
                },
            ]);
        },
        [refresh, t, write],
    );

    const saveStandalone = useCallback(
        (alarm: StandaloneAlarm) => {
            void write(
                () => saveStandaloneAlarm(alarm),
                () => reloadStandalone(),
            );
        },
        [reloadStandalone, write],
    );

    const removeStandalone = useCallback(
        (alarm: StandaloneAlarm) => {
            Alert.alert(t('alarms.delete_title'), t('alarms.delete_body'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('alarms.delete'),
                    style: 'destructive',
                    onPress: () => {
                        void write(
                            () => deleteStandaloneAlarm(alarm.id),
                            () => reloadStandalone(),
                        );
                    },
                },
            ]);
        },
        [reloadStandalone, t, write],
    );

    const addStandalone = useCallback(() => {
        const alarm: StandaloneAlarm = {
            // Time-based rather than random, because nothing here needs to be
            // unguessable and a sortable id makes a stored list readable when
            // somebody is looking at it in a bug report.
            id: `s${String(Date.now())}`,
            label: '',
            time: '07:00',
            days: [],
            enabled: true,
            soundUri: null,
            reminders: DEFAULT_REMINDERS,
        };
        setExpanded(alarm.id);
        void write(
            () => saveStandaloneAlarm(alarm),
            () => reloadStandalone(),
        );
    }, [reloadStandalone, write]);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    <ThemedText type="title">{t('tabs.alarms')}</ThemedText>

                    <StaleNotice cachedAt={cachedAt} />

                    {loading && <ActivityIndicator />}

                    {/*
                     * Only when there is nothing to show. A failed refresh over a
                     * list somebody can already read is not worth an error
                     * banner: StaleNotice says it could not be checked, and the
                     * list is still the truth as of then.
                     */}
                    {error !== null && schedules === null && (
                        <WarningBanner
                            title={t('schedules.failed')}
                            message={apiErrorMessage(t, error)}
                        />
                    )}

                    {writeError !== null && (
                        <WarningBanner
                            title={t('schedules.failed')}
                            message={apiErrorMessage(t, writeError)}
                        />
                    )}

                    {schedules !== null && schedules.length === 0 && standalone.length === 0 && (
                        <ThemedText themeColor="textSecondary">{t('alarms.empty')}</ThemedText>
                    )}

                    {schedules?.map((schedule) => {
                        const occurrence = armed.find(
                            (each) => each.scheduleId === schedule.id,
                        );
                        const skipped = occurrence?.state === OccurrenceState.SKIPPED;

                        return (
                            <AlarmRow
                                key={schedule.id}
                                time={
                                    occurrence === undefined
                                        ? t('alarms.no_time')
                                        : clock(occurrence.currentWakeAt)
                                }
                                title={schedule.name}
                                subtitle={
                                    occurrence === undefined
                                        ? days(t, schedule.daysOfWeek)
                                        : relativeDay(t, occurrence.date)
                                }
                                note={
                                    !schedule.active
                                        ? t('alarms.paused')
                                        : skipped
                                          ? t('alarms.skipped')
                                          : occurrence === undefined
                                            ? t('schedules.not_armed')
                                            : null
                                }
                                enabled={schedule.active}
                                muted={skipped || !schedule.active}
                                busy={busy}
                                expanded={expanded === schedule.id}
                                onToggle={() => {
                                    togglePaused(schedule);
                                }}
                                onExpand={() => {
                                    setExpanded((current) =>
                                        current === schedule.id ? null : schedule.id,
                                    );
                                }}
                            >
                                <ThemedText type="small" themeColor="textSecondary">
                                    {days(t, schedule.daysOfWeek)}
                                </ThemedText>

                                <View style={styles.actions}>
                                    {/*
                                     * Only when there is a morning to skip. The
                                     * button is about one occurrence, so without
                                     * one it would have nothing to act on.
                                     */}
                                    {occurrence !== undefined && schedule.active && (
                                        <ActionButton
                                            label={
                                                skipped
                                                    ? t('alarms.unskip')
                                                    : t('alarms.skip', {
                                                          day: relativeDay(t, occurrence.date),
                                                      })
                                            }
                                            disabled={busy}
                                            onPress={() => {
                                                toggleSkipped(occurrence);
                                            }}
                                        />
                                    )}
                                    <ActionButton
                                        label={t('schedules.edit')}
                                        variant="primary"
                                        disabled={busy}
                                        onPress={() => {
                                            router.push({
                                                pathname: '/schedules/[id]/overview',
                                                params: { id: schedule.id },
                                            });
                                        }}
                                    />
                                    <ActionButton
                                        label={t('schedules.delete')}
                                        disabled={busy}
                                        onPress={() => {
                                            confirmDelete(schedule);
                                        }}
                                    />
                                </View>
                            </AlarmRow>
                        );
                    })}

                    {standalone.map((alarm) => (
                        <AlarmRow
                            key={alarm.id}
                            time={alarm.time}
                            title={
                                alarm.label.trim() === ''
                                    ? t('alarms.standalone_default')
                                    : alarm.label
                            }
                            subtitle={
                                alarm.days.length === 0
                                    ? nextRing(t, alarm)
                                    : days(t, alarm.days)
                            }
                            enabled={alarm.enabled}
                            muted={!alarm.enabled}
                            busy={busy}
                            expanded={expanded === alarm.id}
                            onToggle={() => {
                                saveStandalone({ ...alarm, enabled: !alarm.enabled });
                            }}
                            onExpand={() => {
                                setExpanded((current) => (current === alarm.id ? null : alarm.id));
                            }}
                        >
                            <StandaloneAlarmEditor
                                alarm={alarm}
                                busy={busy}
                                onChange={saveStandalone}
                                onDelete={() => {
                                    removeStandalone(alarm);
                                }}
                            />
                        </AlarmRow>
                    ))}

                    <ActionButton
                        label={t('alarms.add')}
                        variant="primary"
                        disabled={busy}
                        onPress={addStandalone}
                    />

                    <ActionButton
                        label={t('schedules.add')}
                        disabled={busy}
                        onPress={() => {
                            router.push('/(onboarding)/places');
                        }}
                    />
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

/** Compact weekday list, using the abbreviations the schedule screens already have. */
function days(t: (key: string) => string, weekdays: number[]): string {
    return weekdays.map((day) => t(`schedule.day_short.${String(day)}`)).join(' ');
}

/**
 * When a one-off alarm will next go off, in the words the list already uses.
 *
 * Computed from the same function that schedules it, so the row cannot promise a
 * morning the OS was never given.
 */
function nextRing(
    t: (key: string, options?: Record<string, unknown>) => string,
    alarm: StandaloneAlarm,
): string {
    const [next] = ringTimes(alarm, DateTime.now());
    return next === undefined ? t('alarms.no_time') : relativeDay(t, next.slice(0, 10));
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.medium },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.small,
    },
});
