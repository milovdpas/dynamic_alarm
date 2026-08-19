import { DateTime } from 'luxon';
import { DEFAULT_REMINDERS, Weekday } from '@alarm/types';
import type { IsoDateTimeString, LocalTimeString, ReminderConfig } from '@alarm/types';

import { canGuaranteeAlarm, getAlarmScheduler } from '@/alarm';
import { baseAlarmId, reminderTimes, ringId } from '@/alarm/reminders';
import { resolveAlarmSoundUri } from '@/alarm/alarmSound';
import i18n from '@/i18n/i18n';
import Storage from '@/utils/modules/Storage';

/**
 * An alarm somebody set by hand, with no journey behind it.
 *
 * The other half of the alarms list. A schedule answers "when must I get up to
 * be there by 08:30", which needs a server, a timetable and a monitor. This
 * answers "wake me at 07:45", which needs none of them, and pretending
 * otherwise would put a Saturday alarm at the mercy of an API being reachable.
 */
export interface StandaloneAlarm {
    id: string;
    /** Optional; the list falls back to translated copy when it is blank. */
    label: string;
    /** Wall-clock, in the phone's own zone. Not an instant: it recurs. */
    time: LocalTimeString;
    /** Empty means once, on the next occurrence of `time`. */
    days: Weekday[];
    enabled: boolean;
    /** Platform URI from the system ringtone picker, or null for the default. */
    soundUri: string | null;
    /** Extra rings before this one. The last ring is always `time`. */
    reminders: ReminderConfig;
}

/**
 * Where these live, and why it is not the server.
 *
 * Everything else in this app is stored server side, so this is the exception
 * and it is a deliberate one. A one-off alarm has no journey to plan, no monitor
 * to watch it and no push to receive, so the server would hold a row it could do
 * nothing with. It would not buy durability either: the device token lives in
 * SecureStore, which Android clears on uninstall, so a reinstall starts a new
 * anonymous device and a server copy would be just as lost as this one.
 *
 * What it does buy is that these keep working with no network at all, which for
 * the alarm somebody set for a 06:00 flight is the only property that matters.
 */
const KEY = 'standaloneAlarms';

/**
 * How far ahead recurring alarms are handed to the OS.
 *
 * The native layer holds one-shot alarms keyed by id and re-arms them after a
 * reboot, with no notion of recurrence. Something therefore has to schedule the
 * next one, and the only thing that runs is the app being opened. Seven days is
 * the honest compromise: a week of alarms survives a phone nobody unlocks, and
 * every launch tops it back up.
 *
 * The more robust answer is the ringing service arming its own successor
 * natively, which needs no JavaScript at all. Noted rather than done, because it
 * is native work and this is not the failure mode anyone has hit yet.
 */
const DAYS_AHEAD = 7;

/**
 * The id prefix that marks an OS alarm as belonging to this file.
 *
 * Deliberately not `occurrence-`, which `cancelOrphans` in `useNextAlarm` sweeps
 * against the server's list. A standalone alarm is in no such list, so sharing
 * the prefix would have every one of them cancelled the moment Today refreshed.
 */
const PREFIX = 'standalone-';

export async function listStandaloneAlarms(): Promise<StandaloneAlarm[]> {
    const raw = await Storage.getItem(KEY);
    if (raw === null) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        // Filtered rather than trusted, then filled in. This is user data that
        // survives app updates, so one malformed row should cost that row rather
        // than the whole list, and a row written by an older version should gain
        // the fields it predates rather than reaching the OS as `undefined`.
        return parsed.filter(isAlarm).map((alarm) => ({
            ...alarm,
            label: typeof alarm.label === 'string' ? alarm.label : '',
            soundUri: typeof alarm.soundUri === 'string' ? alarm.soundUri : null,
            // Rows written before reminders existed have none, and one ring is
            // exactly what they used to do.
            reminders: alarm.reminders ?? DEFAULT_REMINDERS,
        }));
    } catch {
        return [];
    }
}

export async function saveStandaloneAlarm(alarm: StandaloneAlarm): Promise<StandaloneAlarm[]> {
    const existing = await listStandaloneAlarms();
    const without = existing.filter((each) => each.id !== alarm.id);
    const next = [...without, alarm].sort((a, b) => a.time.localeCompare(b.time));
    await Storage.setItem(KEY, JSON.stringify(next));
    return next;
}

export async function deleteStandaloneAlarm(id: string): Promise<StandaloneAlarm[]> {
    const next = (await listStandaloneAlarms()).filter((each) => each.id !== id);
    await Storage.setItem(KEY, JSON.stringify(next));
    // Cancelled here rather than left to the sweep, because a deleted alarm that
    // still rings once is the worst version of this bug and the sweep only runs
    // when a screen happens to ask for it.
    await cancelStandaloneAlarm(id);
    return next;
}

/**
 * Every moment this alarm should ring in the next week, soonest first.
 *
 * Pure, so the scheduling and the "next ring" shown on the row are the same
 * arithmetic rather than two implementations that agree until they do not.
 *
 * A one-off alarm, with no days, resolves to the next occurrence of its time:
 * today if it has not passed, otherwise tomorrow. That is what an alarm app
 * means by 07:45 with nothing else said.
 */
export function ringTimes(alarm: StandaloneAlarm, now: DateTime): IsoDateTimeString[] {
    const parsed = parseTime(alarm.time);
    if (parsed === null) {
        return [];
    }

    const times: IsoDateTimeString[] = [];
    for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
        const day = now.plus({ days: offset }).set({
            hour: parsed.hour,
            minute: parsed.minute,
            second: 0,
            millisecond: 0,
        });

        if (day <= now) {
            continue;
        }
        if (alarm.days.length > 0 && !alarm.days.includes(day.weekday as Weekday)) {
            continue;
        }

        const iso = day.toISO();
        if (iso !== null) {
            times.push(iso);
        }
        // A one-off wants exactly the next one. Without this it would be
        // scheduled every day for a week, which is a recurring alarm nobody
        // asked for.
        if (alarm.days.length === 0) {
            break;
        }
    }

    return times;
}

/**
 * Hands the enabled alarms to the OS, and takes back everything else.
 *
 * Written as a full reconciliation rather than as edits, because the OS is the
 * source of truth about what will actually ring and this file's job is to make
 * it match. An edit-based version has to be right about every path that could
 * have changed something, and the one it gets wrong leaves an alarm ringing for
 * a row that no longer exists.
 *
 * Returns the number of alarms the OS confirms it holds, so a caller can tell
 * "we asked" from "it is set", which is the distinction this project draws
 * everywhere else too.
 */
export async function syncStandaloneAlarms(now = DateTime.now()): Promise<number> {
    if (!canGuaranteeAlarm()) {
        return 0;
    }

    const scheduler = getAlarmScheduler();
    const soundUri = await resolveAlarmSoundUri();
    const wanted = plannedRings(await listStandaloneAlarms(), now);

    const held = (await scheduler.listScheduled()).filter((id) => id.startsWith(PREFIX));

    for (const id of held) {
        if (!wanted.has(id)) {
            await scheduler.cancel(id).catch(() => undefined);
        }
    }

    for (const [id, { at, alarm }] of wanted) {
        if (held.includes(id)) {
            // Already held for this exact moment, and re-scheduling would be a
            // write for no change. The id carries the moment, so a ring that
            // moved has a different id and is picked up as a new one.
            continue;
        }
        await scheduler
            .schedule({
                id,
                at,
                soundUri,
                title: i18n.t('alarm.ringing_title'),
                body: alarm.label.trim() === '' ? i18n.t('alarms.standalone_default') : alarm.label,
            })
            .catch(() => undefined);
    }

    const confirmed = (await scheduler.listScheduled()).filter((id) => id.startsWith(PREFIX));
    return confirmed.length;
}

/**
 * Every OS alarm the enabled standalone alarms want, by id.
 *
 * Pure, and separate from the scheduling above so the set can be asserted
 * without a device. What it gets wrong is invisible from the outside until an
 * alarm rings at the wrong time or fails to ring at all.
 */
export function plannedRings(
    alarms: StandaloneAlarm[],
    now: DateTime,
): Map<string, { at: IsoDateTimeString; alarm: StandaloneAlarm }> {
    const wanted = new Map<string, { at: IsoDateTimeString; alarm: StandaloneAlarm }>();
    for (const alarm of alarms) {
        if (!alarm.enabled) {
            continue;
        }
        for (const at of ringTimes(alarm, now)) {
            /*
             * Each ring of each day, identified by **its own** moment.
             *
             * Keying on the day's wake time instead was wrong in a way the
             * reconciliation below could not see: changing the interval from
             * five minutes to ten leaves every id identical, so each ring
             * looked already held and the OS kept the old times for ever.
             *
             * The suffix stays, because the lock setting asks whether a ring is
             * a reminder, but it is the timestamp that makes the id unique.
             */
            const chain = reminderTimes(at, alarm.reminders);
            for (const [index, ringAt] of chain.entries()) {
                const id = ringId(osId(alarm.id, ringAt), chain.length - 1 - index);
                wanted.set(id, { at: ringAt, alarm });
            }
        }
    }

    return wanted;
}

/** Takes back every OS alarm belonging to one standalone alarm. */
export async function cancelStandaloneAlarm(id: string): Promise<void> {
    if (!canGuaranteeAlarm()) {
        return;
    }

    const scheduler = getAlarmScheduler();
    for (const held of await scheduler.listScheduled()) {
        if (held.startsWith(`${PREFIX}${id}@`)) {
            await scheduler.cancel(held).catch(() => undefined);
        }
    }
}

/**
 * One OS alarm per ring, identified by which alarm and which moment.
 *
 * The time is in the id on purpose. Re-arming with the same id replaces rather
 * than stacks, so a week of rings needs a week of distinct ids, and putting the
 * moment in the id is what makes the reconciliation above a set comparison
 * instead of bookkeeping.
 */
function osId(alarmId: string, at: IsoDateTimeString): string {
    return `${PREFIX}${alarmId}@${at}`;
}

/** Which standalone alarm an OS id belongs to, or null when it is not ours. */
export function standaloneIdFrom(osAlarmId: string): string | null {
    if (!osAlarmId.startsWith(PREFIX)) {
        return null;
    }
    const rest = baseAlarmId(osAlarmId).slice(PREFIX.length);
    const at = rest.indexOf('@');
    return at === -1 ? rest : rest.slice(0, at);
}

function parseTime(time: LocalTimeString): { hour: number; minute: number } | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (match === null) {
        return null;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
        return null;
    }
    return { hour, minute };
}

function isAlarm(value: unknown): value is StandaloneAlarm {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<StandaloneAlarm>;
    return (
        typeof candidate.id === 'string' &&
        typeof candidate.time === 'string' &&
        typeof candidate.enabled === 'boolean' &&
        Array.isArray(candidate.days)
    );
}
