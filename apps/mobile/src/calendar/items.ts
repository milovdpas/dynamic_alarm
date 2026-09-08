import type { DateTime } from 'luxon';
import { DateTime as Luxon } from 'luxon';
import { OccurrenceState } from '@alarm/types';
import type { IsoDateString, IsoDateTimeString, OccurrenceResponse } from '@alarm/types';

import { isReminderId, reminderTimes } from '@/alarm/reminders';
import { plannedRings, type StandaloneAlarm } from '@/alarm/standaloneAlarms';

/**
 * One ring on the calendar, whatever produced it.
 *
 * A schedule's morning and a hand-set alarm are different things to build and
 * the same thing to look at on a given day: a time, a name, and whether it is
 * the real alarm or one of the reminders before it. The calendar reads this and
 * nothing else, so the two sources cannot drift into two visual languages.
 */
export interface CalendarItem {
    /** Unique within the calendar, stable across renders. */
    id: string;
    at: IsoDateTimeString;
    kind: 'SCHEDULE' | 'STANDALONE' | 'REMINDER';
    /** The schedule's name, or a hand-set alarm's label. May be blank. */
    title: string;
    /** A morning its owner sat out. Shown struck through, with no reminders. */
    skipped: boolean;
    /** Present for a schedule's morning and its reminders. */
    occurrence: OccurrenceResponse | null;
    /** Present for a hand-set alarm and its reminders. */
    alarm: StandaloneAlarm | null;
}

/**
 * Every ring in the coming days, grouped by the date it falls on.
 *
 * Pure, so the agenda, the week grid and the day detail are three views of one
 * list rather than three lists. The date is the ring's own date in `zone`, not
 * the morning's `date` field: a reminder before a 00:10 wake time belongs to the
 * evening before, and a calendar that put it on the wrong day would be lying
 * about when the phone makes a noise.
 */
export function calendarItems(input: {
    occurrences: OccurrenceResponse[];
    alarms: StandaloneAlarm[];
    now: DateTime;
    zone: string;
}): Map<IsoDateString, CalendarItem[]> {
    const items: CalendarItem[] = [];

    for (const occurrence of input.occurrences) {
        const skipped = occurrence.state === OccurrenceState.SKIPPED;
        items.push({
            id: `occurrence-${occurrence.id}`,
            at: occurrence.currentWakeAt,
            kind: 'SCHEDULE',
            title: occurrence.scheduleName,
            skipped,
            occurrence,
            alarm: null,
        });

        // The earlier rings of the chain, never for a skipped morning: nothing
        // rings on a morning that was sat out.
        if (!skipped) {
            const chain = reminderTimes(occurrence.currentWakeAt, occurrence.reminders);
            for (const at of chain.slice(0, -1)) {
                items.push({
                    id: `occurrence-${occurrence.id}@${at}`,
                    at,
                    kind: 'REMINDER',
                    title: occurrence.scheduleName,
                    skipped: false,
                    occurrence,
                    alarm: null,
                });
            }
        }
    }

    // The same set the OS is asked to hold, so the calendar cannot promise a
    // ring the phone was never given.
    for (const [osId, ring] of plannedRings(input.alarms, input.now)) {
        items.push({
            id: osId,
            at: ring.at,
            kind: isReminderId(osId) ? 'REMINDER' : 'STANDALONE',
            title: ring.alarm.label,
            skipped: false,
            occurrence: null,
            alarm: ring.alarm,
        });
    }

    const byDate = new Map<IsoDateString, CalendarItem[]>();
    for (const item of items) {
        const date = Luxon.fromISO(item.at).setZone(input.zone).toISODate();
        if (date === null) {
            continue;
        }
        const list = byDate.get(date) ?? [];
        list.push(item);
        byDate.set(date, list);
    }
    for (const list of byDate.values()) {
        list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    }
    return byDate;
}
