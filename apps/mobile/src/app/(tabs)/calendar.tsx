import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from 'expo-router';
import { DateTime } from 'luxon';
import { APP_CONSTANTS, OccurrenceState } from '@alarm/types';
import type { IsoDateString, OccurrenceResponse } from '@alarm/types';

import {
    listOccurrences,
    listRoutines,
    listSchedules,
    setOccurrenceSteps,
    skipOccurrence,
    unskipOccurrence,
} from '@/api';
import { listStandaloneAlarms, type StandaloneAlarm } from '@/alarm/standaloneAlarms';
import { syncOsAlarms } from '@/alarm/useNextAlarm';
import { calendarItems } from '@/calendar/items';
import { useCalendarRange, useCalendarView } from '@/calendar/useCalendarRange';
import { Spacing } from '@/assets/Stylesheet';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import DayDetail from '@/components/calendar/DayDetail';
import DayList from '@/components/calendar/DayList';
import StaleNotice from '@/components/ui/StaleNotice';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { useApiQuery } from '@/utils/hooks/useApiQuery';
import { ApiRequestError } from '@/utils/modules/Axios';

/**
 * The coming days, and what rings on each of them.
 *
 * The fourth tab. Today answers "what is the alarm", Alarms answers "what is
 * set", and this answers "what does my week look like", which became a real
 * question the moment the server started planning seven days ahead. It is also
 * the one place a single morning can be changed without touching the schedule
 * behind it: skipped, or given a shorter routine for that date only.
 *
 * Structured after the calendar in marathon_schema, rebuilt for the phone: a
 * header with the range and the view chips, then an agenda, a day or a week, and
 * a day detail under whichever day is tapped. Month is left out until the data
 * reaches further than a week.
 *
 * Nothing here spends a provider call. Mornings arrive with their plans, hand-set
 * alarms come from the phone, and leaving a step out is recomputed by the server
 * from the plan it already has.
 */
export default function CalendarScreen() {
    const { t } = useTranslation();

    const [view, setView] = useCalendarView();
    const range = useCalendarRange(view);
    const [selected, setSelected] = useState<IsoDateString | null>(null);
    const [busy, setBusy] = useState(false);
    const [writeError, setWriteError] = useState<string | null>(null);
    const [alarms, setAlarms] = useState<StandaloneAlarm[]>([]);

    /*
     * Three reads, one query, because a day is only meaningful as the whole:
     * the morning, the schedule it belongs to, and the routine whose steps can
     * be left out of it. Separately they would let the screen render a morning
     * with no steps to tick for a moment on every focus.
     */
    const fetchAll = useCallback(async () => {
        const [schedules, occurrences, routines] = await Promise.all([
            listSchedules(),
            listOccurrences(),
            listRoutines(),
        ]);
        return { schedules, occurrences, routines };
    }, []);

    const { data, loading, cachedAt, error, refresh } = useApiQuery('calendar', fetchAll);

    useFocusEffect(
        useCallback(() => {
            refresh();
            void listStandaloneAlarms().then(setAlarms);
        }, [refresh]),
    );

    const itemsByDate = useMemo(
        () =>
            calendarItems({
                occurrences: data?.occurrences ?? [],
                alarms,
                now: DateTime.now().setZone(APP_CONSTANTS.TIMEZONE),
                zone: APP_CONSTANTS.TIMEZONE,
            }),
        [data?.occurrences, alarms],
    );

    /** The day whose detail is open: the anchor in day view, else the tapped one. */
    const detailDate: IsoDateString | null =
        view === 'day' ? (range.anchor.toISODate() ?? null) : selected;

    /** Runs a write, makes the OS follow it, keeps the screen honest, reloads. */
    const write = useCallback(
        async (action: () => Promise<unknown>) => {
            setBusy(true);
            setWriteError(null);
            try {
                await action();
                // The alarm is not changed until the phone holds the new time.
                // A skipped morning is cancelled, a shortened one re-armed.
                await listOccurrences({ live: true }).then(syncOsAlarms).catch(() => undefined);
                refresh();
            } catch (error) {
                setWriteError(ApiRequestError.from(error).code);
            } finally {
                setBusy(false);
            }
        },
        [refresh],
    );

    const toggleSkip = useCallback(
        (occurrence: OccurrenceResponse) => {
            void write(() =>
                occurrence.state === OccurrenceState.SKIPPED
                    ? unskipOccurrence(occurrence.id)
                    : skipOccurrence(occurrence.id),
            );
        },
        [write],
    );

    const changeSteps = useCallback(
        (occurrence: OccurrenceResponse, disabledStepIds: string[]) => {
            void write(() => setOccurrenceSteps(occurrence.id, disabledStepIds));
        },
        [write],
    );

    const agendaHasNothing =
        view === 'agenda' &&
        data !== null &&
        range.days.every((day) => (itemsByDate.get(day.toISODate() ?? '') ?? []).length === 0);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    <ThemedText type="title">{t('calendar.title')}</ThemedText>

                    <CalendarHeader
                        title={range.title}
                        paged={range.paged}
                        view={view}
                        onView={(next) => {
                            setSelected(null);
                            setView(next);
                        }}
                        onPrev={range.goPrev}
                        onNext={range.goNext}
                        onToday={range.goToday}
                    />

                    <StaleNotice cachedAt={cachedAt} />
                    {loading && <ActivityIndicator />}

                    {error !== null && data === null && (
                        <WarningBanner
                            title={t('schedules.failed')}
                            message={apiErrorMessage(t, error)}
                        />
                    )}
                    {writeError !== null && (
                        <WarningBanner
                            title={t('schedules.save_failed')}
                            message={apiErrorMessage(t, writeError)}
                        />
                    )}

                    {agendaHasNothing && (
                        <ThemedText themeColor="textSecondary">{t('calendar.empty')}</ThemedText>
                    )}

                    {view !== 'day' && (
                        <DayList
                            days={range.days}
                            itemsByDate={itemsByDate}
                            showEmpty={view === 'week'}
                            selected={selected}
                            onSelect={(date) => {
                                setSelected((current) => (current === date ? null : date));
                            }}
                        />
                    )}

                    {detailDate !== null && (
                        <DayDetail
                            date={detailDate}
                            items={itemsByDate.get(detailDate) ?? []}
                            schedules={data?.schedules ?? []}
                            routines={data?.routines ?? []}
                            busy={busy}
                            onToggleSkip={toggleSkip}
                            onSteps={changeSteps}
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
